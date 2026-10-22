"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartColumn, ClipboardCheck, FilePlus, FileSearch, Files, LayoutDashboard, PackageCheck, ReceiptText,
  ScrollText, Settings, ShoppingCart, Store, type LucideIcon,
} from "lucide-react";

type Item = { href: string; label: string; icon: LucideIcon };
const SECTIONS: { title: string; items: Item[] }[] = [
  { title: "Overview", items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    title: "Requisitions",
    items: [
      { href: "/requisitions/new", label: "New requisition", icon: FilePlus },
      { href: "/approvals", label: "Approval queue", icon: ClipboardCheck },
      { href: "/requisitions", label: "All requisitions", icon: Files },
    ],
  },
  { title: "Vendors", items: [{ href: "/vendors", label: "Vendor register", icon: Store }] },
  { title: "Sourcing", items: [{ href: "/rfqs", label: "Requests for quotation", icon: FileSearch }] },
  {
    title: "Purchasing",
    items: [
      { href: "/purchase-orders", label: "Purchase orders", icon: ShoppingCart },
      { href: "/goods-receipts", label: "Goods received notes", icon: PackageCheck },
      { href: "/invoices", label: "Invoice matching", icon: ReceiptText },
    ],
  },
  {
    title: "Governance",
    items: [
      { href: "/reports", label: "Reports and exports", icon: ChartColumn },
      { href: "/audit", label: "Audit log", icon: ScrollText },
    ],
  },
];
const ADMIN: Item = { href: "/settings", label: "Settings", icon: Settings };

export function Nav({ counts, isAdmin }: { counts: Record<string, number>; isAdmin: boolean }) {
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
      {(isAdmin ? [...SECTIONS.slice(0, -1), { ...SECTIONS.at(-1)!, items: [...SECTIONS.at(-1)!.items, ADMIN] }] : SECTIONS).map((s) => (
        <div key={s.title}>
          <div className="nav-section">{s.title}</div>
          {s.items.map((item) => {
            const count = counts[item.href];
            return (
              <Link key={item.href} href={item.href} className={`nav-link ${isActive(item) ? "active" : ""}`}>
                <item.icon size={17} strokeWidth={1.8} aria-hidden />
                <span className="nav-label">{item.label}</span>
                {count ? <span className="nav-count">{count}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
