/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { requireAdminPage } from "@/lib/session";
import { AdminNav } from "@/components/AdminNav";
import { ToastProvider } from "@/components/Toast";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Admin", template: "%s · Admin" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdminPage("/admin");
  return (
    <ToastProvider>
      <div className="shell">
        <aside className="side">
          <Link href="/admin" className="brand">
            <img src="/eestec-logo.png" alt="EESTEC LC Sarajevo" />
            <span>Events</span>
          </Link>
          <AdminNav />
          <div className="side-foot">
            <Link href="/">Javni portal</Link>
            <div className="who"><b>{user.name}</b><span>{user.email}</span></div>
            <a href="/auth/logout">Odjavi se</a>
          </div>
        </aside>
        <main className="content" id="main">{children}</main>
      </div>
    </ToastProvider>
  );
}
