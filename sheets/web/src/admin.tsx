import { useState, type ReactNode } from "react";
import { call } from "./api";
import { useAuth, GoogleSignIn } from "./auth";
import type { Agenda, EventData, EventRow, Form, Item, Poll, Question, Stats } from "./types";
import { Confirm, ErrorBox, Spinner, STATUS_LABEL, TRANSITIONS, download, fmtRange, useAction, useLoad, useToast } from "./ui";

type Nav = (to: string) => void;

export function AdminGate({ children }: { children: ReactNode }) {
  const { me, ready } = useAuth();
  if (!ready) return <Spinner />;
  if (!me.loggedIn) return <div className="panel"><h1>Administracija</h1><p>Prijavite se administratorskim Google računom.</p><GoogleSignIn /></div>;
  if (!me.isAdmin) return <div className="notice err" role="alert"><b>Nemate pristup.</b><p>Prijavljeni ste kao {me.email}. Administraciji može pristupiti samo EESTEC HR račun.</p></div>;
  return <>{children}</>;
}

// ───────── lista događaja ─────────
export function AdminHome({ nav }: { nav: Nav }) {
  const { data, error, loading, reload } = useLoad(() => call<{ events: EventRow[] }>("listAllEvents"), []);
  const { busy, run } = useAction();
  const [f, setF] = useState({ name: "", year: String(new Date().getFullYear()), startDate: "", endDate: "", location: "" });
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => call<{ event: EventRow }>("createEvent", { ...f, year: Number(f.year) }), "Događaj je kreiran (nacrt)");
    if (r) nav(`/admin/${r.event.slug}`);
  };
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <>
      <div className="intro"><h1>Administracija</h1><p>Događaji, agende, ručak i feedback.</p></div>
      <form className="panel grid2" onSubmit={create}>
        <h2 className="span2">Novi događaj</h2>
        <label className="field">Naziv<input required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="npr. HOBOM" /></label>
        <label className="field">Godina<input required type="number" min={2000} max={2100} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} /></label>
        <label className="field">Početak<input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
        <label className="field">Kraj<input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></label>
        <label className="field span2">Lokacija<input maxLength={200} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></label>
        <div className="span2"><button className="btn primary" disabled={busy}>Kreiraj događaj</button></div>
      </form>
      <h2 className="section">Svi događaji</h2>
      <p><a className="tab" href="#/admin/_uvoz" onClick={(e) => { e.preventDefault(); nav("/admin/_uvoz"); }}>Uvoz podataka iz stare aplikacije</a></p>
      {!data!.events.length && <div className="empty"><h2>Još nema događaja</h2><p>Kreirajte prvi iznad.</p></div>}
      <ul className="cards">
        {data!.events.map((e) => (
          <li className="ecard" key={e.id}>
            <a href={`#/admin/${e.slug}`} onClick={(ev) => { ev.preventDefault(); nav(`/admin/${e.slug}`); }}>
              <span className={"pill " + e.status}>{STATUS_LABEL[e.status]}</span>
              <h2>{e.name}</h2>
              <p className="meta">{[e.year, fmtRange(e.startDate, e.endDate)].filter(Boolean).join(" · ")}</p>
              <p className="meta">{e.agendas} agende · {e.polls} ankete · {e.forms} forme</p>
              <span className="go" aria-hidden="true">Uredi →</span>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

// ───────── uvoz iz stare aplikacije ─────────
const IMPORT_ORDER = ["Events", "Agendas", "AgendaItems", "Polls", "PollOptions", "Votes", "FeedbackForms", "FeedbackQuestions", "FeedbackResponses", "FeedbackAnswers"];
export function AdminImport({ nav }: { nav: Nav }) {
  const { busy, run } = useAction();
  const [log, setLog] = useState<string[]>([]);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    let data: Record<string, unknown[]>;
    try { data = JSON.parse(await file.text()); } catch { setLog(["Datoteka nije valjan JSON."]); return; }
    setLog([]);
    await run(async () => {
      for (const tab of IMPORT_ORDER) {
        const rows = data[tab];
        if (!Array.isArray(rows) || !rows.length) continue;
        for (let i = 0; i < rows.length; i += 200) {
          const r = await call<{ report: Record<string, { added: number; skipped: number }> }>("importSeed", { data: { [tab]: rows.slice(i, i + 200) } });
          setLog((l) => [...l, `${tab}: dodano ${r.report[tab].added}, preskočeno (već postoji) ${r.report[tab].skipped}`]);
        }
      }
    }, "Uvoz završen");
  };
  return (
    <>
      <div className="crumbs"><a href="#/admin" onClick={(e) => { e.preventDefault(); nav("/admin"); }}>← Svi događaji</a></div>
      <div className="panel">
        <h1>Uvoz iz stare aplikacije</h1>
        <p className="desc">Odaberite datoteku <code>import-payload.json</code> koju je napravila skripta za izvoz. Redovi koji već postoje se preskaču, pa je ponovni uvoz siguran.</p>
        <label className="field">Datoteka<input type="file" accept="application/json,.json" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} /></label>
        <ul aria-live="polite">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </div>
    </>
  );
}

// ───────── uređivač događaja ─────────
const TABS = [["detalji", "Detalji"], ["agende", "Agende"], ["rucak", "Ručak"], ["feedback", "Feedback"], ["rezultati", "Rezultati"]] as const;

export function AdminEvent({ slug, tab, nav }: { slug: string; tab: string; nav: Nav }) {
  const { data, error, loading, reload } = useLoad(() => call<EventData>("getEvent", { slug, includeArchived: true }), [slug]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const d = data!;
  const active = TABS.find((t) => t[0] === tab)?.[0] ?? "detalji";
  return (
    <>
      <div className="crumbs"><a href="#/admin" onClick={(e) => { e.preventDefault(); nav("/admin"); }}>← Svi događaji</a></div>
      <div className="intro">
        <span className={"pill " + d.event.status}>{STATUS_LABEL[d.event.status]}</span>
        <h1>{d.event.name}</h1>
        <p><a href={`#/e/${d.event.slug}`} onClick={(e) => { e.preventDefault(); nav(`/e/${d.event.slug}`); }}>Pogledaj javnu stranicu</a></p>
      </div>
      <nav className="tabs" aria-label="Uređivanje događaja">
        {TABS.map(([id, label]) => (
          <a key={id} href={`#/admin/${slug}/${id}`} className={"tab" + (id === active ? " on" : "")} aria-current={id === active ? "page" : undefined}
            onClick={(e) => { e.preventDefault(); nav(`/admin/${slug}/${id}`); }}>{label}</a>
        ))}
      </nav>
      {active === "detalji" && <Details d={d} reload={reload} nav={nav} />}
      {active === "agende" && <Agendas d={d} reload={reload} />}
      {active === "rucak" && <Polls d={d} reload={reload} />}
      {active === "feedback" && <Forms d={d} reload={reload} />}
      {active === "rezultati" && <Results d={d} />}
    </>
  );
}

function Details({ d, reload, nav }: { d: EventData; reload: () => void; nav: Nav }) {
  const e = d.event;
  const [f, setF] = useState({ name: e.name, year: String(e.year), startDate: e.startDate, endDate: e.endDate, location: e.location, description: e.description, slug: e.slug });
  const { busy, run } = useAction();
  const [confirm, setConfirm] = useState<null | "archive" | "delete">(null);
  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const r = await run(() => call<{ event: EventRow }>("updateEvent", { id: e.id, ...f, year: Number(f.year) }), "Sačuvano");
    if (r && r.event.slug !== e.slug) nav(`/admin/${r.event.slug}/detalji`); else if (r) reload();
  };
  const setStatus = async (status: string) => { if (await run(() => call("updateEvent", { id: e.id, status }), "Status je promijenjen")) reload(); };
  return (
    <>
      <form className="panel grid2" onSubmit={save}>
        <label className="field span2">Naziv<input required maxLength={120} value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} /></label>
        <label className="field">Godina<input required type="number" value={f.year} onChange={(x) => setF({ ...f, year: x.target.value })} /></label>
        <label className="field">Link (slug)<input required value={f.slug} onChange={(x) => setF({ ...f, slug: x.target.value })} /></label>
        <label className="field">Početak<input type="date" value={f.startDate} onChange={(x) => setF({ ...f, startDate: x.target.value })} /></label>
        <label className="field">Kraj<input type="date" value={f.endDate} onChange={(x) => setF({ ...f, endDate: x.target.value })} /></label>
        <label className="field span2">Lokacija<input maxLength={200} value={f.location} onChange={(x) => setF({ ...f, location: x.target.value })} /></label>
        <label className="field span2">Opis<textarea rows={3} maxLength={2000} value={f.description} onChange={(x) => setF({ ...f, description: x.target.value })} /></label>
        <div className="span2"><button className="btn primary" disabled={busy}>Sačuvaj</button></div>
      </form>
      <section className="panel">
        <h2>Status</h2>
        <p className="muted">Nacrt je vidljiv samo vama. Glasanje je otvoreno dok je događaj Objavljen. Feedback prima odgovore dok je Objavljen ili Završen.</p>
        <div className="actions">
          {TRANSITIONS[e.status].filter((s) => s !== "ARCHIVED").map((s) => (
            <button key={s} className="btn ghost" disabled={busy} onClick={() => setStatus(s)}>{e.status === "ARCHIVED" ? "Vrati u: " : "Postavi: "}{STATUS_LABEL[s]}</button>
          ))}
          {e.status !== "ARCHIVED" && <button className="btn ghost" onClick={() => setConfirm("archive")}>Arhiviraj</button>}
          {(e.status === "DRAFT" || e.status === "ARCHIVED") && <button className="btn danger" onClick={() => setConfirm("delete")}>Trajno obriši…</button>}
        </div>
      </section>
      {confirm === "archive" && <Confirm title="Arhivirati događaj?" text="Događaj ostaje javno vidljiv samo za čitanje. Glasanje i feedback se zatvaraju. Možete ga vratiti." confirmLabel="Arhiviraj" onCancel={() => setConfirm(null)}
        onConfirm={async () => { setConfirm(null); if (await run(() => call("deleteOrArchiveEvent", { id: e.id }), "Arhivirano")) reload(); }} />}
      {confirm === "delete" && <Confirm title="Trajno obrisati događaj?" text="Briše se događaj sa svim agendama, anketama, glasovima i odgovorima. Ovo se ne može poništiti (osim kroz historiju verzija Google tabele). Prethodno izvezite rezultate." phrase={e.name} confirmLabel="Obriši trajno" onCancel={() => setConfirm(null)}
        onConfirm={async (typed) => { setConfirm(null); if (await run(() => call("deleteOrArchiveEvent", { id: e.id, hard: true, confirmName: typed }), "Obrisano")) nav("/admin"); }} />}
    </>
  );
}

