import Link from "next/link";
import { getContext } from "@/lib/context";
import { Card, PageHead, StatusBadge, Topbar } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { addVendor } from "../actions";
import { daysUntil } from "@/lib/format";

export const metadata = { title: "Vendors" };

export default async function Vendors() {
  const { supabase, orgId, can } = await getContext();
  const { data: vendors } = await supabase
    .from("vendors")
    .select("id, number, trading_name, legal_name, status, categories, vendor_documents(expires_on)")
    .eq("org_id", orgId)
    .order("number")
    .limit(500);

  return (
    <>
      <Topbar crumbs={[{ label: "Vendors" }, { label: "Vendor register" }]} />
      <div className="content">
        <PageHead title="Vendor register" sub="Only approved vendors with valid documents can be invited to sourcing events." />
        <div className="grid g-main">
          <Card className="flush">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Vendor</th><th>Name</th><th>Categories</th><th>Documents</th><th>Status</th></tr></thead>
                <tbody>
                  {(vendors ?? []).map((v) => {
                    const dated = v.vendor_documents.filter((d) => d.expires_on).map((d) => daysUntil(d.expires_on!));
                    const expired = dated.filter((n) => n < 0).length;
                    const expiring = dated.filter((n) => n >= 0 && n <= 30).length;
                    return (
                      <tr key={v.id}>
                        <td><Link className="rowlink" href={`/vendors/${v.id}`}>{v.number}</Link></td>
                        <td>{v.trading_name}</td>
                        <td className="muted">{v.categories}</td>
                        <td>
                          {expired > 0 ? <StatusBadge status="expired" label={`${expired} expired`} />
                            : expiring > 0 ? <StatusBadge status="expiring" label={`${expiring} expiring`} />
                            : <StatusBadge status="valid" label="Valid" />}
                        </td>
                        <td><StatusBadge status={v.status} /></td>
                      </tr>
                    );
                  })}
                  {!vendors?.length && <tr><td colSpan={5} className="empty">No vendors registered yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
          {can("buyer") && (
            <Card title="Register a vendor">
              <ActionForm action={addVendor}>
                <div style={{ display: "grid", gap: 12 }}>
                  <div><label className="lbl" htmlFor="legal_name">Legal name</label><input className="input" id="legal_name" name="legal_name" required /></div>
                  <div><label className="lbl" htmlFor="trading_name">Trading name</label><input className="input" id="trading_name" name="trading_name" /></div>
                  <div><label className="lbl" htmlFor="categories">Categories</label><input className="input" id="categories" name="categories" placeholder="Medical supplies, stationery" /></div>
                  <div className="form-grid">
                    <div><label className="lbl" htmlFor="registration_no">Registration no.</label><input className="input" id="registration_no" name="registration_no" /></div>
                    <div><label className="lbl" htmlFor="tax_id">Tax ID</label><input className="input" id="tax_id" name="tax_id" /></div>
                  </div>
                  <div><label className="lbl" htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" /></div>
                  <div><Submit primary>Register vendor</Submit></div>
                  <p className="help" style={{ margin: 0 }}>New vendors start as pending until an administrator approves them.</p>
                </div>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
