"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; count?: number; match?: string };
const SECTIONS: { title: string; items: Item[] }[] = [
  { title: "Overview", items: [{ href: "/", label: "Dashboard" }] },
  {
    title: "Requisitions",
    items: [
      { href: "/requisitions/new", label: "New requisition" },
      { href: "/approvals", label: "Approval queue" },
      { href: "/requisitions", label: "All requisitions", match: "/requisitions/" },
    ],
  },
  { title: "Vendors", items: [{ href: "/vendors", label: "Vendor register" }] },
  { title: "Sourcing", items: [{ href: "/rfqs", label: "Requests for quotation" }] },
  {
    title: "Purchasing",
    items: [
      { href: "/purchase-orders", label: "Purchase orders" },
      { href: "/goods-receipts", label: "Goods received notes" },
      { href: "/invoices", label: "Invoice matching" },
    ],
  },
  {
    title: "Governance",
    items: [
      { href: "/reports", label: "Reports and exports" },
      { href: "/audit", label: "Audit log" },
    ],
  },
];

export function Nav({ counts }: { counts: Record<string, number> }) {
  const path = usePathname();
  const isActive = (item: Item) => {
    if (item.href === "/") return path === "/";
    if (path === item.href) return true;
    if (item.href === "/requisitions/new") return false;
    if (item.href === "/requisitions") return path.startsWith("/requisitions/") && path !== "/requisitions/new";
    return path.startsWith(item.href + "/");
  };

  return (
    <nav className="nav">
      {SECTIONS.map((s) => (
        <div key={s.title}>
          <div className="nav-section">{s.title}</div>
          {s.items.map((item) => {
            const count = counts[item.href];
            return (
              <Link key={item.href} href={item.href} className={`nav-link ${isActive(item) ? "active" : ""}`}>
                <span>{item.label}</span>
                {count ? <span className="nav-count">{count}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