// ───────── agende ─────────
const KINDS: Record<string, string> = { SESSION: "Sesija", TALK: "Predavanje", BREAK: "Pauza", MEAL: "Obrok", END: "Kraj" };
function Agendas({ d, reload }: { d: EventData; reload: () => void }) {
  const { busy, run } = useAction();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(d.event.startDate);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => call("manageAgenda", { op: "create", eventId: d.event.id, title, date }), "Agenda je dodana")) { setTitle(""); reload(); }
  };
  return (
    <>
      <form className="panel inline" onSubmit={add}>
        <label className="field grow">Nova agenda (npr. Subota)<input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field">Datum<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <button className="btn primary" disabled={busy}>Dodaj</button>
      </form>
      {d.agendas.map((a, i) => <AgendaEditor key={a.id} a={a} idx={i} all={d.agendas} eventId={d.event.id} reload={reload} />)}
    </>
  );
}

function AgendaEditor({ a, idx, all, eventId, reload }: { a: Agenda; idx: number; all: Agenda[]; eventId: string; reload: () => void }) {
  const { busy, run } = useAction();
  const [title, setTitle] = useState(a.title);
  const [date, setDate] = useState(a.date);
  const [del, setDel] = useState(false);
  const move = async (dir: -1 | 1) => {
    const ids = all.map((x) => x.id); const j = idx + dir; [ids[idx], ids[j]] = [ids[j], ids[idx]];
    if (await run(() => call("manageAgenda", { op: "reorder", eventId, ids }))) reload();
  };
  const [nw, setNw] = useState({ startTime: "", endTime: "", title: "", speaker: "", location: "", description: "", notes: "", kind: "SESSION" });
  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => call("manageAgendaItems", { op: "create", agendaId: a.id, ...nw }), "Stavka je dodana")) { setNw({ ...nw, title: "", speaker: "", description: "", startTime: nw.endTime, endTime: "" }); reload(); }
  };
  return (
    <section className="panel" aria-label={"Agenda " + a.title}>
      <div className="inline">
        <label className="field grow">Naziv agende<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field">Datum<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <button className="btn ghost" disabled={busy} onClick={async () => { if (await run(() => call("manageAgenda", { op: "update", id: a.id, title, date }), "Sačuvano")) reload(); }}>Sačuvaj</button>
        <button className="btn ghost icon" disabled={busy || idx === 0} aria-label="Pomjeri agendu gore" onClick={() => move(-1)}>↑</button>
        <button className="btn ghost icon" disabled={busy || idx === all.length - 1} aria-label="Pomjeri agendu dolje" onClick={() => move(1)}>↓</button>
        <button className="btn danger ghost" onClick={() => setDel(true)}>Obriši</button>
      </div>
      <ol className="items">
        {a.items.map((it, i) => <ItemEditor key={it.id + ":" + it.version} item={it} idx={i} items={a.items} agendaId={a.id} reload={reload} />)}
      </ol>
      <form className="item new" onSubmit={addItem}>
        <label className="field">Početak<input required type="time" value={nw.startTime} onChange={(e) => setNw({ ...nw, startTime: e.target.value })} /></label>
        <label className="field">Kraj<input required type="time" value={nw.endTime} onChange={(e) => setNw({ ...nw, endTime: e.target.value })} /></label>
        <label className="field grow">Naslov<input required maxLength={160} value={nw.title} onChange={(e) => setNw({ ...nw, title: e.target.value })} /></label>
        <label className="field">Govornik<input maxLength={120} value={nw.speaker} onChange={(e) => setNw({ ...nw, speaker: e.target.value })} /></label>
        <label className="field">Lokacija<input maxLength={120} value={nw.location} onChange={(e) => setNw({ ...nw, location: e.target.value })} /></label>
        <label className="field">Vrsta<select value={nw.kind} onChange={(e) => setNw({ ...nw, kind: e.target.value })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <button className="btn primary" disabled={busy}>Dodaj stavku</button>
      </form>
      {del && <Confirm title="Obrisati agendu?" text={`Briše se "${a.title}" i sve njene stavke (${a.items.length}).`} confirmLabel="Obriši" onCancel={() => setDel(false)}
        onConfirm={async () => { setDel(false); if (await run(() => call("manageAgenda", { op: "delete", id: a.id }), "Obrisano")) reload(); }} />}
    </section>
  );
}

