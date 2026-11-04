import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/session";
import { QTYPE_LABEL } from "@/lib/util";
import { AForm } from "@/components/AForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { QuestionMove } from "@/components/QuestionMove";
import { createForm, createQuestion, deleteForm, deleteQuestion, deleteResponses, restoreQuestion, updateForm, updateQuestion } from "../../../actions";

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
      questions: { orderBy: { position: "asc" }, include: { answers: { select: { responseId: true, rating: true, text: true, choices: true, questionLabel: true } } } },
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
        const live = f.questions.filter((q) => !q.archivedAt);
        const archived = f.questions.filter((q) => q.archivedAt);
        const allRatings = f.questions.flatMap((q) => q.answers.map((a) => a.rating).filter((r): r is number => r !== null));
        const activeIds = new Set(live.filter((q) => q.enabled).map((q) => q.id));
        // Popunjenost se računa samo nad trenutno aktivnim pitanjima i samo iz stvarno upisanih odgovora.
        const perResponse = new Map<string, number>();
        for (const q of f.questions) if (activeIds.has(q.id)) for (const a of q.answers) perResponse.set(a.responseId, (perResponse.get(a.responseId) ?? 0) + 1);
        const completion = f._count.responses && activeIds.size
          ? Math.round(([...perResponse.values()].reduce((s, n) => s + n / activeIds.size, 0)) / f._count.responses * 100)
          : null;
        const labelOf = new Map(f.questions.map((q) => [q.id, q.label]));
        return (
          <section key={f.id} className="panel" style={{ marginTop: 0 }}>
            <AForm action={updateForm}>
              <div className="panel-head"><h2>Forma</h2><span className={"pill " + (identified ? "PUBLISHED" : "DRAFT")}>{identified ? "Identificirano" : "Anonimno"}</span></div>
              <input type="hidden" name="id" value={f.id} />
              <label className="f">Naslov<input type="text" name="title" defaultValue={f.title} required maxLength={160} /></label>
              <label className="f">Uvodni tekst<input type="text" name="description" defaultValue={f.description} placeholder="Ostavi prazno za zadani tekst o anonimnosti." /></label>
              <label className="f">
                Način prikupljanja
                <select name="mode" defaultValue={f.mode}>
                  <option value="ANONYMOUS">Anonimno: bez prijave, odgovor se ne vezuje ni za koga</option>
                  <option value="IDENTIFIED">Identificirano: traži Google prijavu, admin vidi ko je odgovorio</option>
                </select>
              </label>
              {locked ? <p className="hint">Način se ne može promijeniti dok postoje odgovori ({f._count.responses}). Učesnici su odgovarali pod trenutnim uslovima.</p> : <p className="hint">Učesnici vide način prikupljanja prije slanja. Nakon prvog odgovora se zaključava.</p>}
              <label className="chk"><input type="checkbox" name="isOpen" defaultChecked={f.isOpen} /> Prima odgovore</label>
              <label className="chk"><input type="checkbox" name="oneResponsePerUser" defaultChecked={f.oneResponsePerUser} /> Jedan odgovor po korisniku (samo identificirane forme)</label>
              <p className="hint">Poslani odgovori se ne mogu mijenjati: ni korisnik ni admin ne uređuju tuđe odgovore. Korisnik svoje odgovore može pregledati u profilu.</p>
              <div className="actions">
                <button className="btn sm">Sačuvaj formu</button>
                <a className="btn ghost sm" href={`/api/admin/feedback/${f.id}/csv`}>Izvezi CSV</a>
              </div>
            </AForm>

            <h3 className="sect">Statistika</h3>
            <div className="stat">
              <div><b>{f._count.responses}</b><span>odgovora</span></div>
              {allRatings.length ? <div><b>{(allRatings.reduce((s, n) => s + n, 0) / allRatings.length).toFixed(2)}</b><span>prosjek svih ocjena</span></div> : null}
              {completion !== null ? <div><b>{completion}%</b><span>prosječna popunjenost (aktivna pitanja)</span></div> : null}
            </div>

            <h3 className="sect">Pitanja</h3>
            {live.map((q, idx) => {
              const ratings = q.answers.map((a) => a.rating).filter((r): r is number => r !== null);
              const texts = q.answers.map((a) => a.text).filter((t): t is string => !!t);
              const counts = [1, 2, 3, 4, 5].map((n) => ratings.filter((r) => r === n).length);
              const maxC = Math.max(1, ...counts);
              // Distribucija izbora iz stvarnih odgovora (snimak), plus trenutne opcije s nulom, pa ukinute opcije ne nestaju iz statistike.
              const tally = new Map<string, number>(q.options.map((o) => [o, 0]));
              for (const a of q.answers) for (const c of a.choices) tally.set(c, (tally.get(c) ?? 0) + 1);
              const choiceTotal = q.answers.filter((a) => a.choices.length).length;
              const rate = f._count.responses ? Math.round((q.answers.length / f._count.responses) * 100) : 0;
              const oldLabels = [...new Set(q.answers.map((a) => a.questionLabel))].filter((l) => l !== q.label);
              return (
                <div className={"item" + (q.enabled ? "" : " disabled")} key={q.id}>
                  <div className="top">
                    <span className="pill DRAFT">{QTYPE_LABEL[q.type]}</span>
                    {!q.enabled ? <span className="pill HIDDEN">Isključeno</span> : null}
                    <QuestionMove id={q.id} first={idx === 0} last={idx === live.length - 1} />
                    <small className="save-state">{q.answers.length} odgovora · {rate}% odgovorilo</small>
                  </div>
                  <AForm action={updateQuestion}>
                    <input type="hidden" name="id" value={q.id} />
                    <label className="f">Pitanje<input type="text" name="label" defaultValue={q.label} required maxLength={200} /></label>
                    {q.answers.length > 0 ? <p className="hint">Ima odgovora. Izmjena teksta ili opcija ne mijenja historijske odgovore: svaki čuva tekst pitanja iz trenutka slanja. Tip pitanja se ne mijenja.</p> : null}
                    {oldLabels.length ? <p className="hint">Historijski odgovori pod ranijim tekstom: {oldLabels.map((l) => `„${l}”`).join(", ")}</p> : null}
                    {q.type === "SINGLE_CHOICE" || q.type === "MULTIPLE_CHOICE" ? (
                      <label className="f">Opcije (jedna po retku)<textarea name="options" defaultValue={q.options.join("\n")} style={{ minHeight: 70 }} /></label>
                    ) : null}
                    <label className="chk"><input type="checkbox" name="required" defaultChecked={q.required} /> Obavezno</label>
                    <label className="chk"><input type="checkbox" name="enabled" defaultChecked={q.enabled} /> Uključeno (prikazuje se učesnicima)</label>
                    <button className="btn sm">Sačuvaj</button>
                  </AForm>
                  <div style={{ marginTop: 8 }}>
                    <ConfirmButton
                      action={deleteQuestion} fields={{ id: q.id }}
                      title={q.answers.length ? "Arhivirati pitanje?" : "Obrisati pitanje?"}
                      message={q.answers.length ? `Pitanje ima ${q.answers.length} odgovora. Nestaje s forme, a statistika i izvozi ostaju sačuvani.` : "Pitanje će biti obrisano."}
                      confirmLabel={q.answers.length ? "Arhiviraj" : "Obriši"}
                    >
                      {q.answers.length ? "Arhiviraj pitanje" : "Obriši pitanje"}
                    </ConfirmButton>
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
                        {[...tally].map(([o, c]) => (
                          <div className="bar-row" key={o}>
                            <div className="top"><span>{o}{q.options.includes(o) ? "" : " (ukinuta opcija)"}</span><span>{c} · {Math.round((c / choiceTotal) * 100)}%</span></div>
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

            {archived.length ? (
              <>
                <h3 className="sect">Arhivirana pitanja <small>statistika ostaje sačuvana</small></h3>
                {archived.map((q) => {
                  const ratings = q.answers.map((a) => a.rating).filter((r): r is number => r !== null);
                  return (
                    <div className="item disabled" key={q.id}>
                      <div className="top"><b>{q.label}</b><span className="pill HIDDEN">Arhivirano</span><span>{q.answers.length} odgovora{ratings.length ? ` · prosjek ${(ratings.reduce((s, n) => s + n, 0) / ratings.length).toFixed(2)}` : ""}</span></div>
                      <AForm action={restoreQuestion}><input type="hidden" name="id" value={q.id} /><button className="btn ghost sm">Vrati pitanje</button></AForm>
                    </div>
                  );
                })}
              </>
            ) : null}

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
                        <li key={a.id}><span>{a.questionLabel}{labelOf.get(a.questionId) && labelOf.get(a.questionId) !== a.questionLabel ? " (tada)" : ""}</span> <b>{a.rating ?? a.text ?? a.choices.join(", ")}</b></li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            )}

            <div className="actions" style={{ marginTop: 16 }}>
              <ConfirmButton action={deleteResponses} fields={{ id: f.id }} title="Obrisati sve odgovore?" message={`Svih ${f._count.responses} odgovora bit će trajno obrisano. Preporučeno je prvo izvesti CSV.`} confirmLabel="Obriši odgovore" phrase="OBRIŠI" className="btn ghost sm">Obriši sve odgovore</ConfirmButton>
              <ConfirmButton action={deleteForm} fields={{ id: f.id }} title="Obrisati formu?" message={locked ? `Forma, pitanja i ${f._count.responses} odgovora bit će trajno obrisani.` : "Forma i pitanja bit će obrisani."} phrase={locked ? "OBRIŠI" : undefined}>Obriši formu</ConfirmButton>
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
