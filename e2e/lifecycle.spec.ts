// Full procurement cycle on a live deployment, driven through the real UI by
// four separate users so every segregation-of-duties rule is exercised.
// Creates a throwaway demo organisation and deletes it afterwards.
//
//   npm run test:e2e            (against https://cprocurement.dev)
//   E2E_BASE_URL=http://localhost:3000 npm run test:e2e
import { test, expect, type Page } from "@playwright/test";
import { cleanup, createUsers, makeUsers, signIn } from "./support";

const run = Date.now().toString(36);
const users = makeUsers(run);
const all = Object.values(users);
const problems: string[] = [];
const NAV = { waitUntil: "domcontentloaded" as const };
const pages: Partial<Record<keyof typeof users, Page>> = {};
let reqUrl = "", rfqUrl = "", poUrl = "", invoiceUrl = "";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

test.beforeAll(async () => { await createUsers(all); });
test.afterAll(async ({ browser }) => {
  test.setTimeout(180_000);
  await Promise.all(browser.contexts().map((c) => c.close()));
  await cleanup(all);
});
test.afterEach(() => {
  expect(problems, "no page errors or server errors").toEqual([]);
});

const ok = (page: Page, text: string | RegExp) => expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible();
const stepDone = (page: Page, label: string) => expect(page.locator(".step.done", { hasText: label })).toBeVisible();

test("officer creates a demo organisation and invites three colleagues", async ({ browser }) => {
  const p = (pages.officer = await signIn(browser, users.officer, problems));
  await expect(p).toHaveURL(/\/onboarding/);
  await p.getByLabel("Your name").fill(users.officer.name);
  await p.getByRole("button", { name: "Load demo organisation" }).click();
  await expect(p.getByRole("heading", { name: "Management dashboard" })).toBeVisible();

  await p.goto("/settings", NAV);
  const invite = p.locator("section").filter({ has: p.getByRole("heading", { name: "Invite a member" }) });
  const roles: Record<string, string[]> = { head: ["approver"], manager: ["approver", "receiver"], finance: ["finance"] };
  for (const key of ["head", "manager", "finance"] as const) {
    const u = users[key];
    await invite.getByLabel("Email", { exact: true }).fill(u.email);
    await invite.getByLabel("Name", { exact: true }).fill(u.name);
    await invite.getByLabel("Job title").fill(u.title);
    for (const r of roles[key]) await invite.locator(`#inv-${r}`).check();
    await invite.getByRole("button", { name: "Invite" }).click();
    const pending = p.locator("section").filter({ has: p.getByRole("heading", { name: "Pending invitations" }) });
    await expect(pending.getByText(u.email)).toBeVisible();
  }
});

test("invited colleagues join automatically on first sign-in", async ({ browser }) => {
  for (const key of ["head", "manager", "finance"] as const) {
    const p = (pages[key] = await signIn(browser, users[key], problems));
    await expect(p.getByRole("heading", { name: "Management dashboard" })).toBeVisible();
  }
});

