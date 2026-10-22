// Database tests: applies every migration to an in-memory Postgres (PGlite)
// with a minimal stand-in for Supabase's auth schema, then exercises the
// workflow functions, row-level security and the audit log as real users.
//
//   npm run test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(import.meta.dirname, "..", "supabase", "migrations");
const ADMIN = "11111111-1111-1111-1111-111111111111"; // procurement officer, all roles
const APPROVER_A = "22222222-2222-2222-2222-222222222222";
const APPROVER_B = "33333333-3333-3333-3333-333333333333"; // also receiver
const FINANCE = "44444444-4444-4444-4444-444444444444";
const OUTSIDER = "55555555-5555-5555-5555-555555555555";

const db = new PGlite();
let org;

const q = async (sql, params) => (await db.query(sql, params)).rows;
async function as(user, sql, params) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`);
  try { return await q(sql, params); } finally { await db.exec("reset role;"); }
}
const one = async (user, sql, params) => (await as(user, sql, params))[0];
const id = async (table, number) => (await q(`select id from ${table} where number = $1 and org_id = $2`, [number, org]))[0].id;

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    insert into auth.users values
      ('${ADMIN}', 'officer@ngo.example'), ('${APPROVER_A}', 'head@ngo.example'),
      ('${APPROVER_B}', 'manager@ngo.example'), ('${FINANCE}', 'finance@ngo.example'),
      ('${OUTSIDER}', 'outsider@other.example');
  `);
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
  // What Supabase grants by default.
  await db.exec(`grant usage on schema public to anon, authenticated;
    grant all on all tables in schema public to authenticated;
    grant all on all sequences in schema public to authenticated;
    grant usage on schema auth to authenticated;`);
  org = (await one(ADMIN, "select create_demo_org('A. Procurement Officer') as id")).id;
});

test("one organisation per user", async () => {
  await assert.rejects(as(ADMIN, "select create_demo_org('again')"), /already belong/);
  await assert.rejects(as(ADMIN, "select create_org('Second', 'x', 'y')"), /already belong/);
});

test("demo seed matches the corrected mockups", async () => {
  const depts = await q(`select d.name, sum(committed_minor)::bigint s from budget_lines b join departments d on d.id = b.department_id
                         where b.org_id = $1 group by 1 order by 2 desc`, [org]);
  assert.equal(depts.map((x) => `${x.name}:${x.s}`).join(","),
    "Programs:18640000,Health:12190000,Logistics:5820000,Administration:2970000,Finance:1610000");
  const steps = await q(`select s.level, s.status, s.required_role from approval_steps s join requisitions r on r.id = s.requisition_id
                         where r.number = 'REQ-0142' order by s.level`);
  assert.equal(steps.map((s) => `${s.level}:${s.status}:${s.required_role}`).join("|"),
    "1:approved:approver|2:pending:approver|3:waiting:finance");
  const stats = (await one(ADMIN, "select dashboard_stats($1) s", [org])).s;
  assert.equal(stats.awaiting_approval, 6);
  assert.equal(stats.exceptions, 1);
});

test("row-level security isolates organisations", async () => {
  const r = await one(OUTSIDER, `select (select count(*) from requisitions)::int a, (select count(*) from audit_events)::int b,
                                        (select count(*) from vendors)::int c, (select count(*) from budget_lines)::int d`);
  assert.deepEqual(r, { a: 0, b: 0, c: 0, d: 0 });
  await assert.rejects(as(OUTSIDER, "select decide_requisition($1, 'approve', '')", [await id("requisitions", "REQ-0142")]), /not found/i);
  await assert.rejects(as(OUTSIDER, "select dashboard_stats($1)", [org]), /Not a member/);
});

test("members join only by invitation; roles are admin-controlled and audited", async () => {
  await assert.rejects(as(APPROVER_A, "select invite_member($1, 'x@y.z', 'X', '', '{approver}')", [org]), /admin role/);
  await as(ADMIN, "select invite_member($1, 'head@ngo.example', 'Head of Administration', 'Head of Administration', '{approver}')", [org]);
  await as(ADMIN, "select invite_member($1, 'manager@ngo.example', 'Project 01 Manager', 'Project 01 Manager', '{approver,receiver}')", [org]);
  await as(ADMIN, "select invite_member($1, 'finance@ngo.example', 'Finance Officer', 'Finance Officer', '{finance}')", [org]);
  for (const u of [APPROVER_A, APPROVER_B, FINANCE]) assert.equal((await one(u, "select accept_invite() o")).o, org);
  assert.equal((await one(OUTSIDER, "select accept_invite() o")).o, null);
  await assert.rejects(as(ADMIN, "select set_member_roles($1, $2, null, '{requester}')", [org, ADMIN]), /at least one administrator/);
  await assert.rejects(as(ADMIN, "insert into members (org_id, user_id, display_name) values ($1, $2, 'x')", [org, OUTSIDER]), /row-level security/);
});

