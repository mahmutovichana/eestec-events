import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/session";
import { QTYPE_LABEL } from "@/lib/util";
import { AForm } from "@/components/AForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { QuestionMove } from "@/components/QuestionMove";
import { createForm, createQuestion, deleteForm, deleteQuestion, deleteResponses, updateForm, updateQuestion } from "../../../actions";

export const metadata = { title: "Feedback" };

const fmt = new Intl.DateTimeFormat("bs-BA", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Sarajevo" });
const fmtDay = new Intl.DateTimeFormat("bs-BA", { dateStyle: "medium", timeZone: "UTC" });

export default async function FeedbackAdmin({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminPage(`/admin/events/${id}/feedback`);
  const forms = await db.feedbackForm.findMany({
    where: { projectId: id },
    orderBy: { id: "asc" },
    include: {
      questions: { orderBy: { position: "asc" }, include: { answers: { select: { rating: true, text: true, choices: true } } } },
      responses: { orderBy: { createdAt: "desc" }, take: 50, include: { user: { select: { name: true, email: true } }, answers: true } },
      _count: { select: { responses: true } },
    },
  });
  return (
    <>
      {forms.length === 0 ? <div className="empty"><h2>Nema feedback formi</h2><p>Kreiraj formu s predloženim pitanjima.</p></div> : null}
      {forms.map((f) => {
        const identified = f.mode === "IDENTIFIED";
        const locked = f._count.responses > 0;
        const allRatings = f.questions.flatMap((q) => q.answers.map((a) => a.rating).filter((r): r is number => r !== null));
        const qById = new Map(f.questions.map((q) => [q.id, q]));
        return (
          <section key={f.id} className="panel" style={{ marginTop: 0 }}>
            <AForm action={updateForm}>
              <div className="panel-head"><h2>Forma</h2><span className={"pill " + (identified ? "PUBLISHED" : "DRAFT")}>{identified ? "Identificirano" : "Anonimno"}</span></div>
              <input type="hidden" name="id" value={f.id} />
              <label className="f">Naslov<input type="text" name="title" defaultValue={f.title} required maxLength={160} /></label>
              <label className="f">Uvodni tekst<input type="text" name="description" defaultValue={f.description} /></label>
              <label className="f">
                Način prikupljanja
                <select name="mode" defaultValue={f.mode} disabled={false}>
                  <option value="ANONYMOUS">Anonimno: bez prijave, odgovor se ne vezuje ni za koga</option>
                  <option value="IDENTIFIED">Identificirano: traži Google prijavu, admin vidi ko je odgovorio</option>
                </select>
              </label>
              {locked ? <p className="hint">Način se ne može promijeniti dok postoje odgovori ({f._count.responses}). Učesnici su odgovarali pod trenutnim uslovima.</p> : <p className="hint">Učesnici vide način prikupljanja prije slanja. Nakon prvog odgovora se zaključava.</p>}
              <label className="chk"><input type="checkbox" name="isOpen" defaultChecked={f.isOpen} /> Prima odgovore</label>
              <label className="chk"><input type="checkbox" name="oneResponsePerUser" defaultChecked={f.oneResponsePerUser} /> Jedan odgovor po korisniku (samo identificirane forme)</label>
              <div className="actions">
                <button className="btn sm">Sačuvaj formu</button>
                <a className="btn ghost sm" href={`/api/admin/feedback/${f.id}/csv`}>Izvezi CSV</a>
              </div>
            </AForm>

            <h3 className="sect">Statistika</h3>
            <div className="stat">
              <div><b>{f._count.responses}</b><span>odgovora</span></div>
              {allRatings.length ? <div><b>{(allRatings.reduce((s, n) => s + n, 0) / allRatings.length).toFixed(2)}</b><span>prosjek svih ocjena</span></div> : null}
            </div>

            <h3 className="sect">Pitanja</h3>
            {f.questions.map((q, idx) => {
              const ratings = q.answers.map((a) => a.rating).filter((r): r is number => r !== null);
              const texts = q.answers.map((a) => a.text).filter((t): t is string => !!t);
              const counts = [1, 2, 3, 4, 5].map((n) => ratings.filter((r) => r === n).length);
              const maxC = Math.max(1, ...counts);
              const choiceTally = q.options.map((o) => [o, q.answers.filter((a) => a.choices.includes(o)).length] as const);
              const choiceTotal = q.answers.filter((a) => a.choices.length).length;
              return (
                <div className={"item" + (q.enabled ? "" : " disabled")} key={q.id}>
                  <div className="top">
                    <span className="pill DRAFT">{QTYPE_LABEL[q.type]}</span>
                    {!q.enabled ? <span className="pill HIDDEN">Isključeno</span> : null}
                    <QuestionMove id={q.id} first={idx === 0} last={idx === f.questions.length - 1} />
                  </div>
                  <AForm action={updateQuestion}>
                    <input type="hidden" name="id" value={q.id} />
                    <label className="f">Pitanje<input type="text" name="label" defaultValue={q.label} required maxLength={200} /></label>
                    {q.type === "SINGLE_CHOICE" || q.type === "MULTIPLE_CHOICE" ? (
                      <label className="f">Opcije (jedna po retku)<textarea name="options" defaultValue={q.options.join("\n")} style={{ minHeight: 70 }} /></label>
                    ) : null}
                    <label className="chk"><input type="checkbox" name="required" defaultChecked={q.required} /> Obavezno</label>
                    <label className="chk"><input type="checkbox" name="enabled" defaultChecked={q.enabled} /> Uključeno (prikazuje se učesnicima)</label>
                    <button className="btn sm">Sačuvaj</button>
                  </AForm>
                  <div style={{ marginTop: 8 }}>
                    <ConfirmButton action={deleteQuestion} fields={{ id: q.id }} title="Obrisati pitanje?" message="Pitanje i svi odgovori na njega bit će trajno obrisani. Za privremeno skrivanje koristi opciju Uključeno.">Obriši pitanje</ConfirmButton>
                  </div>

                  {q.type === "RATING" ? (
                    ratings.length ? (
                      <div className="chart">
                        <b>Prosjek {(ratings.reduce((s, n) => s + n, 0) / ratings.length).toFixed(2)}</b> <small>({ratings.length} ocjena)</small>
                        <div className="dist" role="img" aria-label={`Raspodjela ocjena 1 do 5: ${counts.join(", ")}`}>
                          {counts.map((c, i) => <div key={i} style={{ height: (c / maxC) * 100 + "%" }} title={`${i + 1}: ${c}`} />)}
                        </div>
                        <div className="dist-l">{counts.map((c, i) => <span key={i}>{i + 1} ({c})</span>)}</div>
                      </div>
                    ) : <p className="hint">Još nema ocjena.</p>
                  ) : q.type === "SINGLE_CHOICE" || q.type === "MULTIPLE_CHOICE" ? (
                    choiceTotal ? (
                      <div className="chart">
                        {choiceTally.map(([o, c]) => (
                          <div className="bar-row" key={o}>
                            <div className="top"><span>{o}</span><span>{c} · {Math.round((c / choiceTotal) * 100)}%</span></div>
                            <div className="track" role="img" aria-label={`${o}: ${c}`}><div className="fill" style={{ width: (c / choiceTotal) * 100 + "%" }} /></div>
                          </div>
                        ))}
                      </div>
                    ) : <p className="hint">Još nema odgovora.</p>
                  ) : texts.length ? (
                    <ul className="comments">{texts.map((t, i) => <li key={i}>{t}</li>)}</ul>
                  ) : <p className="hint">Još nema odgovora.</p>}
                </div>
              );
            })}

            <AForm action={createQuestion} className="item" resetOnSuccess>
              <input type="hidden" name="formId" value={f.id} />
              <div className="grid2">
                <label className="f">Novo pitanje<input type="text" name="label" required maxLength={200} /></label>
                <label className="f">Tip<select name="type">{Object.entries(QTYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              </div>
              <label className="f">Opcije za izbor (jedna po retku, samo za jedan/više izbora)<textarea name="options" style={{ minHeight: 60 }} /></label>
              <label className="chk"><input type="checkbox" name="required" /> Obavezno</label>
              <button className="btn sm">Dodaj pitanje</button>
            </AForm>

            <h3 className="sect">Odgovori {f._count.responses > 50 ? <small>(prikazano zadnjih 50, ostalo u CSV-u)</small> : null}</h3>
            {f.responses.length === 0 ? <p className="hint">Još nema odgovora.</p> : (
              <div className="responses">
                {f.responses.map((r) => (
                  <details key={r.id} className="resp">
                    <summary>
                      {identified ? <b>{r.user ? `${r.user.name} (${r.user.email})` : "Obrisan korisnik"}</b> : <b>Anonimni odgovor</b>}
                      <small>{identified ? fmt.format(r.createdAt) : fmtDay.format(r.createdAt)}</small>
                    </summary>
                    <ul>
                      {r.answers.map((a) => (
                        <li key={a.id}><span>{qById.get(a.questionId)?.label}</span> <b>{a.rating ?? a.text ?? a.choices.join(", ")}</b></li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            )}

            <div className="actions" style={{ marginTop: 16 }}>
              <ConfirmButton action={deleteResponses} fields={{ id: f.id }} title="Obrisati sve odgovore?" message="Svi odgovori na ovu formu bit će trajno obrisani." confirmLabel="Obriši odgovore" className="btn ghost sm">Obriši sve odgovore</ConfirmButton>
              <ConfirmButton action={deleteForm} fields={{ id: f.id }} title="Obrisati formu?" message="Forma, pitanja i odgovori bit će trajno obrisani.">Obriši formu</ConfirmButton>
            </div>
          </section>
        );
      })}

      <AForm action={createForm} className="panel" resetOnSuccess>
        <h2>Nova feedback forma</h2>
        <p className="hint">Dolazi sa predloženim pitanjima (zadovoljstvo, sesije, teme, organizacija, trajanje, komunikacija i tri otvorena pitanja). Sve se može mijenjati.</p>
        <input type="hidden" name="projectId" value={id} />
        <label className="f">Naslov<input type="text" name="title" placeholder="Evaluacija događaja" /></label>
        <label className="f">Način prikupljanja
          <select name="mode" defaultValue="ANONYMOUS">
            <option value="ANONYMOUS">Anonimno</option>
            <option value="IDENTIFIED">Identificirano (Google prijava)</option>
          </select>
        </label>
        <button className="btn">Kreiraj formu</button>
      </AForm>
    </>
  );
}
