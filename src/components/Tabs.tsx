"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function Tabs({ base }: { base: string }) {
  const path = usePathname();
  const items = [
    { href: base, label: "Agenda", on: path === base || path.startsWith(base + "/agenda") },
    { href: base + "/lunch", label: "Lunch Poll", on: path.startsWith(base + "/lunch") },
    { href: base + "/feedback", label: "Feedback", on: path.startsWith(base + "/feedback") },
  ];
  return (
    <nav className="tabs wrap" aria-label="Sekcije događaja">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={"tab" + (i.on ? " on" : "")} aria-current={i.on ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
