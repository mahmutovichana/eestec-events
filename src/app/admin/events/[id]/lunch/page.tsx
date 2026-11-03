import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/session";
import { AForm } from "@/components/AForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { createOption, createPoll, deleteOption, deletePoll, clearVotes, updateOption, updatePoll } from "../../../actions";

export const metadata = { title: "Lunch Poll" };

export default async function LunchAdmin({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminPage(`/admin/events/${id}/lunch`);
  const polls = await db.lunchPoll.findMany({
    where: { projectId: id },
    orderBy: { id: "asc" },
    include: {
      options: { orderBy: { position: "asc" } },
      votes: { orderBy: { updatedAt: "asc" }, include: { user: { select: { name: true, email: true } } } },
    },
  });
  return (
    <>
      {polls.length === 0 ? <div className="empty"><h2>Nema anketa za ručak</h2><p>Kreiraj anketu i dodaj opcije.</p></div> : null}
      {polls.map((poll) => {
        const total = poll.votes.length;
        const legacy = poll.votes.filter((v) => !v.userId).length;
        const max = Math.max(1, ...poll.options.map((o) => poll.votes.filter((v) => v.optionId === o.id).length));
        return (
          <section key={poll.id} className="panel" style={{ marginTop: 0 }}>
            <AForm action={updatePoll}>
              <h2>Anketa</h2>
              <input type="hidden" name="id" value={poll.id} />
              <label className="f">Naslov<input type="text" name="title" defaultValue={poll.title} required maxLength={160} /></label>
              <label className="f">Opis<input type="text" name="description" defaultValue={poll.description} /></label>
              <label className="chk"><input type="checkbox" name="isOpen" defaultChecked={poll.isOpen} /> Glasanje otvoreno</label>
              <label className="chk"><input type="checkbox" name="allowChange" defaultChecked={poll.allowChange} /> Korisnici mogu promijeniti glas dok je anketa otvorena</label>
              <label className="chk"><input type="checkbox" name="showResultsWhileOpen" defaultChecked={poll.showResultsWhileOpen} /> Prikaži rezultate učesnicima i prije zatvaranja</label>
              <div className="actions">
                <button className="btn sm">Sačuvaj anketu</button>
                <a className="btn ghost sm" href={`/api/admin/lunch/${poll.id}/csv`}>Izvezi CSV</a>
              </div>
            </AForm>

            <h3 className="sect">Rezultati · {total} glasova{legacy ? ` (${legacy} starih anonimnih)` : ""}</h3>
            {poll.options.length === 0 ? <p className="hint">Dodaj opcije ispod.</p> : null}
            {poll.options.map((o) => {
              const v = poll.votes.filter((x) => x.optionId === o.id);
              const pct = total ? Math.round((v.length / total) * 100) : 0;
              return (
                <div className="item" key={o.id}>
                  <AForm action={updateOption}>
                    <input type="hidden" name="id" value={o.id} />
                    <div className="grid2">
                      <label className="f">Naziv<input type="text" name="name" defaultValue={o.name} required maxLength={120} /></label>
                      <label className="f">Alergeni / sastojci<input type="text" name="allergens" defaultValue={o.allergens} placeholder="gluten, mlijeko" /></label>
                    </div>
                    <label className="f">Opis<input type="text" name="description" defaultValue={o.description} /></label>
                    <div className="bar-row">
                      <div className="top"><span>{v.length} glasova</span><span>{pct}%</span></div>
                      <div className="track" role="img" aria-label={`${o.name}: ${v.length} glasova, ${pct}%`}><div className="fill" style={{ width: (v.length / max) * 100 + "%" }} /></div>
                    </div>
                    {v.length ? (
                      <details className="voters">
                        <summary>Ko je glasao ({v.length})</summary>
                        <ul>
                          {v.map((x) => (
                            <li key={x.id}>{x.user ? <>{x.user.name} <small>{x.user.email}</small></> : <em>Stari anonimni glas (prije prelaska na račune)</em>}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    <div className="actions" style={{ marginTop: 10 }}>
                      <button className="btn sm">Sačuvaj</button>
                    </div>
                  </AForm>
                  <div style={{ marginTop: 8 }}>
                    <ConfirmButton action={deleteOption} fields={{ id: o.id }} title="Obrisati opciju?" message={`"${o.name}" i ${v.length} glasova za nju bit će obrisani.`}>Obriši opciju</ConfirmButton>
                  </div>
                </div>
              );
            })}

            <AForm action={createOption} className="item" resetOnSuccess>
              <input type="hidden" name="pollId" value={poll.id} />
              <div className="grid2">
                <label className="f">Nova opcija<input type="text" name="name" required maxLength={120} placeholder="Piletina sa povrćem" /></label>
                <label className="f">Alergeni / sastojci (opcionalno)<input type="text" name="allergens" /></label>
              </div>
              <label className="f">Opis<input type="text" name="description" /></label>
              <button className="btn sm">Dodaj opciju</button>
            </AForm>

            <div className="actions" style={{ marginTop: 16 }}>
              <ConfirmButton action={clearVotes} fields={{ id: poll.id }} title="Obrisati sve glasove?" message="Svi glasovi u ovoj anketi bit će obrisani. Korisnici mogu ponovo glasati." confirmLabel="Obriši glasove" className="btn ghost sm">Resetuj glasove</ConfirmButton>
              <ConfirmButton action={deletePoll} fields={{ id: poll.id }} title="Obrisati anketu?" message="Anketa, opcije i glasovi bit će trajno obrisani.">Obriši anketu</ConfirmButton>
            </div>
          </section>
        );
      })}

      <AForm action={createPoll} className="panel" resetOnSuccess>
        <h2>Nova anketa za ručak</h2>
        <input type="hidden" name="projectId" value={id} />
        <label className="f">Naslov<input type="text" name="title" placeholder="Izbor ručka" /></label>
        <label className="f">Opis<input type="text" name="description" placeholder="Glasaj do petka u 18:00." /></label>
        <button className="btn">Kreiraj anketu</button>
      </AForm>
    </>
  );
}