test("requisition: create with attachment, two-level approval, SoD on requester", async () => {
  const p = pages.officer!;
  await p.goto("/requisitions/new", NAV);
  // The form is a client component: wait until it is hydrated (adding lines works)
  // before choosing values, or React resets the controlled selects.
  await expect(async () => {
    await p.getByRole("button", { name: "Add line" }).click();
    await expect(p.getByLabel("Line 3 description")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await p.getByLabel("Title", { exact: true }).fill(`E2E office furniture ${run}`);
  await p.getByLabel("Department").selectOption({ label: "Administration" });
  await p.getByLabel("Project", { exact: true }).selectOption({ label: "Project 01" });
  await p.getByLabel("Donor or funding source").selectOption({ label: "Donor A" });
  const lines = [["Office desk", "12", "310.00"], ["Office chair", "12", "145.00"], ["Filing cabinet", "4", "180.00"]];
  for (const [i, [d, q, c]] of lines.entries()) {
    await p.getByLabel(`Line ${i + 1} description`).fill(d);
    await p.getByLabel(`Line ${i + 1} quantity`).fill(q);
    await p.getByLabel(`Line ${i + 1} unit cost`).fill(c);
  }
  await expect(p.getByText("6,180.00").first()).toBeVisible();
  await p.getByRole("button", { name: "Submit for approval" }).click();
  await p.waitForURL(/\/requisitions\/[0-9a-f-]{36}$/);
  reqUrl = p.url();
  await expect(p.getByText("segregation of duties prevents you from approving it")).toBeVisible();

  await p.getByLabel("File to attach").setInputFiles({ name: "quotation.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% e2e\n") });
  await p.getByRole("button", { name: "Upload" }).click();
  await ok(p, "quotation.pdf attached");
  const href = await p.getByRole("link", { name: "Open" }).first().getAttribute("href");
  const file = await p.request.get(href!, { maxRedirects: 0 });
  expect(file.status(), "attachment download redirects to a signed URL").toBe(307);

  for (const [key, level] of [["head", 1], ["manager", 2]] as const) {
    const a = pages[key]!;
    await a.goto(reqUrl, NAV);
    await a.getByRole("button", { name: `Approve level ${level}` }).click();
    await expect(a.getByText(`Level ${level} approved`)).toBeVisible();
  }
  await p.reload(NAV);
  await expect(p.getByText("Approved", { exact: true }).first()).toBeVisible();
});

test("sourcing: RFQ, invites, sealed bids, close, panel scores, award", async () => {
  const p = pages.officer!;
  await p.goto(reqUrl, NAV);
  const closes = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 16);
  await p.getByLabel("Bids close").fill(closes);
  await p.getByLabel("Delivery location").fill("Field office");
  await p.getByRole("button", { name: "Create RFQ" }).click();
  await p.waitForURL(/\/rfqs\/[0-9a-f-]{36}$/);
  rfqUrl = p.url();

  for (const vendor of ["Vendor A Ltd", "Vendor C Trading", "Vendor D Medical"]) {
    await p.getByLabel("Vendor to invite").selectOption({ label: vendor });
    await p.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(p.getByRole("row").filter({ hasText: vendor })).toBeVisible();
  }
  await p.getByRole("button", { name: "Open for bids" }).click();
  await expect(p.getByRole("heading", { name: "Record a bid" })).toBeVisible();

  const bids: [string, string, number[]][] = [
    ["Vendor A Ltd", "6000.00", [25, 14, 8.6, 10]],
    ["Vendor C Trading", "6100.00", [25, 12, 5, 10]],
    ["Vendor D Medical", "6200.00", [20, 10, 5, 10]],
  ];
  const criteria = ["Compliance with specifications", "Delivery lead time", "Vendor past performance", "Validity of licences and documents"];
  for (const [n, [vendor, total, scores]] of bids.entries()) {
    await p.getByLabel("Vendor", { exact: true }).selectOption({ label: vendor });
    await p.getByLabel("Quoted total, USD").fill(total);
    for (const [i, c] of criteria.entries()) await p.getByLabel(`Score for ${c}`).fill(String(scores[i]));
    await p.getByRole("button", { name: "Record bid" }).click();
    await expect(p.getByText("Bid received", { exact: true })).toHaveCount(n + 1);
  }
  await p.getByRole("button", { name: "Close bidding" }).click();
  await expect(p.getByRole("link", { name: "Bid comparison" })).toBeVisible();

  await p.getByRole("link", { name: "Bid comparison" }).click();
  await expect(p.getByRole("heading", { name: "Evaluation panel" })).toBeVisible();
  const scoreButtons = p.getByRole("button", { name: "Record scores" });
  await expect(scoreButtons).toHaveCount(3);   // Procurement Officer, Technical Lead, Finance Officer
  for (let left = 3; left > 0; left--) {
    await scoreButtons.first().click();
    await expect(scoreButtons).toHaveCount(left - 1);
  }
  await expect(p.getByText("Recommended")).toBeVisible();
  await p.getByRole("button", { name: "Submit award recommendation" }).click();
  await expect(p.getByRole("button", { name: "Draft purchase order" })).toBeVisible();
});

test("purchase order: drafted from award, approved by another person, issued", async () => {
  const p = pages.officer!;
  await p.getByRole("button", { name: "Draft purchase order" }).click();
  await p.waitForURL(/\/purchase-orders\/[0-9a-f-]{36}$/);
  poUrl = p.url();
  await expect(p.getByText("another approver must approve it")).toBeVisible();
  await expect(p.getByRole("button", { name: "Approve order" })).toHaveCount(0);

  const head = pages.head!;
  await head.goto(poUrl, NAV);
  await head.getByRole("button", { name: "Approve order" }).click();
  await stepDone(head, "Approved");

  await p.reload(NAV);
  await p.getByRole("button", { name: "Issue to vendor" }).click();
  await stepDone(p, "Issued");
  await expect(p.getByText("You raised this order, so a different receiver")).toBeVisible();
});

test("goods receipt by a separate receiver", async () => {
  const m = pages.manager!;
  await m.goto(poUrl, NAV);
  await m.getByRole("button", { name: "Start goods receipt" }).click();
  await m.waitForURL(/\/goods-receipts\/[0-9a-f-]{36}$/);
  await m.getByRole("button", { name: "Accept and sign" }).click();
  await expect(m.getByText("Accepted", { exact: true }).first()).toBeVisible();
  await m.goto(poUrl, NAV);
  await stepDone(m, "Fully received");
});

test("invoice: registered and matched, approved by a third person, paid; PO closes", async () => {
  const f = pages.finance!;
  await f.goto(poUrl, NAV);
  await f.getByRole("link", { name: "Register invoice" }).click();
  await f.getByLabel("Supplier invoice number").fill(`E2E-${run}`);
  await f.getByRole("button", { name: "Register and match" }).click();
  await f.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
  invoiceUrl = f.url();
  await expect(f.getByText("All matching rules passed")).toBeVisible();

  // The registrar may not approve their own invoice.
  await f.getByLabel("Reason (recorded in audit trail)").fill("Self-approval attempt");
  await f.getByRole("button", { name: "Send to finance approval" }).click();
  await expect(f.locator(".error[role=alert]")).toContainText("you registered this invoice");

  const p = pages.officer!;
  await p.goto(invoiceUrl, NAV);
  await p.getByLabel("Reason (recorded in audit trail)").fill("Matched in full");
  await p.getByRole("button", { name: "Send to finance approval" }).click();
  await expect(p.getByText("Approved for payment", { exact: true }).first()).toBeVisible();

  await f.reload(NAV);
  await f.getByLabel("Payment reference").fill(`BANK-${run}`);
  await f.getByRole("button", { name: "Record payment" }).click();
  await expect(f.getByText(`reference BANK-${run}`)).toBeVisible();

  await p.goto(poUrl, NAV);
  await stepDone(p, "Closed");
});

test("dashboard, audit trail and report export reflect the cycle", async () => {
  const p = pages.officer!;
  await p.goto("/", NAV);
  await expect(p.getByRole("heading", { name: "Management dashboard" })).toBeVisible();
  await p.goto(`/audit?q=${encodeURIComponent(`E2E-${run}`)}`);
  await expect(p.getByText("Invoice registered").first()).toBeVisible();
  await p.goto("/audit?q=Payment", NAV);
  await expect(p.getByText("Payment recorded").first()).toBeVisible();
  const csv = await p.request.get("/reports/export");
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("Project,Requisitions,POs");
});
