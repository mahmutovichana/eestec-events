import Link from "next/link";
import { requireAdminPage } from "@/lib/session";
import { AForm } from "@/components/AForm";
import { createEvent } from "../../actions";

export const metadata = { title: "Novi događaj" };

export default async function NewEvent() {
  await requireAdminPage("/admin/events/new");
  return (
    <>
      <div className="page-h"><div><h1>Novi događaj</h1><p>Ostalo (agende, ručak, feedback) dodaješ nakon kreiranja. Događaj počinje kao nacrt.</p></div></div>
      <AForm action={createEvent} className="panel" style={{ marginTop: 0 }}>
        <div className="grid2">
          <label className="f">Naziv<input type="text" name="name" required minLength={2} maxLength={120} placeholder="HOBOM 2027" /></label>
          <label className="f">Javni link (opcionalno)<input type="text" name="slug" placeholder="hobom-2027" /></label>
        </div>
        <label className="f">Opis<textarea name="description" maxLength={600} placeholder="Kratki opis događaja" /></label>
        <div className="grid3b">
          <label className="f">Lokacija<input type="text" name="location" maxLength={160} /></label>
          <label className="f">Početak<input type="date" name="startsAt" /></label>
          <label className="f">Kraj<input type="date" name="endsAt" /></label>
        </div>
        <div className="actions"><button className="btn">Kreiraj događaj</button><Link href="/admin/events" className="btn ghost">Odustani</Link></div>
      </AForm>
    </>
  );
}
