import { getContext } from "@/lib/context";
import { Badge, Card, PageHead, Topbar } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import {
  addApprovalRule, addBudgetLine, addReference, deleteApprovalRule, inviteMember, removeMember,
  setBudgetAmount, setMemberRoles, setOrgControls,
} from "../actions";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { activateLicense } from "../../activate/actions";

export const metadata = { title: "Settings" };

const ROLES = ["requester", "approver", "buyer", "receiver", "finance", "admin"] as const;
const ROLE_HELP: Record<string, string> = {
  requester: "raise requisitions", approver: "approve requisitions and POs", buyer: "run sourcing and draft POs",
  receiver: "record goods receipts", finance: "register, approve and pay invoices; finance-level approvals",
  admin: "settings, members, budgets",
};

function RoleChecks({ selected = [], idPrefix }: { selected?: string[]; idPrefix: string }) {
  return (
    <div className="radio-row" style={{ marginTop: 6, gap: 14 }}>
      {ROLES.map((r) => (
        <label key={r} title={ROLE_HELP[r]} htmlFor={`${idPrefix}-${r}`}>
          <input type="checkbox" id={`${idPrefix}-${r}`} name="roles" value={r} defaultChecked={selected.includes(r)} /> {r}
        </label>
      ))}
    </div>
  );
}