function ItemEditor({ item, idx, items, agendaId, reload }: { item: Item; idx: number; items: Item[]; agendaId: string; reload: () => void }) {
  const { busy, run } = useAction();
  const toast = useToast();
  const orig = { startTime: item.startTime, endTime: item.endTime, title: item.title, speaker: item.speaker, location: item.location, description: item.description, notes: item.notes, kind: item.kind };
  const [f, setF] = useState(orig);
  const dirty = JSON.stringify(f) !== JSON.stringify(orig);
  const overlap = items.some((o) => o.id !== item.id && f.startTime < o.endTime && o.startTime < f.endTime);
  const save = async () => {
    const r = await run(() => call("manageAgendaItems", { op: "update", id: item.id, version: item.version, ...f }), "Sačuvano");
    if (r) reload(); else reload(); // i nakon konflikta prikaži zadnje stanje
  };
  const move = async (dir: -1 | 1) => {
    const ids = items.map((x) => x.id); const j = idx + dir; [ids[idx], ids[j]] = [ids[j], ids[idx]];
    if (await run(() => call("manageAgendaItems", { op: "reorder", agendaId, ids }))) reload();
  };
  return (
    <li className="item">
      <label className="field">Početak<input type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></label>
      <label className="field">Kraj<input type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></label>
      <label className="field grow">Naslov<input value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <label className="field">Govornik<input value={f.speaker} maxLength={120} onChange={(e) => setF({ ...f, speaker: e.target.value })} /></label>
      <label className="field">Lokacija<input value={f.location} maxLength={120} onChange={(e) => setF({ ...f, location: e.target.value })} /></label>
      <label className="field">Vrsta<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Item["kind"] })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field grow">Napomena<input value={f.notes} maxLength={300} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      <div className="item-actions">
        <button className="btn primary" disabled={!dirty || busy} onClick={save}>Sačuvaj</button>
        <button className="btn ghost icon" disabled={busy || idx === 0} aria-label={`Pomjeri ${item.title} gore`} onClick={() => move(-1)}>↑</button>
        <button className="btn ghost icon" disabled={busy || idx === items.length - 1} aria-label={`Pomjeri ${item.title} dolje`} onClick={() => move(1)}>↓</button>
        <button className="btn ghost danger" disabled={busy} onClick={async () => { if (await run(() => call("manageAgendaItems", { op: "delete", id: item.id }), "Obrisano")) reload(); }}>Obriši</button>
      </div>
      {overlap && <p className="warn" role="status" onClick={() => toast("Termini se preklapaju")}>⚠ Preklapa se s drugom stavkom.</p>}
    </li>
  );
}

