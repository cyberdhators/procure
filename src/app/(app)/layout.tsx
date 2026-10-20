import { getContext, getCounts } from "@/lib/context";
import { Nav } from "@/components/nav";
import { signOut } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, member, orgId } = await getContext();

  const [approvals, grns, exceptions] = await Promise.all([
    supabase.from("requisitions").select("*", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "submitted"),
    supabase.from("goods_receipts").select("*", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "draft"),
    supabase.from("invoices").select("*", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "exception"),
  ]);
  const counts = {
    "/approvals": approvals.count ?? 0,
    "/goods-receipts": grns.count ?? 0,
    "/invoices": exceptions.count ?? 0,
  };
  const initials = member.display_name.split(/[\s.]+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">CW</div>
          <div>
            <div className="brand-name">{(member.orgs?.name ?? "CORWADO").toUpperCase()}</div>
            <div className="brand-sub">E-PROCUREMENT</div>
          </div>
        </div>
        <Nav counts={counts} />
        <div className="user">
          <div className="avatar">{initials}</div>
          <div style={{ minWidth: 0 }}>
            <div className="user-name">{member.display_name}</div>
            <div className="user-sub">{member.office}</div>
          </div>
          <form action={signOut} style={{ marginLeft: "auto" }}>
            <button className="signout" type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="main">{children}</div>
    </div>
  );
}
