import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/session";
import { AForm } from "@/components/AForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { archiveEvent, deleteEvent, duplicateEvent, updateEvent } from "../../actions";

const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "");

export default async function EventSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminPage(`/admin/events/${id}`);
  const p = await db.project.findUnique({ where: { id } });
  if (!p) notFound();
  return (
    <>
      <AForm action={updateEvent} className="panel" style={{ marginTop: 0 }}>
        <h2>Osnovne informacije</h2>
        <input type="hidden" name="id" value={p.id} />
        <div className="grid2">
          <label className="f">Naziv<input type="text" name="name" defaultValue={p.name} required minLength={2} maxLength={120} /></label>
          <label className="f">Javni link: /e/<input type="text" name="slug" defaultValue={p.slug} required /></label>
        </div>
        <label className="f">Opis<textarea name="description" defaultValue={p.description} maxLength={600} /></label>
        <div className="grid3b">
          <label className="f">Lokacija<input type="text" name="location" defaultValue={p.location} maxLength={160} /></label>
          <label className="f">Početak<input type="date" name="startsAt" defaultValue={d(p.startsAt)} /></label>
          <label className="f">Kraj<input type="date" name="endsAt" defaultValue={d(p.endsAt)} /></label>
        </div>
        <button className="btn">Sačuvaj</button>
      </AForm>

      <section className="panel">
        <h2>Radnje</h2>
        <p className="hint">Dupliciranje kopira agende, opcije ručka i pitanja feedbacka kao novi nacrt. Glasovi i odgovori se ne kopiraju. Korisno kao šablon za sljedeću godinu.</p>
        <div className="actions">
          <ConfirmButton action={duplicateEvent} fields={{ id: p.id }} title="Dupliciraj događaj" message={`Napravit će se nacrt "${p.name} (kopija)" sa svim agendama, opcijama ručka i pitanjima.`} confirmLabel="Dupliciraj" className="btn ghost sm">
            Dupliciraj kao šablon
          </ConfirmButton>
          {p.status !== "ARCHIVED" ? (
            <ConfirmButton
              action={archiveEvent}
              fields={{ id: p.id }} title="Arhiviraj događaj" message="Događaj ostaje dostupan preko linka samo za čitanje. Glasanje i feedback se zatvaraju." confirmLabel="Arhiviraj" className="btn ghost sm"
            >
              Arhiviraj
            </ConfirmButton>
          ) : null}
        </div>
      </section>

      <section className="panel danger">
        <h2>Brisanje događaja</h2>
        <p className="hint">Trajno briše događaj sa svim agendama, anketama, glasovima i feedbackom. Ovo se ne može poništiti.</p>
        <ConfirmButton action={deleteEvent} fields={{ id: p.id }} title="Obrisati događaj?" message={`"${p.name}" i svi povezani podaci bit će trajno obrisani.`} confirmLabel="Obriši trajno">
          Obriši događaj
        </ConfirmButton>
      </section>
    </>
  );
}