export default async function Settings() {
  const { supabase, orgId, user, can, member, licensedUntil } = await getContext();
  if (!can("admin")) {
    return (
      <>
        <Topbar crumbs={[{ label: "Settings" }]} />
        <div className="content"><PageHead title="Settings" /><Card><p style={{ margin: 0 }}>Only administrators can change settings.</p></Card></div>
      </>
    );
  }

  const [org, members, invites, departments, projects, donors, budgets, rules] = await Promise.all([
    supabase.from("orgs").select("*").eq("id", orgId).single(),
    supabase.from("members").select("user_id, display_name, title, roles").eq("org_id", orgId).order("display_name"),
    supabase.from("member_invites").select("*").eq("org_id", orgId).is("accepted_at", null).order("created_at"),
    supabase.from("departments").select("id, name, head_title").eq("org_id", orgId).order("name"),
    supabase.from("projects").select("id, name, manager_title").eq("org_id", orgId).order("name"),
    supabase.from("donors").select("id, name").eq("org_id", orgId).order("name"),
    supabase.from("budget_lines").select("*, departments(name), projects(name), donors(name)").eq("org_id", orgId).order("code"),
    supabase.from("approval_rules").select("*").eq("org_id", orgId).order("level"),
  ]);
  const o = org.data;

  return (
    <>
      <Topbar crumbs={[{ label: "Settings" }]} />
      <div className="content">
        <PageHead title="Settings" sub="Every change on this page is recorded in the audit log." />

        <section id="license" style={{ scrollMarginTop: 80 }}>
          <Card title="License" note={`Licensed until ${formatDate(licensedUntil)}`}>
            <div className="table-wrap" style={{ marginBottom: 16 }}>
              <table className="table">
                <thead><tr><th>Key ending</th><th>Term</th><th>From</th><th>Until</th><th>Status</th></tr></thead>
                <tbody>
                  {[...(member.orgs?.licenses ?? [])].sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at))).map((l) => {
                    const now = Date.now();
                    const status = l.revoked_at ? "cancelled" : Date.parse(l.expires_at!) <= now ? "expired"
                      : Date.parse(l.starts_at!) > now ? "pending" : "valid";
                    return (
                      <tr key={l.key_hint + l.starts_at}>
                        <td style={{ fontFamily: "ui-monospace, monospace" }}>…{l.key_hint}</td><td>{l.term_months} months</td>
                        <td>{formatDate(l.starts_at)}</td><td>{formatDate(l.expires_at)}</td>
                        <td><Badge tone={status === "valid" ? "green" : status === "pending" ? "grey" : "red"}>
                          {status === "valid" ? "Active" : status === "pending" ? "Starts later" : status === "expired" ? "Expired" : "Revoked"}
                        </Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ActionForm action={activateLicense} className="actions" style={{ alignItems: "flex-end" }}>
              <input type="hidden" name="from" value="settings" />
              <div style={{ flex: "1 1 320px" }}><label className="lbl" htmlFor="license_key">Renewal key</label>
                <input className="input" id="license_key" name="license_key" placeholder="CPRO-XXXXX-XXXXX-XXXXX-XXXXX" autoComplete="off" spellCheck={false} required /></div>
              <Submit primary>Activate renewal</Submit>
              <a className="btn" href="/pricing">Pricing</a>
            </ActionForm>
          </Card>
        </section>

        <Card title="Procurement controls">
          <ActionForm action={setOrgControls} className="actions" style={{ alignItems: "flex-end" }}>
            <div><label className="lbl" htmlFor="direct_po_limit">Direct purchase limit, USD</label>
              <input className="input num-in" id="direct_po_limit" name="direct_po_limit" defaultValue={(Number(o.direct_po_limit_minor) / 100).toFixed(2)} /></div>
            <div><label className="lbl" htmlFor="tolerance">PO over requisition tolerance, %</label>
              <input className="input num-in" id="tolerance" name="tolerance" type="number" min={0} max={50} defaultValue={o.po_tolerance_pct} /></div>
            <div><label className="lbl" htmlFor="min_vendors">Minimum vendors per RFQ</label>
              <input className="input num-in" id="min_vendors" name="min_vendors" type="number" min={1} max={10} defaultValue={o.min_rfq_vendors} /></div>
            <Submit primary>Save controls</Submit>
          </ActionForm>
        </Card>

        <div className="grid g-main-wide">
          <Card title="Members" note="Segregation of duties works best when each role is held by different people.">
            <div className="stack" style={{ gap: 14 }}>
              {(members.data ?? []).map((m) => (
                <div key={m.user_id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 12 }}>
                  <ActionForm action={setMemberRoles}>
                    <input type="hidden" name="user_id" value={m.user_id} />
                    <div className="actions" style={{ justifyContent: "space-between" }}>
                      <strong>{m.display_name}{m.user_id === user.id ? " (you)" : ""}</strong>
                      <input className="input" name="title" defaultValue={m.title} aria-label={`Job title for ${m.display_name}`} style={{ maxWidth: 220 }} />
                    </div>
                    <RoleChecks selected={m.roles} idPrefix={`m-${m.user_id}`} />
                    <div className="actions" style={{ marginTop: 8 }}><Submit small>Save roles</Submit></div>
                  </ActionForm>
                  {m.user_id !== user.id && (
                    <ActionForm action={removeMember} style={{ marginTop: 6 }}>
                      <input type="hidden" name="user_id" value={m.user_id} />
                      <button className="link" type="submit">Remove from organisation</button>
                    </ActionForm>
                  )}
                </div>
              ))}
            </div>
          </Card>
          <div className="stack">
            <Card title="Invite a member">
              <ActionForm action={inviteMember}>
                <div style={{ display: "grid", gap: 10 }}>
                  <div><label className="lbl" htmlFor="inv_email">Email</label><input className="input" id="inv_email" name="email" type="email" required /></div>
                  <div className="form-grid">
                    <div><label className="lbl" htmlFor="inv_name">Name</label><input className="input" id="inv_name" name="display_name" required /></div>
                    <div><label className="lbl" htmlFor="inv_title">Job title</label><input className="input" id="inv_title" name="title" placeholder="Finance Officer" /></div>
                  </div>
                  <div><span className="lbl">Roles</span><RoleChecks idPrefix="inv" selected={["requester"]} /></div>
                  <div><Submit primary>Invite</Submit></div>
                  <p className="help" style={{ margin: 0 }}>They join automatically after creating an account with this email address. Send them the app link yourself.</p>
                </div>
              </ActionForm>
            </Card>
            {!!invites.data?.length && (
              <Card title="Pending invitations">
                <div className="rows">
                  {invites.data.map((i) => (
                    <div key={i.id}><span>{i.display_name} · {i.email}</span><span className="card-note">{i.roles.join(", ")} · {formatDate(i.created_at)}</span></div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>

        <div className="grid g-3">
          {([
            ["department", "Departments", departments.data ?? [], "Head of department title"],
            ["project", "Projects", projects.data ?? [], "Budget holder title"],
            ["donor", "Donors and funding sources", donors.data ?? [], null],
          ] as const).map(([kind, title, rows, titleLabel]) => (
            <Card key={kind} title={title}>
              <div className="rows">
                {rows.map((r: { id: string; name: string; head_title?: string; manager_title?: string }) => (
                  <div key={r.id}><span>{r.name}</span><span className="card-note">{r.head_title ?? r.manager_title ?? ""}</span></div>
                ))}
                {!rows.length && <div className="empty">None yet.</div>}
              </div>
              <ActionForm action={addReference} style={{ marginTop: 12 }}>
                <input type="hidden" name="kind" value={kind} />
                <div style={{ display: "grid", gap: 8 }}>
                  <input className="input" name="name" placeholder="Name" aria-label={`New ${kind} name`} required />
                  {titleLabel && <input className="input" name="title" placeholder={titleLabel} aria-label={titleLabel} />}
                  <div><Submit small>Add {kind}</Submit></div>
                </div>
              </ActionForm>
            </Card>
          ))}
        </div>

        <Card title="Budget lines" note="Requisitions are charged to the line matching their department, project and donor.">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Code</th><th>Department</th><th>Project</th><th>Donor</th><th className="num">Budget</th><th className="num">Committed</th><th className="num">Paid</th><th className="num">Available</th><th>Revise</th></tr></thead>
              <tbody>
                {(budgets.data ?? []).map((b) => (
                  <tr key={b.id}>
                    <td><strong>{b.code}</strong></td>
                    <td>{b.departments?.name}</td>
                    <td>{b.projects?.name ?? "Core"}</td>
                    <td>{b.donors?.name}</td>
                    <td className="num">{formatMoney(b.amount_minor)}</td>
                    <td className="num">{formatMoney(b.committed_minor)}</td>
                    <td className="num">{formatMoney(b.spent_minor)}</td>
                    <td className="num">{formatMoney(Number(b.amount_minor) - Number(b.committed_minor))}</td>
                    <td>
                      <ActionForm action={setBudgetAmount} className="actions" style={{ flexWrap: "nowrap" }}>
                        <input type="hidden" name="id" value={b.id} />
                        <input className="input num-in" name="amount" placeholder="New amount" aria-label={`New amount for ${b.code}`} style={{ width: 120 }} />
                        <input className="input" name="reason" placeholder="Reason" aria-label={`Reason for revising ${b.code}`} style={{ width: 140 }} />
                        <Submit small>Revise</Submit>
                      </ActionForm>
                    </td>
                  </tr>
                ))}
                {!budgets.data?.length && <tr><td colSpan={9} className="empty">No budget lines yet. Add departments, projects and donors first.</td></tr>}
              </tbody>
            </table>
          </div>
          <ActionForm action={addBudgetLine} className="actions" style={{ marginTop: 14, alignItems: "flex-end" }}>
            <div><label className="lbl" htmlFor="bl_code">Code</label><input className="input" id="bl_code" name="code" placeholder="ADM-01-4200" required style={{ width: 140 }} /></div>
            <div><label className="lbl" htmlFor="bl_dept">Department</label>
              <select className="input" id="bl_dept" name="department_id" required defaultValue=""><option value="" disabled>Choose…</option>{departments.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <div><label className="lbl" htmlFor="bl_proj">Project</label>
              <select className="input" id="bl_proj" name="project_id" defaultValue=""><option value="">None (core)</option>{projects.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <div><label className="lbl" htmlFor="bl_donor">Donor</label>
              <select className="input" id="bl_donor" name="donor_id" required defaultValue=""><option value="" disabled>Choose…</option>{donors.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <div><label className="lbl" htmlFor="bl_amount">Amount, USD</label><input className="input num-in" id="bl_amount" name="amount" required style={{ width: 140 }} /></div>
            <Submit primary>Add budget line</Submit>
          </ActionForm>
        </Card>

        <Card title="Approval routing" note="Applies to requisitions submitted after a change. {department_head} and {project_manager} are filled in from the requisition.">
          <table className="table">
            <thead><tr><th>Level</th><th>Step</th><th>Approver</th><th>Required role</th><th>Applies when</th><th /></tr></thead>
            <tbody>
              {(rules.data ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{r.level}</td>
                  <td>{r.label}</td>
                  <td>{r.approver_title}</td>
                  <td><Badge>{r.required_role}</Badge></td>
                  <td className="muted">
                    {[r.min_value_minor !== null && `value above USD ${formatMoney(r.min_value_minor)}`, r.category && `category is ${r.category}`]
                      .filter(Boolean).join(", ") || "Always"}
                  </td>
                  <td className="num">
                    <ActionForm action={deleteApprovalRule}><input type="hidden" name="id" value={r.id} /><button className="link" type="submit">Remove</button></ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ActionForm action={addApprovalRule} className="actions" style={{ marginTop: 14, alignItems: "flex-end" }}>
            <div><label className="lbl" htmlFor="ar_label">Step</label><input className="input" id="ar_label" name="label" placeholder="Country Director" required /></div>
            <div><label className="lbl" htmlFor="ar_title">Approver title</label><input className="input" id="ar_title" name="approver_title" placeholder="Country Director" required /></div>
            <div><label className="lbl" htmlFor="ar_role">Required role</label>
              <select className="input" id="ar_role" name="required_role" defaultValue="approver"><option>approver</option><option>finance</option><option>admin</option></select></div>
            <div><label className="lbl" htmlFor="ar_min">Only above, USD</label><input className="input num-in" id="ar_min" name="min_value" placeholder="optional" style={{ width: 120 }} /></div>
            <div><label className="lbl" htmlFor="ar_cat">Only for category</label><input className="input" id="ar_cat" name="category" placeholder="optional" style={{ width: 150 }} /></div>
            <Submit>Add step</Submit>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
