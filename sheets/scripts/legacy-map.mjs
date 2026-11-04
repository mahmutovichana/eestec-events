// Preslikavanje podataka iz stare Postgres/Prisma baze u redove Google Sheets lista.
// Čista funkcija (bez baze), pa se testira sintetičkim podacima. Stara baza se NE mijenja.
const iso = (d) => (d ? new Date(d).toISOString() : "");
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

const MONTHS = { januar: 1, februar: 2, mart: 3, april: 4, maj: 5, juni: 6, juli: 7, august: 8, septembar: 9, oktobar: 10, novembar: 11, decembar: 12 };
/** "10. 3. 2027." | "10.03.2027" | "7. novembar 2026" -> "2027-03-10"; inače "" (vrijednost se prijavljuje u izvještaju). */
export function parseDateLabel(label) {
  if (!label) return "";
  const m = String(label).trim().toLowerCase().match(/^(\d{1,2})\.?\s*(\d{1,2}|[a-zčćšžđ]+)\.?\s*(\d{4})\.?$/);
  if (!m) return "";
  const mon = /^\d+$/.test(m[2]) ? Number(m[2]) : MONTHS[m[2]];
  if (!mon) return "";
  const out = `${m[3]}-${String(mon).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  const d = new Date(out + "T00:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === out ? out : "";
}

/** Auth0 "google-oauth2|123" -> Google sub "123" (isti identitet koji nosi Google ID token). Ostalo ostaje s prefiksom "legacy:". */
export function mapSub(auth0Sub) {
  const m = /^google-oauth2\|(\d+)$/.exec(auth0Sub || "");
  return m ? m[1] : "legacy:" + String(auth0Sub || "").replace(/[^A-Za-z0-9|:_-]/g, "_");
}

const QTYPE = { RATING: "RATING", SINGLE_CHOICE: "SINGLE", MULTIPLE_CHOICE: "MULTI", SHORT_TEXT: "SHORT", LONG_TEXT: "LONG" };

export function mapLegacy(db) {
  const report = { warnings: [], skipped: {} };
  const warn = (m) => report.warnings.push(m);
  const skip = (k) => (report.skipped[k] = (report.skipped[k] || 0) + 1);
  const users = new Map(db.users.map((u) => [u.id, u]));
  const out = { Events: [], Agendas: [], AgendaItems: [], Polls: [], PollOptions: [], Votes: [], FeedbackForms: [], FeedbackQuestions: [], FeedbackResponses: [], FeedbackAnswers: [] };

  for (const p of db.projects) {
    out.Events.push({ id: p.id, slug: p.slug, name: p.name, year: (p.startsAt ? new Date(p.startsAt) : new Date(p.createdAt)).getUTCFullYear(), description: p.description, location: p.location,
      startDate: day(p.startsAt), endDate: day(p.endsAt), status: p.status, createdAt: iso(p.createdAt), updatedAt: iso(p.updatedAt) });
  }
  for (const a of db.agendas) {
    const date = parseDateLabel(a.dateLabel);
    if (a.dateLabel && !date) warn(`Agenda "${a.title}": datum "${a.dateLabel}" nije prepoznat; upišite ga ručno.`);
    out.Agendas.push({ id: a.id, eventId: a.projectId, title: a.title, date, position: a.position, createdAt: "" });
  }
  for (const i of db.agendaItems) {
    out.AgendaItems.push({ id: i.id, agendaId: i.agendaId, startTime: i.startTime, endTime: i.endTime, title: i.title, description: i.description, speaker: i.speaker,
      location: i.location, position: i.position, version: Math.max(1, i.version || 1), notes: i.notes, kind: i.kind });
  }
  for (const p of db.polls) {
    out.Polls.push({ id: p.id, eventId: p.projectId, title: p.title, description: p.description, status: p.isOpen ? "OPEN" : "CLOSED", allowChange: p.allowChange,
      resultsVisibility: p.showResultsWhileOpen ? "ALWAYS" : "AFTER_CLOSE", position: 0, createdAt: "" });
  }
  for (const o of db.options) {
    out.PollOptions.push({ id: o.id, pollId: o.pollId, name: o.name, description: o.description, allergens: o.allergens, position: o.position, archived: !!o.archivedAt });
  }
  for (const v of db.votes) {
    const u = v.userId ? users.get(v.userId) : null;
    if (!u && !v.voterHash) { skip("glas bez korisnika i bez otiska (obrisan korisnik)"); continue; }
    out.Votes.push({ id: v.id, pollId: v.pollId, optionId: v.optionId,
      userSub: u ? mapSub(u.auth0Sub) : "legacy:" + String(v.voterHash).slice(0, 24), userEmail: u ? u.email : "", userName: u ? u.name : "Anonimni (stari glas)",
      createdAt: iso(v.createdAt), updatedAt: iso(v.updatedAt) });
  }
  for (const f of db.forms) {
    out.FeedbackForms.push({ id: f.id, eventId: f.projectId, title: f.title, description: f.description, mode: f.mode, status: f.isOpen ? "OPEN" : "CLOSED", position: 0, createdAt: "" });
    if (f.mode === "IDENTIFIED" && f.oneResponsePerUser === false) warn(`Forma "${f.title}": stara opcija "više odgovora po korisniku" ne postoji; identificirana forma dopušta jedan odgovor po računu.`);
  }
  for (const q of db.questions) {
    out.FeedbackQuestions.push({ id: q.id, formId: q.formId, label: q.label, type: QTYPE[q.type], options: JSON.stringify(q.options || []), required: q.required, position: q.position, archived: !!q.archivedAt || q.enabled === false });
  }
  const forms = new Map(db.forms.map((f) => [f.id, f]));
  for (const r of db.responses) {
    const u = r.userId ? users.get(r.userId) : null;
    const identified = forms.get(r.formId)?.mode === "IDENTIFIED";
    out.FeedbackResponses.push({ id: r.id, formId: r.formId, submissionId: "legacy-" + r.id, userSub: u && identified ? mapSub(u.auth0Sub) : "", userEmail: u && identified ? u.email : "",
      userName: u && identified ? u.name : "", createdAt: iso(r.createdAt) });
    if (u && !identified) warn(`Odgovor ${r.id}: anonimna forma ima vezan userId; identitet NIJE preuzet.`);
  }
  for (const a of db.answers) {
    const type = QTYPE[a.questionType];
    const value = type === "RATING" ? String(a.rating ?? "") : type === "SINGLE" ? (a.choices?.[0] ?? "") : type === "MULTI" ? JSON.stringify(a.choices || []) : (a.text ?? "");
    out.FeedbackAnswers.push({ id: a.id, responseId: a.responseId, formId: a.formId, questionId: a.questionId, questionLabel: a.questionLabel, questionType: type,
      questionOptions: JSON.stringify(a.questionOptions || []), value });
  }
  report.counts = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length]));
  return { data: out, report };
}