// ───────── ankete (ručak) ─────────
const VIS: Record<string, string> = { ALWAYS: "Uvijek javno", AFTER_VOTE: "Nakon što korisnik glasa", AFTER_CLOSE: "Nakon zatvaranja", ADMIN: "Samo admin" };

function Polls({ d, reload }: { d: EventData; reload: () => void }) {
  const { busy, run } = useAction();
  const [title, setTitle] = useState("");
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => call("managePoll", { op: "create", eventId: d.event.id, title }), "Anketa je kreirana")) { setTitle(""); reload(); }
  };
  return (
    <>
      <form className="panel inline" onSubmit={add}>
        <label className="field grow">Nova anketa (npr. Ručak — subota)<input required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <button className="btn primary" disabled={busy}>Kreiraj</button>
      </form>
      {d.polls.map((p) => <PollEditor key={p.id} p={p} reload={reload} />)}
    </>
  );
}

function PollEditor({ p, reload }: { p: Poll; reload: () => void }) {
  const { busy, run } = useAction();
  const [conf, setConf] = useState<null | "reset" | "delete">(null);
  const [nw, setNw] = useState({ name: "", allergens: "", description: "" });
  const upd = async (patch: Record<string, unknown>) => { if (await run(() => call("managePoll", { op: "update", id: p.id, ...patch }), "Sačuvano")) reload(); };
  const addOpt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => call("managePoll", { op: "addOption", pollId: p.id, ...nw }), "Opcija je dodana")) { setNw({ name: "", allergens: "", description: "" }); reload(); }
  };
  const live = p.options.filter((o) => !o.archived);
  const move = async (i: number, dir: -1 | 1) => {
    const ids = live.map((o) => o.id); const j = i + dir; [ids[i], ids[j]] = [ids[j], ids[i]];
    if (await run(() => call("managePoll", { op: "reorderOptions", pollId: p.id, ids }))) reload();
  };
  return (
    <section className="panel" aria-label={p.title}>
      <div className="panel-head">
        <h2>{p.title}</h2>
        <span className={"pill " + (p.status === "OPEN" ? "PUBLISHED" : "ARCHIVED")}>{p.status === "OPEN" ? "Otvorena" : "Zatvorena"}</span>
      </div>
      <div className="inline">
        <button className="btn ghost" disabled={busy} onClick={() => upd({ status: p.status === "OPEN" ? "CLOSED" : "OPEN" })}>{p.status === "OPEN" ? "Zatvori glasanje" : "Ponovo otvori"}</button>
        <label className="check"><input type="checkbox" checked={p.allowChange} onChange={(e) => upd({ allowChange: e.target.checked })} />Dozvoli izmjenu glasa</label>
        <label className="field">Rezultati
          <select value={p.resultsVisibility} onChange={(e) => upd({ resultsVisibility: e.target.value })}>{Object.entries(VIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
      </div>
      <ul className="opts-admin">
        {p.options.map((o) => (
          <li key={o.id} className={o.archived ? "archived" : ""}>
            <div><b>{o.name}</b>{o.allergens && <small> · alergeni: {o.allergens}</small>}{o.archived && <small> · arhivirano (ima glasove)</small>}</div>
            <span className="votes">{o.votes ?? 0} glasova</span>
            {!o.archived && <>
              <button className="btn ghost icon" aria-label={`Pomjeri ${o.name} gore`} disabled={busy || live.indexOf(o) === 0} onClick={() => move(live.indexOf(o), -1)}>↑</button>
              <button className="btn ghost icon" aria-label={`Pomjeri ${o.name} dolje`} disabled={busy || live.indexOf(o) === live.length - 1} onClick={() => move(live.indexOf(o), 1)}>↓</button>
              <button className="btn ghost danger" disabled={busy} onClick={async () => { if (await run(() => call("managePoll", { op: "removeOption", id: o.id }), "Uklonjeno")) reload(); }}>Ukloni</button>
            </>}
            {o.archived && <button className="btn ghost" disabled={busy} onClick={async () => { if (await run(() => call("managePoll", { op: "restoreOption", id: o.id }), "Vraćeno")) reload(); }}>Vrati</button>}
          </li>
        ))}
      </ul>
      <form className="inline" onSubmit={addOpt}>
        <label className="field grow">Jelo / opcija<input required maxLength={120} value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} /></label>
        <label className="field grow">Alergeni<input maxLength={200} placeholder="gluten, mlijeko…" value={nw.allergens} onChange={(e) => setNw({ ...nw, allergens: e.target.value })} /></label>
        <button className="btn primary" disabled={busy}>Dodaj opciju</button>
      </form>
      <div className="actions">
        <button className="btn ghost" onClick={async () => { const r = await run(() => call<{ filename: string; csv: string }>("exportResults", { kind: "poll", id: p.id })); if (r) download(r.filename, r.csv); }}>Izvezi CSV</button>
        <button className="btn ghost danger" onClick={() => setConf("reset")}>Poništi glasove…</button>
        <button className="btn danger" onClick={() => setConf("delete")}>Obriši anketu…</button>
      </div>
      {conf && <Confirm title={conf === "reset" ? "Poništiti sve glasove?" : "Obrisati anketu?"} text="Ovo se ne može poništiti. Preporučujemo prethodni CSV izvoz." phrase="OBRIŠI" confirmLabel="Potvrdi" onCancel={() => setConf(null)}
        onConfirm={async (typed) => { setConf(null); if (await run(() => call("managePoll", { op: conf === "reset" ? "resetVotes" : "delete", id: p.id, confirm: typed }), "Gotovo")) reload(); }} />}
    </section>
  );
}

