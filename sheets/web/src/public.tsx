import { useEffect, useMemo, useState } from "react";
import { call } from "./api";
import { GoogleSignIn, useAuth } from "./auth";
import type { Agenda, EventData, EventRow, Form, Me, Poll, Question } from "./types";
import { ErrorBox, Spinner, STATUS_LABEL, duration, fmtRange, useAction, useLoad, useToast } from "./ui";

export function Home({ nav }: { nav: (to: string) => void }) {
  const { me } = useAuth();
  const { data, error, loading, reload } = useLoad(() => call<{ events: EventRow[]; settings: Record<string, string> }>("listPublishedEvents"), [me.loggedIn]);
  const intro = (
    <div className="intro">
      <h1>Događaji</h1>
      <p>Agende, ručak i feedback za EESTEC LC Sarajevo događaje na jednom mjestu.</p>
      <p className="muted">
        Događaje i agende možete pregledati bez prijave. Prijava Google računom (samo ime, email i Google ID) koristi se isključivo za glasanje za ručak i identificirani feedback.
        Više u <a href="./privacy/">Politici privatnosti</a> i <a href="./terms/">Uslovima korištenja</a>.
      </p>
    </div>
  );
  if (loading) return <>{intro}<Spinner /></>;
  if (error) return <>{intro}<ErrorBox error={error} retry={reload} /></>;
  const evs = data!.events;
  const current = evs.filter((e) => e.status !== "ARCHIVED");
  const past = evs.filter((e) => e.status === "ARCHIVED");
  return (
    <>
      {intro}
      {!evs.length && <div className="empty"><h2>Trenutno nema objavljenih događaja</h2><p>Provjerite ponovo uskoro.</p></div>}
      <ul className="cards" aria-label="Događaji">
        {current.map((e) => <EventCard key={e.id} e={e} nav={nav} />)}
      </ul>
      {past.length > 0 && (
        <>
          <h2 className="section">Arhiva</h2>
          <ul className="cards">{past.map((e) => <EventCard key={e.id} e={e} nav={nav} />)}</ul>
        </>
      )}
    </>
  );
}

function EventCard({ e, nav }: { e: EventRow; nav: (to: string) => void }) {
  return (
    <li className="ecard">
      <a href={`#/e/${e.slug}`} onClick={(ev) => { ev.preventDefault(); nav(`/e/${e.slug}`); }}>
        <span className={"pill " + e.status}>{STATUS_LABEL[e.status]}</span>
        <h2>{e.name}</h2>
        <p className="meta">{[fmtRange(e.startDate, e.endDate) || String(e.year), e.location].filter(Boolean).join(" · ")}</p>
        {e.description && <p className="desc">{e.description}</p>}
        <span className="go" aria-hidden="true">Otvori →</span>
      </a>
    </li>
  );
}

type Tab = "agenda" | "lunch" | "feedback";

export function EventPage({ slug, tab, nav }: { slug: string; tab: string; nav: (to: string) => void }) {
  const { me } = useAuth();
  const { data, error, loading, reload } = useLoad(() => call<EventData>("getEvent", { slug }), [slug, me.loggedIn, me.email]);
  const toast = useToast();
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const d = data!;
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "agenda", label: "Agenda", show: d.agendas.length > 0 },
    { id: "lunch", label: "Ručak", show: d.polls.length > 0 },
    { id: "feedback", label: "Feedback", show: d.forms.length > 0 },
  ];
  const visible = tabs.filter((t) => t.show);
  const active = (visible.find((t) => t.id === tab) ?? visible[0])?.id;
  const link = location.href.split("#")[0] + `#/e/${d.event.slug}`;
  return (
    <>
      <section className="event-hero" aria-labelledby="ev-title">
        <span className={"pill " + d.event.status}>{STATUS_LABEL[d.event.status]}</span>
        <h1 id="ev-title">{d.event.name}</h1>
        <p className="meta">{[fmtRange(d.event.startDate, d.event.endDate), d.event.location].filter(Boolean).join(" · ")}</p>
        {d.event.description && <p className="desc">{d.event.description}</p>}
        <button className="btn light" onClick={() => navigator.clipboard?.writeText(link).then(() => toast("Link je kopiran"), () => toast(link))}>Kopiraj link</button>
      </section>
      {d.event.status === "DRAFT" && <div className="notice">Ovo je nacrt — vidljiv samo administratoru.</div>}
      {d.event.status === "ARCHIVED" && <div className="notice">Događaj je arhiviran. Sadržaj je samo za čitanje.</div>}
      {visible.length === 0 && <div className="empty"><h2>Sadržaj još nije dodan</h2><p>Agenda, ručak i feedback pojaviće se ovdje.</p></div>}
      {visible.length > 1 && (
        <nav className="tabs" aria-label="Sekcije događaja">
          {visible.map((t) => (
            <a key={t.id} href={`#/e/${d.event.slug}/${t.id}`} className={"tab" + (t.id === active ? " on" : "")} aria-current={t.id === active ? "page" : undefined}
              onClick={(e) => { e.preventDefault(); nav(`/e/${d.event.slug}/${t.id}`); }}>{t.label}</a>
          ))}
        </nav>
      )}
      {active === "agenda" && <AgendaView agendas={d.agendas} />}
      {active === "lunch" && d.polls.map((p) => <PollCard key={p.id} poll={p} me={d.me} onChanged={reload} />)}
      {active === "feedback" && d.forms.map((f) => <FeedbackCard key={f.id} form={f} me={d.me} />)}
    </>
  );
}

