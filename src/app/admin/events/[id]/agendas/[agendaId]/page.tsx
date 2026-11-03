import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/session";
import { AForm } from "@/components/AForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { CopyLink } from "@/components/CopyLink";
import { ItemEditor } from "@/components/ItemEditor";
import { createItem, deleteAgenda, updateAgenda } from "../../../../actions";

export const metadata = { title: "Uređivanje agende" };

export default async function AgendaEditor({ params }: { params: Promise<{ id: string; agendaId: string }> }) {
  const { id, agendaId } = await params;
  await requireAdminPage(`/admin/events/${id}/agendas/${agendaId}`);
  const a = await db.agenda.findFirst({ where: { id: agendaId, projectId: id }, include: { project: true, items: { orderBy: { position: "asc" } } } });
  if (!a) notFound();
  const path = `/e/${a.project.slug}/agenda/${a.slug}`;
  return (
    <>
      <div className="actions" style={{ marginBottom: 14 }}>
        <Link href={`/admin/events/${id}/agendas`} className="btn ghost sm">← Sve agende</Link>
        <Link href={path} target="_blank" className="btn ghost sm">Otvori javnu agendu</Link>
        <CopyLink path={path} label="Kopiraj link agende" />
      </div>

      <AForm action={updateAgenda} className="panel" style={{ marginTop: 0 }}>
        <input type="hidden" name="id" value={a.id} />
        <div className="grid2">
          <label className="f">Naslov agende<input type="text" name="title" defaultValue={a.title} required maxLength={120} /></label>
          <label className="f">Datum (tekst)<input type="text" name="dateLabel" defaultValue={a.dateLabel} /></label>
        </div>
        <button className="btn sm">Sačuvaj agendu</button>
      </AForm>

      <h2 className="sect">Stavke <small>izmjene se čuvaju automatski · povuci ⠿ za redoslijed</small></h2>
      <ItemEditor
        agendaId={a.id}
        initial={a.items.map((i) => ({ id: i.id, startTime: i.startTime, endTime: i.endTime, title: i.title, description: i.description, speaker: i.speaker, location: i.location, notes: i.notes, kind: i.kind }))}
      />

      <AForm action={createItem} className="panel" resetOnSuccess>
        <h2>Nova stavka</h2>
        <input type="hidden" name="agendaId" value={a.id} />
        <div className="grid3">
          <label className="f">Početak<input type="time" name="startTime" required /></label>
          <label className="f">Kraj<input type="time" name="endTime" required /></label>
          <label className="f">Naslov<input type="text" name="title" required maxLength={200} /></label>
        </div>
        <div className="grid2">
          <label className="f">Govornik<input type="text" name="speaker" /></label>
          <label className="f">Lokacija<input type="text" name="location" /></label>
        </div>
        <label className="f">Opis<textarea name="description" style={{ minHeight: 56 }} /></label>
        <label className="f">Napomena<input type="text" name="notes" /></label>
        <div className="actions">
          <label className="f inline">Tip
            <select name="kind" defaultValue="SESSION"><option value="SESSION">Sesija</option><option value="TALK">Govor</option><option value="BREAK">Pauza</option><option value="MEAL">Ručak</option><option value="END">Kraj</option></select>
          </label>
          <button className="btn">Dodaj stavku</button>
        </div>
      </AForm>

      <section className="panel danger">
        <h2>Brisanje agende</h2>
        <ConfirmButton action={deleteAgenda} fields={{ id: a.id }} title="Obrisati agendu?" message={`"${a.title}" i sve njene stavke bit će trajno obrisane.`} confirmLabel="Obriši agendu">
          Obriši agendu
        </ConfirmButton>
      </section>
    </>
  );
}
