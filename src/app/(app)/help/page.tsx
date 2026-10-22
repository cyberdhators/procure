import { Card, PageHead, Topbar } from "@/components/ui";

export const metadata = { title: "Help" };

const FLOW = [
  ["Requisition", "A requester raises a requisition. Routing rules build the approval plan from value, category and funding."],
  ["Approval", "Each level approves, returns or rejects. Nobody may approve their own request or two levels of one request. Final approval commits the budget."],
  ["Sourcing", "Buyers invite approved vendors to an RFQ, answer clarifications, and the panel scores bids. Price scores are calculated automatically."],
  ["Purchase order", "The award becomes a versioned purchase order. Amendments create a new version; old versions stay readable."],
  ["Goods receipt", "A receiver, who must not be the PO's buyer, inspects deliveries and records discrepancies."],
  ["Invoice", "Finance matches the invoice against the PO and accepted receipts. Exceptions must be resolved with a recorded reason."],
];

export default function Help() {
  return (
    <>
      <Topbar crumbs={[{ label: "Help" }]} />
      <div className="content">
        <PageHead title="How Cyber Procurement works" sub="The procurement cycle and the controls applied at each step." />
        <div className="grid g-3">
          {FLOW.map(([title, body], i) => (
            <Card key={title} title={`${i + 1}. ${title}`}><p style={{ margin: 0 }}>{body}</p></Card>
          ))}
        </div>
        <Card title="Audit trail">
          <p style={{ margin: 0 }}>
            Every state change is written to an append-only audit log in the same database transaction as the change itself.
            The database rejects edits and deletions of audit entries.
          </p>
        </Card>
        <p className="help">Cyber Procurement (C-Procurement), developed by cyberdhators.</p>
      </div>
    </>
  );
}