export function AgendaView({ agendas }: { agendas: Agenda[] }) {
  return (
    <>
      {agendas.map((a) => (
        <section className="day" key={a.id} aria-labelledby={"a" + a.id}>
          <div className="dayhead"><h2 id={"a" + a.id}>{a.title}</h2><span className="bar" />{a.date && <span className="chip">{fmtRange(a.date, "")}</span>}</div>
          {a.items.length === 0 ? <p className="muted">Još nema stavki.</p> : (
            <ol className="list">
              {a.items.map((i) => (
                <li className="row" key={i.id}>
                  <time className="time">{i.startTime}</time>
                  <div className={"acard " + i.kind}>
                    <div>
                      <h3>{i.title}</h3>
                      <p className="rng">{i.kind === "END" ? i.startTime : `${i.startTime} – ${i.endTime}`}</p>
                      {i.description && <p className="desc">{i.description}</p>}
                      {i.notes && <p className="note">{i.notes}</p>}
                      {(i.speaker || i.location) && <p className="ameta">{i.speaker && <span>🎤 {i.speaker}</span>}{i.location && <span>📍 {i.location}</span>}</p>}
                    </div>
                    {i.kind !== "END" && <span className="dur">{duration(i.startTime, i.endTime)}</span>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
    </>
  );
}

function LoginPrompt({ why }: { why: string }) {
  return (
    <div className="login-prompt">
      <p>{why}</p>
      <GoogleSignIn />
    </div>
  );
}

function PollCard({ poll, me, onChanged }: { poll: Poll; me: Me; onChanged: () => void }) {
  const [sel, setSel] = useState<string | null>(poll.myOptionId);
  const { busy, run } = useAction();
  useEffect(() => setSel(poll.myOptionId), [poll.myOptionId]);
  const locked = !poll.open || (!!poll.myOptionId && !poll.allowChange);
  const max = Math.max(1, ...poll.options.map((o) => o.votes ?? 0));
  const submit = async () => {
    if (!sel) return;
    const r = await run(() => call("submitVote", { pollId: poll.id, optionId: sel }), poll.myOptionId ? "Glas je izmijenjen" : "Hvala, glas je zabilježen");
    if (r) onChanged();
  };
  return (
    <section className="panel" aria-labelledby={"p" + poll.id}>
      <div className="panel-head">
        <h2 id={"p" + poll.id}>{poll.title}</h2>
        <span className={"pill " + (poll.open ? "PUBLISHED" : "ARCHIVED")}>{poll.open ? "Glasanje otvoreno" : "Glasanje zatvoreno"}</span>
      </div>
      {poll.description && <p className="desc">{poll.description}</p>}
      {!me.loggedIn && poll.open && <LoginPrompt why="Za glasanje se prijavite Google računom. Jedan glas po računu." />}
      <fieldset className="options" disabled={!me.loggedIn || locked || busy}>
        <legend className="sr">Opcije</legend>
        {poll.options.map((o) => (
          <label key={o.id} className={"opt" + (sel === o.id ? " on" : "")}>
            <input type="radio" name={"poll-" + poll.id} value={o.id} checked={sel === o.id} onChange={() => setSel(o.id)} />
            <span className="opt-body">
              <b>{o.name}</b>
              {o.description && <small>{o.description}</small>}
              {o.allergens && <small className="allergens">Alergeni: {o.allergens}</small>}
              {poll.resultsShown && o.votes !== null && (
                <span className="bar-wrap" aria-label={`${o.votes} glasova`}><span className="bar-fill" style={{ width: `${(o.votes / max) * 100}%` }} /><em>{o.votes}</em></span>
              )}
            </span>
          </label>
        ))}
      </fieldset>
      {poll.myOptionId && <p className="muted">Vaš glas je zabilježen.{poll.allowChange && poll.open ? " Možete ga promijeniti dok je glasanje otvoreno." : ""}</p>}
      {!poll.resultsShown && <p className="muted">Rezultati nisu javno prikazani{poll.resultsVisibility === "AFTER_VOTE" ? " dok ne glasate" : poll.resultsVisibility === "AFTER_CLOSE" ? " dok se glasanje ne zatvori" : ""}.</p>}
      {poll.resultsShown && poll.total !== null && <p className="muted">Ukupno glasova: {poll.total}</p>}
      {me.loggedIn && !locked && <button className="btn primary" disabled={!sel || busy || sel === poll.myOptionId} onClick={submit}>{poll.myOptionId ? "Promijeni glas" : "Glasaj"}</button>}
    </section>
  );
}

function deviceId() {
  try {
    let d = localStorage.getItem("eestec.device");
    if (!d) { d = crypto.randomUUID(); localStorage.setItem("eestec.device", d); }
    return d;
  } catch { return ""; }
}

type Ans = Record<string, string | string[]>;

function FeedbackCard({ form, me }: { form: Form; me: Me }) {
  const [ans, setAns] = useState<Ans>({});
  const [done, setDone] = useState(form.submitted);
  const [hp, setHp] = useState("");
  const submissionId = useMemo(() => crypto.randomUUID(), []);
  const { busy, run } = useAction();
  const toastApi = useToast();
  const identified = form.mode === "IDENTIFIED";
  const needLogin = identified && !me.loggedIn;
  const set = (q: Question, v: string | string[]) => setAns((a) => ({ ...a, [q.id]: v }));
  const missing = form.questions.filter((q) => q.required && (ans[q.id] === undefined || ans[q.id] === "" || (Array.isArray(ans[q.id]) && (ans[q.id] as string[]).length === 0)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (missing.length) { toastApi(`Obavezno: ${missing[0].label}`, "err"); return; }
    const answers = Object.entries(ans).map(([questionId, value]) => ({ questionId, value: typeof value === "string" && form.questions.find((q) => q.id === questionId)?.type === "RATING" ? Number(value) : value }));
    const r = await run(() => call("submitFeedback", { formId: form.id, submissionId, acknowledgedMode: form.mode, answers, hp, device: identified ? undefined : deviceId() }, { anonymous: !identified }));
    if (r) setDone(true);
  };
  if (done) return <section className="panel"><h2>{form.title}</h2><div className="notice ok" role="status"><b>Hvala!</b><p>Vaš odgovor je zabilježen.</p></div></section>;
  return (
    <form className="panel" onSubmit={submit} aria-labelledby={"f" + form.id} noValidate>
      <div className="panel-head">
        <h2 id={"f" + form.id}>{form.title}</h2>
        <span className={"pill " + (form.open ? "PUBLISHED" : "ARCHIVED")}>{form.open ? "Otvoreno" : "Zatvoreno"}</span>
      </div>
      {form.description && <p className="desc">{form.description}</p>}
      <div className={"privacy " + (identified ? "id" : "anon")}>
        {identified
          ? <><b>Identificirani odgovori.</b> Vaše ime i email biće vezani za odgovor, a vidi ih samo administrator.</>
          : <><b>Anonimno.</b> Ne prijavljujete se i ne čuvamo ko ste. Vrijeme se bilježi samo kao datum. Radi zaštite od zloupotrebe se najviše 6 sati privremeno pamti nasumična oznaka uređaja, nikad vaš identitet.</>}
      </div>
      {needLogin && <LoginPrompt why="Ova forma traži prijavu Google računom." />}
      <fieldset className="qs" disabled={needLogin || !form.open || busy}>
        <legend className="sr">Pitanja</legend>
        {form.questions.map((q) => <QuestionField key={q.id} q={q} value={ans[q.id]} onChange={(v) => set(q, v)} />)}
        <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={hp} onChange={(e) => setHp(e.target.value)} />
      </fieldset>
      {!form.open && <p className="muted">Prikupljanje odgovora je zatvoreno.</p>}
      {form.open && !needLogin && <button className="btn primary" type="submit" disabled={busy}>{busy ? "Slanje…" : "Pošalji"}</button>}
    </form>
  );
}

function QuestionField({ q, value, onChange }: { q: Question; value: string | string[] | undefined; onChange: (v: string | string[]) => void }) {
  const label = <>{q.label}{q.required && <span className="req" aria-label="obavezno"> *</span>}</>;
  if (q.type === "RATING") {
    return (
      <fieldset className="q"><legend>{label}</legend>
        <div className="rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className={value === String(n) ? "on" : ""}><input type="radio" name={q.id} value={n} checked={value === String(n)} onChange={() => onChange(String(n))} /><span>{n}</span></label>
          ))}
        </div>
        <div className="rating-legend" aria-hidden="true"><span>Loše</span><span>Odlično</span></div>
      </fieldset>
    );
  }
  if (q.type === "SINGLE") {
    return (
      <fieldset className="q"><legend>{label}</legend>
        {q.options.map((o) => <label key={o} className="choice"><input type="radio" name={q.id} checked={value === o} onChange={() => onChange(o)} />{o}</label>)}
      </fieldset>
    );
  }
  if (q.type === "MULTI") {
    const cur = (value as string[] | undefined) ?? [];
    return (
      <fieldset className="q"><legend>{label}</legend>
        {q.options.map((o) => (
          <label key={o} className="choice"><input type="checkbox" checked={cur.includes(o)} onChange={(e) => onChange(e.target.checked ? [...cur, o] : cur.filter((x) => x !== o))} />{o}</label>
        ))}
      </fieldset>
    );
  }
  return (
    <label className="q field">{label}
      {q.type === "SHORT"
        ? <input maxLength={200} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
        : <textarea rows={4} maxLength={2000} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}
