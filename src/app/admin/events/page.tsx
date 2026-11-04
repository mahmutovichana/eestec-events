import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/session";
import { fmtDateRange, STATUS_LABEL } from "@/lib/util";

export const metadata = { title: "Događaji" };

export default async function Events({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  await requireAdminPage("/admin/events");
  const { q = "", status = "" } = await searchParams;
  const valid = ["DRAFT", "PUBLISHED", "COMPLETED", "ARCHIVED"].includes(status) ? (status as "DRAFT") : undefined;
  const events = await db.project.findMany({
    where: { ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] } : {}), ...(valid ? { status: valid } : {}) },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { agendas: true, polls: true, forms: true } } },
  });
  return (
    <>
      <div className="page-h"><div><h1>Događaji</h1><p>Projekti poput JobFair 2027, HOBOM 2027 ili General Assembly.</p></div><Link href="/admin/events/new" className="btn">Novi događaj</Link></div>
      <form className="filters" role="search">
        <label className="f" style={{ flex: 1, margin: 0 }}>Pretraga<input type="text" name="q" defaultValue={q} placeholder="Naziv ili link" /></label>
        <label className="f" style={{ margin: 0 }}>Status
          <select name="status" defaultValue={status}>
            <option value="">Svi</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <button className="btn ghost">Filtriraj</button>
      </form>
      {events.length === 0 ? (
        <div className="empty"><h2>{q || valid ? "Nema rezultata" : "Još nema događaja"}</h2><p>{q || valid ? "Promijeni pretragu ili filter." : "Kreiraj prvi događaj."}</p></div>
      ) : (
        <div className="projects">
          {events.map((p) => (
            <Link key={p.id} href={`/admin/events/${p.id}`} className="pcard">
              <span className={"pill " + p.status}>{STATUS_LABEL[p.status]}</span>
              <h2>{p.name}</h2>
              <p>{[fmtDateRange(p.startsAt, p.endsAt), p.location].filter(Boolean).join(" · ") || "Bez datuma"}</p>
              <p>/e/{p.slug} · {p._count.agendas} agende · {p._count.polls} ankete · {p._count.forms} feedback</p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
