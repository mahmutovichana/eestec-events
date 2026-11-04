import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/session";
import { AForm } from "@/components/AForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { createOption, createPoll, deleteOption, deletePoll, clearVotes, restoreOption, updateOption, updatePoll } from "../../../actions";

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
        const legacy = poll.votes.filter((v) => !v.userId && v.voterHash).length;
        const orphan = poll.votes.filter((v) => !v.userId && !v.voterHash).length;
        const active = poll.options.filter((o) => !o.archivedAt);
        const archived = poll.options.filter((o) => o.archivedAt);
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

            <h3 className="sect">Rezultati · {total} glasova{legacy ? ` (${legacy} starih anonimnih)` : ""}{orphan ? ` (${orphan} od obrisanih korisnika)` : ""}</h3>
            {active.length === 0 ? <p className="hint">Dodaj opcije ispod.</p> : null}
            {active.map((o) => {
              const v = poll.votes.filter((x) => x.optionId === o.id);
              const pct = total ? Math.round((v.length / total) * 100) : 0;
              return (
                <div className="item" key={o.id}>
                  <AForm action={updateOption}>
                    <input type="hidden" name="id" value={o.id} />
                    <div className="grid2">
                      <label className="f">Naziv<input type="text" name="name" defaultValue={o.name} required maxLength={120} readOnly={v.length > 0} aria-describedby={v.length ? `ro-${o.id}` : undefined} /></label>
                      <label className="f">Alergeni / sastojci<input type="text" name="allergens" defaultValue={o.allergens} placeholder="gluten, mlijeko" /></label>
                    </div>
                    {v.length > 0 ? <p className="hint" id={`ro-${o.id}`}>Naziv se ne može mijenjati jer opcija ima glasove. Za promjenu dodaj novu opciju i arhiviraj ovu.</p> : null}
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
                            <li key={x.id}>{x.user ? <>{x.user.name} <small>{x.user.email}</small></> : x.voterHash ? <em>Stari anonimni glas (prije prelaska na račune)</em> : <em>Glas obrisanog korisnika</em>}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    <div className="actions" style={{ marginTop: 10 }}>
                      <button className="btn sm">Sačuvaj</button>
                    </div>
                  </AForm>
                  <div style={{ marginTop: 8 }}>
                    <ConfirmButton
                      action={deleteOption} fields={{ id: o.id }}
                      title={v.length ? "Arhivirati opciju?" : "Obrisati opciju?"}
                      message={v.length ? `"${o.name}" ima ${v.length} glasova. Opcija nestaje s glasanja, a glasovi ostaju u rezultatima.` : `"${o.name}" će biti obrisana.`}
                      confirmLabel={v.length ? "Arhiviraj" : "Obriši"}
                    >
                      {v.length ? "Arhiviraj opciju" : "Obriši opciju"}
                    </ConfirmButton>
                  </div>
                </div>
              );
            })}

            {archived.length > 0 ? (
              <>
                <h3 className="sect">Arhivirane opcije</h3>
                {archived.map((o) => {
                  const n = poll.votes.filter((x) => x.optionId === o.id).length;
                  return (
                    <div className="item disabled" key={o.id}>
                      <div className="top"><b>{o.name}</b><span className="pill HIDDEN">Arhivirano</span><span>{n} glasova (ostaju u rezultatima)</span></div>
                      <AForm action={restoreOption}><input type="hidden" name="id" value={o.id} /><button className="btn ghost sm">Vrati opciju</button></AForm>
                    </div>
                  );
                })}
              </>
            ) : null}

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
              <ConfirmButton action={clearVotes} fields={{ id: poll.id }} title="Obrisati sve glasove?" message={`Svih ${total} glasova u ovoj anketi bit će trajno obrisano. Korisnici mogu ponovo glasati.`} confirmLabel="Obriši glasove" phrase="OBRIŠI" className="btn ghost sm">Resetuj glasove</ConfirmButton>
              <ConfirmButton action={deletePoll} fields={{ id: poll.id }} title="Obrisati anketu?" message={total ? `Anketa, opcije i ${total} glasova bit će trajno obrisani.` : "Anketa i opcije bit će obrisane."} phrase={total ? "OBRIŠI" : undefined}>Obriši anketu</ConfirmButton>
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
