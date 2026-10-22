"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Search } from "lucide-react";

export function SearchBox() {
  const ref = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      className="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = ref.current?.value.trim();
        if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
      }}
    >
      <Search size={15} strokeWidth={2} color="#626d66" aria-hidden />
      <input ref={ref} name="q" placeholder="Search records, POs, vendors" aria-label="Search" />
      <span className="kbd">Ctrl K</span>
    </form>
  );
}