// ───────── feedback forme ─────────
const QTYPE: Record<string, string> = { RATING: "Ocjena 1–5", SINGLE: "Jedan izbor", MULTI: "Više izbora", SHORT: "Kratki tekst", LONG: "Dugi tekst" };

function Forms({ d, reload }: { d: EventData; reload: () => void }) {
  const { busy, run } = useAction();
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState("ANONYMOUS");
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => call("manageFeedbackForm", { op: "create", eventId: d.event.id, title, mode }), "Forma je kreirana")) { setTitle(""); reload(); }
  };
  return (
    <>
      <form className="panel inline" onSubmit={add}>
        <label className="field grow">Nova forma<input required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field">Odgovori
          <select value={mode} onChange={(e) => setMode(e.target.value)}><option value="ANONYMOUS">Anonimni</option><option value="IDENTIFIED">Identificirani (prijava)</option></select>
        </label>
        <button className="btn primary" disabled={busy}>Kreiraj</button>
      </form>
      {d.forms.map((f) => <FormEditor key={f.id} f={f} reload={reload} />)}
    </>
  );
}

function FormEditor({ f, reload }: { f: Form; reload: () => void }) {
  const { busy, run } = useAction();
  const [conf, setConf] = useState<null | "responses" | "delete">(null);
  const [q, setQ] = useState({ label: "", type: "RATING", options: "", required: false });
  const locked = (f.responseCount ?? 0) > 0;
  const upd = async (patch: Record<string, unknown>, msg = "Sačuvano") => { if (await run(() => call("manageFeedbackForm", { op: "update", id: f.id, ...patch }), msg)) reload(); };
  const addQ = async (e: React.FormEvent) => {
    e.preventDefault();
    const options = q.options.split("\n").map((s) => s.trim()).filter(Boolean);
    if (await run(() => call("manageFeedbackForm", { op: "addQuestion", formId: f.id, label: q.label, type: q.type, required: q.required, options }), "Pitanje je dodano")) { setQ({ ...q, label: "", options: "" }); reload(); }
  };
  const live = f.questions.filter((x) => !x.archived);
  const move = async (i: number, dir: -1 | 1) => {
    const ids = live.map((x) => x.id); const j = i + dir; [ids[i], ids[j]] = [ids[j], ids[i]];
    if (await run(() => call("manageFeedbackForm", { op: "reorderQuestions", formId: f.id, ids }))) reload();
  };
  return (
    <section className="panel" aria-label={f.title}>
      <div className="panel-head">
        <h2>{f.title}</h2>
        <span className={"pill " + (f.status === "OPEN" ? "PUBLISHED" : "ARCHIVED")}>{f.status === "OPEN" ? "Otvorena" : "Zatvorena"}</span>
      </div>
      <p className="muted">{f.mode === "ANONYMOUS" ? "Anonimni odgovori — identitet se ne čuva." : "Identificirani odgovori — vidite ime i email."} Odgovora: {f.responseCount ?? 0}.{locked && " Način se ne može mijenjati jer već postoje odgovori."}</p>
      <div className="inline">
        <button className="btn ghost" disabled={busy} onClick={() => upd({ status: f.status === "OPEN" ? "CLOSED" : "OPEN" })}>{f.status === "OPEN" ? "Zatvori prikupljanje" : "Ponovo otvori"}</button>
        <label className="field">Način
          <select value={f.mode} disabled={locked} onChange={(e) => upd({ mode: e.target.value })}><option value="ANONYMOUS">Anonimni</option><option value="IDENTIFIED">Identificirani</option></select>
        </label>
      </div>
      <ol className="qlist">
        {f.questions.map((x) => (
          <QuestionRow key={x.id} q={x} i={live.indexOf(x)} count={live.length} busy={busy} onMove={move} reload={reload} />
        ))}
      </ol>
      <form className="item new" onSubmit={addQ}>
        <label className="field grow">Pitanje<input required maxLength={300} value={q.label} onChange={(e) => setQ({ ...q, label: e.target.value })} /></label>
        <label className="field">Tip<select value={q.type} onChange={(e) => setQ({ ...q, type: e.target.value })}>{Object.entries(QTYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {(q.type === "SINGLE" || q.type === "MULTI") && <label className="field grow">Opcije (jedna po retku)<textarea rows={3} required value={q.options} onChange={(e) => setQ({ ...q, options: e.target.value })} /></label>}
        <label className="check"><input type="checkbox" checked={q.required} onChange={(e) => setQ({ ...q, required: e.target.checked })} />Obavezno</label>
        <button className="btn primary" disabled={busy}>Dodaj pitanje</button>
      </form>
      <div className="actions">
        <button className="btn ghost" onClick={async () => { const r = await run(() => call<{ filename: string; csv: string }>("exportResults", { kind: "feedback", id: f.id })); if (r) download(r.filename, r.csv); }}>Izvezi CSV</button>
        {locked && <button className="btn ghost danger" onClick={() => setConf("responses")}>Obriši odgovore…</button>}
        <button className="btn danger" onClick={() => setConf("delete")}>Obriši formu…</button>
      </div>
      {conf && <Confirm title={conf === "responses" ? "Obrisati sve odgovore?" : "Obrisati formu?"} text="Ovo se ne može poništiti. Preporučujemo prethodni CSV izvoz." phrase="OBRIŠI" confirmLabel="Potvrdi" onCancel={() => setConf(null)}
        onConfirm={async (typed) => { setConf(null); if (await run(() => call("manageFeedbackForm", { op: conf === "responses" ? "deleteResponses" : "delete", id: f.id, confirm: typed }), "Gotovo")) reload(); }} />}
    </section>
  );
}

function QuestionRow({ q, i, count, busy, onMove, reload }: { q: Question; i: number; count: number; busy: boolean; onMove: (i: number, d: -1 | 1) => void; reload: () => void }) {
  const { run } = useAction();
  const [edit, setEdit] = useState(false);
  const [label, setLabel] = useState(q.label);
  const [opts, setOpts] = useState(q.options.join("\n"));
  const [req, setReq] = useState(q.required);
  const hasOpts = q.type === "SINGLE" || q.type === "MULTI";
  const save = async () => {
    if (await run(() => call("manageFeedbackForm", { op: "updateQuestion", id: q.id, label, required: req, type: q.type, options: opts.split("\n").map((s) => s.trim()).filter(Boolean) }), "Sačuvano. Stari odgovori zadržavaju originalni tekst pitanja.")) { setEdit(false); reload(); }
  };
  return (
    <li className={"qrow" + (q.archived ? " archived" : "")}>
      {!edit ? (
        <>
          <div><b>{q.label}</b>{q.required && " *"} <small>· {QTYPE[q.type]}{hasOpts ? ` (${q.options.join(", ")})` : ""}{q.archived ? " · arhivirano" : ""}</small></div>
          <div className="item-actions">
            {!q.archived && <>
              <button className="btn ghost icon" aria-label={`Pomjeri "${q.label}" gore`} disabled={busy || i === 0} onClick={() => onMove(i, -1)}>↑</button>
              <button className="btn ghost icon" aria-label={`Pomjeri "${q.label}" dolje`} disabled={busy || i === count - 1} onClick={() => onMove(i, 1)}>↓</button>
              <button className="btn ghost" onClick={() => setEdit(true)}>Uredi</button>
              <button className="btn ghost danger" disabled={busy} onClick={async () => { const r = await run(() => call<{ archived?: boolean }>("manageFeedbackForm", { op: "removeQuestion", id: q.id }), "Uklonjeno"); if (r) reload(); }}>Ukloni</button>
            </>}
            {q.archived && <button className="btn ghost" onClick={async () => { if (await run(() => call("manageFeedbackForm", { op: "restoreQuestion", id: q.id }), "Vraćeno")) reload(); }}>Vrati</button>}
          </div>
        </>
      ) : (
        <div className="item">
          <label className="field grow">Pitanje<input value={label} onChange={(e) => setLabel(e.target.value)} /></label>
          {hasOpts && <label className="field grow">Opcije<textarea rows={3} value={opts} onChange={(e) => setOpts(e.target.value)} /></label>}
          <label className="check"><input type="checkbox" checked={req} onChange={(e) => setReq(e.target.checked)} />Obavezno</label>
          <div className="item-actions"><button className="btn primary" onClick={save}>Sačuvaj</button><button className="btn ghost" onClick={() => setEdit(false)}>Odustani</button></div>
        </div>
      )}
    </li>
  );
}

// ───────── rezultati ─────────
export function Results({ d }: { d: EventData }) {
  const { data, error, loading, reload } = useLoad(() => call<Stats>("getAdminStatistics", { eventId: d.event.id }), [d.event.id]);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const s = data!;
  return (
    <>
      <div className="actions"><button className="btn ghost" onClick={reload}>Osvježi</button></div>
      {!s.polls.length && !s.forms.length && <div className="empty"><h2>Nema rezultata</h2><p>Dodajte anketu ili formu.</p></div>}
      {s.polls.map((p) => (
        <section className="panel" key={p.id} aria-label={p.title}>
          <h2>{p.title} <small>· {p.total} glasova</small></h2>
          {p.options.map((o) => (
            <details key={o.id} className="res">
              <summary><b>{o.name}</b>{o.archived && " (arhivirano)"} <span className="votes">{o.votes}</span></summary>
              {o.voters.length ? <ul>{o.voters.map((v, i) => <li key={i}>{v.name || "—"} <small>{v.email}</small></li>)}</ul> : <p className="muted">Nema glasova.</p>}
            </details>
          ))}
        </section>
      ))}
      {s.forms.map((f) => (
        <section className="panel" key={f.id} aria-label={f.title}>
          <h2>{f.title} <small>· {f.responseCount} odgovora · {f.mode === "ANONYMOUS" ? "anonimno" : "identificirano"}</small></h2>
          {f.stats.map((q) => (
            <div className="stat" key={q.questionId}>
              <h3>{q.label}{q.archived && <small> (arhivirano)</small>} <small>· {q.count}</small></h3>
              {q.type === "RATING" && <><p className="big">{q.average ?? "—"} <small>/ 5</small></p>
                <div className="dist">{q.distribution!.map((n, i) => <div key={i}><span style={{ height: `${(n / Math.max(1, ...q.distribution!)) * 100}%` }} /><em>{i + 1}</em><b>{n}</b></div>)}</div></>}
              {q.counts && <ul className="counts">{Object.entries(q.counts).map(([k, v]) => <li key={k}><span>{k}</span><b>{v}</b></li>)}</ul>}
              {q.texts && <ul className="texts">{q.texts.map((t, i) => <li key={i}>{t}</li>)}</ul>}
            </div>
          ))}
          {f.mode === "IDENTIFIED" && f.responses.length > 0 && (
            <details className="res"><summary>Ko je odgovorio ({f.responses.length})</summary><ul>{f.responses.map((r) => <li key={r.id}>{r.name} <small>{r.email}</small></li>)}</ul></details>
          )}
        </section>
      ))}
    </>
  );
}
