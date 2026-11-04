import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/session";
import { AForm } from "@/components/AForm";
import { createAgenda } from "../../../actions";

export const metadata = { title: "Agende" };

export default async function Agendas({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminPage(`/admin/events/${id}/agendas`);
  const p = await db.project.findUniqueOrThrow({
    where: { id },
    include: { agendas: { orderBy: { position: "asc" }, include: { _count: { select: { items: true } } } } },
  });
  return (
    <>
      {p.agendas.length === 0 ? (
        <div className="empty"><h2>Nema agendi</h2><p>Dodaj prvu agendu, na primjer jednu po danu događaja.</p></div>
      ) : (
        <div className="projects">
          {p.agendas.map((a) => (
            <Link key={a.id} href={`/admin/events/${id}/agendas/${a.id}`} className="pcard">
              <h2>{a.title}</h2>
              <p>{a.dateLabel || "bez datuma"} · {a._count.items} stavki</p>
              <p>/e/{p.slug}/agenda/{a.slug}</p>
            </Link>
          ))}
        </div>
      )}
      <AForm action={createAgenda} className="panel" resetOnSuccess>
        <h2>Nova agenda</h2>
        <p className="hint">Svaka agenda dobija svoj javni link.</p>
        <input type="hidden" name="projectId" value={id} />
        <div className="grid2">
          <label className="f">Naslov<input type="text" name="title" required maxLength={120} placeholder="Subota" /></label>
          <label className="f">Datum (tekst)<input type="text" name="dateLabel" placeholder="14. 11. 2026." /></label>
        </div>
        <button className="btn">Kreiraj agendu</button>
      </AForm>
    </>
  );
}
