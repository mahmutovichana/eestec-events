import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/session";
import { STATUS_LABEL } from "@/lib/util";
import { EventTabs } from "@/components/AdminNav";
import { StatusSelect } from "@/components/StatusSelect";
import { CopyLink } from "@/components/CopyLink";

export default async function EventLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminPage(`/admin/events/${id}`);
  const p = await db.project.findUnique({ where: { id } });
  if (!p) notFound();
  return (
    <>
      <p className="crumb"><Link href="/admin/events">Događaji</Link> / {p.name}</p>
      <div className="page-h">
        <div>
          <span className={"pill " + p.status}>{STATUS_LABEL[p.status]}</span>
          <h1>{p.name}</h1>
          <p>/e/{p.slug}</p>
        </div>
        <div className="actions">
          <StatusSelect id={p.id} status={p.status} />
          <Link href={`/e/${p.slug}`} target="_blank" className="btn ghost sm">{p.status === "DRAFT" ? "Pregled prije objave" : "Otvori javnu stranicu"}</Link>
          <CopyLink path={`/e/${p.slug}`} label="Kopiraj javni link" />
        </div>
      </div>
      <EventTabs id={id} />
      {children}
    </>
  );
}
