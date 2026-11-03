"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin", label: "Pregled", match: (p: string) => p === "/admin" },
  { href: "/admin/events", label: "Događaji", match: (p: string) => p.startsWith("/admin/events") },
  { href: "/admin/participants", label: "Učesnici", match: (p: string) => p.startsWith("/admin/participants") },
  { href: "/admin/settings", label: "Postavke", match: (p: string) => p.startsWith("/admin/settings") },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="side-nav" aria-label="Admin navigacija">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.match(path) ? "page" : undefined} className={i.match(path) ? "on" : ""}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function EventTabs({ id }: { id: string }) {
  const path = usePathname();
  const base = `/admin/events/${id}`;
  const items = [
    { href: base, label: "Postavke", on: path === base },
    { href: base + "/agendas", label: "Agende", on: path.startsWith(base + "/agendas") },
    { href: base + "/lunch", label: "Lunch Poll", on: path.startsWith(base + "/lunch") },
    { href: base + "/feedback", label: "Feedback", on: path.startsWith(base + "/feedback") },
  ];
  return (
    <nav className="subtabs" aria-label="Sekcije događaja">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={i.on ? "on" : ""} aria-current={i.on ? "page" : undefined}>{i.label}</Link>
      ))}
    </nav>
  );
}