test("reference data and budgets change only through audited functions", async () => {
  await assert.rejects(as(ADMIN, "insert into departments (org_id, name) values ($1, 'Rogue')", [org]), /row-level security/);
  // With no update policy, RLS silently filters the rows: nothing changes.
  const sumBefore = (await q("select sum(committed_minor)::bigint s from budget_lines where org_id = $1", [org]))[0].s;
  await as(ADMIN, "update budget_lines set committed_minor = 0 where org_id = $1", [org]);
  assert.equal((await q("select sum(committed_minor)::bigint s from budget_lines where org_id = $1", [org]))[0].s, sumBefore);
  const line = await q("select id, committed_minor from budget_lines where code = 'ADM-01-4200' and org_id = $1", [org]);
  await assert.rejects(as(ADMIN, "select set_budget_amount($1, 100, 'cut')", [line[0].id]), /below/);
  await assert.rejects(as(ADMIN, "select set_budget_amount($1, 5000000, '')", [line[0].id]), /reason is required/);
  await as(ADMIN, "select set_budget_amount($1, 5000000, 'Mid-year revision')", [line[0].id]);
  await assert.rejects(as(APPROVER_A, "select add_reference($1, 'donor', 'Donor X', null)", [org]), /admin role/);
});

let req;
test("requisition: org validation, routing by role, segregation of duties, budget control", async () => {
  const [dept] = await q("select id from departments where name = 'Administration' and org_id = $1", [org]);
  const [proj] = await q("select id from projects where name = 'Project 01' and org_id = $1", [org]);
  const [donor] = await q("select id from donors where name = 'Donor A' and org_id = $1", [org]);
  const payload = (over) => JSON.stringify({
    title: "Office furniture for field office", department_id: dept.id, project_id: proj.id, donor_id: donor.id,
    category: "Goods", lines: [
      { description: "Office desk", qty: 12, unit: "each", unit_cost_minor: 31000 },
      { description: "Office chair", qty: 12, unit: "each", unit_cost_minor: 14500 },
      { description: "Filing cabinet", qty: 4, unit: "each", unit_cost_minor: 18000 },
    ], ...over,
  });
  // Another org's department id is rejected.
  await as(OUTSIDER, "select create_org('Other NGO', 'O', 'Director')");
  const foreign = (await one(OUTSIDER, "select add_reference((select org_id from members where user_id = auth.uid()), 'department', 'Theirs', null) id")).id;
  await assert.rejects(as(ADMIN, "select save_requisition($1, $2, true)", [org, payload({ department_id: foreign })]), /not found in this organisation/);
  // Missing budget line blocks submission.
  await assert.rejects(as(ADMIN, "select save_requisition($1, $2, true)", [org, payload({ project_id: null })]), /No budget line/);

  req = (await one(ADMIN, "select save_requisition($1, $2, true) id", [org, payload()])).id;
  const r = await q("select number, status, total_minor from requisitions where id = $1", [req]);
  assert.equal(`${r[0].number}:${r[0].status}:${r[0].total_minor}`, "REQ-0143:submitted:618000");

  await assert.rejects(as(ADMIN, "select decide_requisition($1, 'approve', '')", [req]), /you raised/);
  await assert.rejects(as(FINANCE, "select decide_requisition($1, 'approve', '')", [req]), /approver role/);
  await as(APPROVER_A, "select decide_requisition($1, 'approve', 'OK')", [req]);
  await assert.rejects(as(APPROVER_A, "select decide_requisition($1, 'approve', '')", [req]), /earlier level/);
  await as(APPROVER_B, "select decide_requisition($1, 'approve', 'Within budget')", [req]);
  const after = await q("select status from requisitions where id = $1", [req]);
  assert.equal(after[0].status, "approved");
});

