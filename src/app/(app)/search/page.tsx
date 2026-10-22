import Link from "next/link";
import { getContext } from "@/lib/context";
import { Card, PageHead, Topbar } from "@/components/ui";

export const metadata = { title: "Search" };

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const term = q.replace(/[%,()"\*:]/g, " ").trim().slice(0, 80);
  const { supabase, orgId } = await getContext();

  const like = `%${term}%`;
  const [reqs, pos, vendors, rfqs, invoices] = term
    ? await Promise.all([
        supabase.from("requisitions").select("id, number, title").eq("org_id", orgId).or(`number.ilike.${like},title.ilike.${like}`).limit(10),
        supabase.from("purchase_orders").select("id, number, title").eq("org_id", orgId).or(`number.ilike.${like},title.ilike.${like}`).limit(10),
        supabase.from("vendors").select("id, number, trading_name").eq("org_id", orgId).or(`number.ilike.${like},trading_name.ilike.${like},legal_name.ilike.${like}`).limit(10),
        supabase.from("rfqs").select("id, number, title").eq("org_id", orgId).or(`number.ilike.${like},title.ilike.${like}`).limit(10),
        supabase.from("invoices").select("id, number, vendor_ref").eq("org_id", orgId).or(`number.ilike.${like},vendor_ref.ilike.${like}`).limit(10),
      ])
    : [];

  const groups = [
    { title: "Requisitions", href: "/requisitions", rows: (reqs?.data ?? []).map((r) => [r.id, r.number, r.title]) },
    { title: "Purchase orders", href: "/purchase-orders", rows: (pos?.data ?? []).map((r) => [r.id, r.number, r.title]) },
    { title: "Vendors", href: "/vendors", rows: (vendors?.data ?? []).map((r) => [r.id, r.number, r.trading_name]) },
    { title: "RFQs", href: "/rfqs", rows: (rfqs?.data ?? []).map((r) => [r.id, r.number, r.title]) },
    { title: "Invoices", href: "/invoices", rows: (invoices?.data ?? []).map((r) => [r.id, r.number, r.vendor_ref]) },
  ].filter((g) => g.rows.length);

  return (
    <>
      <Topbar crumbs={[{ label: "Search" }]} />
      <div className="content">
        <PageHead title="Search" sub={term ? `Results for "${term}"` : "Type in the search box above."} />
        {groups.map((g) => (
          <Card key={g.title} title={g.title}>
            <div className="rows">
              {g.rows.map(([id, number, label]) => (
                <Link key={id} href={`${g.href}/${id}`}><span><strong>{number}</strong> {label}</span><span className="link">Open</span></Link>
              ))}
            </div>
          </Card>
        ))}
        {term && !groups.length && <Card><div className="empty">Nothing matched.</div></Card>}
      </div>
    </>
  );
}
