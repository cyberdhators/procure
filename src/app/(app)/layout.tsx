import { LogOut } from "lucide-react";
import { getContext, getCounts } from "@/lib/context";
import { Nav } from "@/components/nav";
import { signOut } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { member, can } = await getContext();
  const c = await getCounts();
  const counts = { "/approvals": c.approvals, "/goods-receipts": c.grns, "/invoices": c.exceptions };
  const initials = member.display_name.split(/[\s.]+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">CP</div>
          <div style={{ minWidth: 0 }}>
            <div className="brand-name">C-Procurement</div>
            <div className="brand-sub" title={member.orgs?.name}>{(member.orgs?.name ?? "").toUpperCase()}</div>
          </div>
        </div>
        <Nav counts={counts} isAdmin={can("admin")} />
        <div className="user">
          <div className="avatar">{initials}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="user-name">{member.display_name}</div>
            <div className="user-sub">{member.office}</div>
          </div>
          <form action={signOut}>
            <button className="signout" type="submit" aria-label="Sign out" title="Sign out">
              <LogOut size={16} strokeWidth={1.8} aria-hidden />
            </button>
          </form>
        </div>
      </aside>
      <div className="main">{children}</div>
    </div>
  );
}