test("final approval is blocked when the budget line lacks funds", async () => {
  const [dept] = await q("select id from departments where name = 'Finance' and org_id = $1", [org]);
  const [donor] = await q("select id from donors where name = 'Core funds' and org_id = $1", [org]);
  const big = (await one(ADMIN, "select save_requisition($1, $2, true) id", [org, JSON.stringify({
    title: "Audit software", department_id: dept.id, project_id: null, donor_id: donor.id, category: "Goods",
    lines: [{ description: "Licence", qty: 1, unit_cost_minor: 2000000 }],
  })])).id;
  await as(APPROVER_A, "select decide_requisition($1, 'approve', '')", [big]);
  await as(APPROVER_B, "select decide_requisition($1, 'approve', '')", [big]);
  await assert.rejects(as(FINANCE, "select decide_requisition($1, 'approve', '')", [big]), /Insufficient budget/);
});

test("returned requisitions keep approval history across resubmissions", async () => {
  const [dept] = await q("select id from departments where name = 'Logistics' and org_id = $1", [org]);
  const [donor] = await q("select id from donors where name = 'Core funds' and org_id = $1", [org]);
  const r = (await one(ADMIN, "select save_requisition($1, $2, true) id", [org, JSON.stringify({
    title: "Tyres", department_id: dept.id, project_id: null, donor_id: donor.id, category: "Goods",
    lines: [{ description: "Tyre", qty: 4, unit_cost_minor: 15000 }],
  })])).id;
  for (let round = 0; round < 2; round++) {
    await as(APPROVER_A, "select decide_requisition($1, 'approve', '')", [r]);
    await as(APPROVER_B, "select decide_requisition($1, 'return', 'Need quotes')", [r]);
    await as(ADMIN, "select submit_requisition($1)", [r]);
  }
  const steps = await q("select level, status from approval_steps where requisition_id = $1 order by level", [r]);
  assert.equal(steps.filter((s) => s.level < 1000).map((s) => s.status).join(","), "pending,waiting");
  assert.equal(steps.filter((s) => s.level >= 1000).length, 4);
});

let rfq, po;
test("sourcing: invites, sealed bidding, panel, award", async () => {
  await assert.rejects(as(APPROVER_A, "select create_rfq($1, now() + interval '7 days', 'Field office', '')", [req]), /buyer role/);
  await assert.rejects(as(ADMIN, "select create_direct_po($1, $2)", [req, await id("vendors", "VND-0017")]), /competitive quotations/);
  rfq = (await one(ADMIN, "select create_rfq($1, now() + interval '7 days', 'Field office', 'Delivery included') id", [req])).id;
  await assert.rejects(as(ADMIN, "select create_rfq($1, now() + interval '7 days', '', '')", [req]), /already being sourced/);

  await assert.rejects(as(ADMIN, "select invite_vendor($1, $2)", [rfq, await id("vendors", "VND-0021")]), /expired documents/);
  for (const v of ["VND-0017", "VND-0024"]) await as(ADMIN, "select invite_vendor($1, $2)", [rfq, await id("vendors", v)]);
  await assert.rejects(as(ADMIN, "select open_rfq($1)", [rfq]), /at least 3 vendors/);
  await as(ADMIN, "select invite_vendor($1, $2)", [rfq, await id("vendors", "VND-0026")]);
  await as(ADMIN, "select open_rfq($1)", [rfq]);

  const crit = await q("select id, weight from rfq_criteria where rfq_id = $1 and not is_price order by position", [rfq]);
  const scores = (vals) => JSON.stringify(Object.fromEntries(crit.map((c, i) => [c.id, { score: vals[i], note: "" }])));
  await assert.rejects(as(ADMIN, "select record_bid($1, $2, 500000, 60, $3)", [rfq, await id("vendors", "VND-0017"), scores([99, 1, 1, 1])]), /between 0 and 25/);
  await as(ADMIN, "select record_bid($1, $2, 600000, 60, $3)", [rfq, await id("vendors", "VND-0017"), scores([25, 14, 8.6, 10])]);
  await as(ADMIN, "select record_bid($1, $2, 580000, 30, $3)", [rfq, await id("vendors", "VND-0024"), scores([20, 10, 5, 10])]);
  await assert.rejects(as(ADMIN, "select close_rfq($1)", [rfq]), /close early/);
  await as(ADMIN, "select record_bid($1, $2, 620000, 90, $3)", [rfq, await id("vendors", "VND-0026"), scores([25, 12, 5, 10])]);
  await as(ADMIN, "select close_rfq($1)", [rfq]);

  await assert.rejects(as(ADMIN, "select recommend_award($1, 'award', $2, 'Best value')", [rfq, await id("vendors", "VND-0017")]), /panel members/);
  for (const t of ["Procurement Officer", "Technical Lead", "Finance Officer"]) await as(ADMIN, "select submit_evaluation($1, $2)", [rfq, t]);
  await as(ADMIN, "select recommend_award($1, 'award', $2, 'Highest weighted score')", [rfq, await id("vendors", "VND-0017")]);
});

test("purchase order: drafted from award, approved by someone else, issued", async () => {
  po = (await one(ADMIN, "select create_po_from_award($1) id", [rfq])).id;
  const drafted = Number((await q("select po_total($1) t", [po]))[0].t);
  assert.ok(drafted <= 600000 && drafted > 599900, `draft ${drafted} must not exceed the bid`);
  await assert.rejects(as(ADMIN, "select create_po_from_award($1)", [rfq]), /already exists/);
  await assert.rejects(as(ADMIN, "select approve_po($1)", [po]), /you drafted/);

  const lines = await q("select id from po_lines where po_id = $1 order by line_no", [po]);
  const inflated = JSON.stringify(lines.map((l) => ({ id: l.id, unit_price_minor: 99999 })));
  await as(ADMIN, "select save_po_draft($1, $2, current_date + 14, 'Field office', '')", [po, inflated]);
  await assert.rejects(as(APPROVER_A, "select approve_po($1)", [po]), /exceeds the awarded bid/);
  // Quoted prices: 12 x 301.00 + 12 x 141.00 + 4 x 174.00 = 6,000.00
  const fair = JSON.stringify([{ id: lines[0].id, unit_price_minor: 30100 }, { id: lines[1].id, unit_price_minor: 14100 }, { id: lines[2].id, unit_price_minor: 17400 }]);
  await as(ADMIN, "select save_po_draft($1, $2, current_date + 14, 'Field office', '')", [po, fair]);
  await as(APPROVER_A, "select approve_po($1)", [po]);

  const before = (await q("select committed_minor c from budget_lines where code = 'ADM-01-4200' and org_id = $1", [org]))[0].c;
  await as(ADMIN, "select issue_po($1)", [po]);
  const after = (await q("select committed_minor c from budget_lines where code = 'ADM-01-4200' and org_id = $1", [org]))[0].c;
  assert.equal(after - before, 600000 - 618000, "commitment trued up to the PO value");
});

let invoice;
test("receipt and invoice: SoD, cumulative quantities, matching, payment closes the order", async () => {
  await assert.rejects(as(ADMIN, "select create_goods_receipt($1, current_date, '')", [po]), /you raised/);
  const g1 = (await one(APPROVER_B, "select create_goods_receipt($1, current_date, '') id", [po])).id;
  const lines = await q("select po_line_id, received_qty from grn_lines where grn_id = $1", [g1]);
  const partial = JSON.stringify(lines.map((l, i) => ({ po_line_id: l.po_line_id, received_qty: i === 0 ? 6 : Number(l.received_qty), inspection: i === 0 ? "Short delivery" : "Passed" })));
  await assert.rejects(as(APPROVER_B, "select save_goods_receipt($1, $2, '{}', '', '', '', true)", [g1, partial]), /Describe the discrepancy/);
  await as(APPROVER_B, "select save_goods_receipt($1, $2, '{}', 'Office desk', 'Short delivery', '6 of 12 delivered', true)", [g1, partial]);
  assert.equal((await q("select status from purchase_orders where id = $1", [po]))[0].status, "partially_received");

  const poLines = await q("select id, qty, unit_price_minor from po_lines where po_id = $1 order by line_no", [po]);
  const invLines = JSON.stringify(poLines.map((l) => ({ po_line_id: l.id, qty: Number(l.qty), unit_price_minor: Number(l.unit_price_minor) })));
  await assert.rejects(as(APPROVER_B, "select register_invoice($1, 'VA-1', current_date, $2)", [po, invLines]), /finance role/);
  invoice = (await one(FINANCE, "select register_invoice($1, 'va-1', current_date, $2) id", [po, invLines])).id;
  assert.equal((await q("select status from invoices where id = $1", [invoice]))[0].status, "exception");
  await assert.rejects(as(FINANCE, "select register_invoice($1, 'VA-1', current_date, $2)", [po, invLines]), /Duplicate/);
  await assert.rejects(as(FINANCE, "select resolve_invoice($1, 'partial_payment', 'x')", [invoice]), /you registered/);

  const g2 = (await one(APPROVER_B, "select create_goods_receipt($1, current_date, '') id", [po])).id;
  const rest = await q("select po_line_id, received_qty from grn_lines where grn_id = $1", [g2]);
  assert.equal(rest.length, 1, "only the outstanding line is offered");
  await assert.rejects(as(APPROVER_B, "select save_goods_receipt($1, $2, '{}', '', '', '', true)",
    [g2, JSON.stringify([{ po_line_id: rest[0].po_line_id, received_qty: 7, inspection: "Passed" }])]), /outstanding/);
  await as(APPROVER_B, "select save_goods_receipt($1, $2, '{}', '', '', '', true)",
    [g2, JSON.stringify([{ po_line_id: rest[0].po_line_id, received_qty: 6, inspection: "Passed" }])]);
  assert.equal((await q("select status from invoices where id = $1", [invoice]))[0].status, "matched", "re-matched after receipt");
  assert.equal((await q("select status from purchase_orders where id = $1", [po]))[0].status, "received");

  await assert.rejects(as(APPROVER_B, "select resolve_invoice($1, 'approve', 'ok')", [invoice]), /finance role/);
  await as(ADMIN, "select resolve_invoice($1, 'approve', 'Matched in full')", [invoice]);
  const spentBefore = (await q("select spent_minor s from budget_lines where code = 'ADM-01-4200' and org_id = $1", [org]))[0].s;
  await as(FINANCE, "select mark_invoice_paid($1, current_date, 'BANK-123')", [invoice]);
  const spentAfter = (await q("select spent_minor s from budget_lines where code = 'ADM-01-4200' and org_id = $1", [org]))[0].s;
  assert.equal(spentAfter - spentBefore, 600000);
  assert.equal((await q("select status from purchase_orders where id = $1", [po]))[0].status, "closed");
});

test("demo invoice INV-2207: partial payment pays only received goods (USD 7,795.00)", async () => {
  await as(FINANCE, "select resolve_invoice($1, 'partial_payment', 'Pay for goods received')", [await id("invoices", "INV-2207")]);
  const inv = await q("select approved_amount_minor a from invoices where number = 'INV-2207' and org_id = $1", [org]);
  assert.equal(Number(inv[0].a), 779500);
});

test("direct purchase below the limit", async () => {
  const [dept] = await q("select id from departments where name = 'Programs' and org_id = $1", [org]);
  const [proj] = await q("select id from projects where name = 'Project 01' and org_id = $1", [org]);
  const [donor] = await q("select id from donors where name = 'Donor B' and org_id = $1", [org]);
  const small = (await one(ADMIN, "select save_requisition($1, $2, true) id", [org, JSON.stringify({
    title: "Markers", department_id: dept.id, project_id: proj.id, donor_id: donor.id, category: "Goods",
    lines: [{ description: "Marker pens", qty: 50, unit_cost_minor: 120 }],
  })])).id;
  await assert.rejects(as(ADMIN, "select create_direct_po($1, $2)", [small, await id("vendors", "VND-0017")]), /approved requisitions/);
  await as(APPROVER_A, "select decide_requisition($1, 'approve', '')", [small]);
  await as(APPROVER_B, "select decide_requisition($1, 'approve', '')", [small]);
  await assert.rejects(as(ADMIN, "select create_direct_po($1, $2)", [small, await id("vendors", "VND-0021")]), /expired documents/);
  const direct = (await one(ADMIN, "select create_direct_po($1, $2) id", [small, await id("vendors", "VND-0017")])).id;
  assert.equal((await q("select po_total($1) t", [direct]))[0].t, 6000);
  await assert.rejects(as(ADMIN, "select create_rfq($1, now() + interval '1 day', '', '')", [small]), /already being sourced/);
});

test("audit log is append-only and cannot be forged", async () => {
  await assert.rejects(q("update audit_events set detail = 'x' where id = (select min(id) from audit_events)"), /append-only/);
  await assert.rejects(q("delete from audit_events where id = (select min(id) from audit_events)"), /append-only/);
  await assert.rejects(as(ADMIN, "select log_event($1, 'Fake', 'x', null, 'x', 'x')", [org]), /permission denied/);
  await assert.rejects(as(ADMIN, "insert into audit_events (org_id, actor_label, action, record_type, record_label) values ($1, 'x', 'x', 'x', 'x')", [org]), /row-level security|permission/);
  await assert.rejects(as(ADMIN, "insert into vendors (org_id, number, legal_name, trading_name, status) values ($1, 'VND-9', 'X', 'X', 'approved')", [org]), /row-level security/);
  const n = (await q("select count(*)::int n from audit_events where org_id = $1 and at > now() - interval '1 minute'", [org]))[0].n;
  assert.ok(n > 30, `lifecycle should be fully audited (${n} recent events)`);
});
