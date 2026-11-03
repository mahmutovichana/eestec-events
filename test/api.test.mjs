// Integracijski testovi nad pokrenutim serverom (DEV_AUTH=true) i stvarnom bazom.
// Pokretanje: BASE_URL=http://localhost:3111 npm test
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("../src/generated/prisma/index.js");
const db = new PrismaClient();
const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const tag = "t" + Math.random().toString(36).slice(2, 8);

const call = (path, { as, method = "GET", body, origin = BASE, headers = {} } = {}) =>
  fetch(BASE + path, {
    method,
    redirect: "manual",
    headers: {
      ...(as ? { cookie: `dev_user=${as}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...(origin ? { origin } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

let proj, draft, poll, pollNoChange, pollClosed, draftPoll, otherPollOpt;
let formAnon, formIdent, qAnonRating, qIdentRating, qChoice1, qChoiceN;

before(async () => {
  proj = await db.project.create({ data: { slug: `${tag}-pub`, name: "Test javni", status: "PUBLISHED", agendas: { create: [{ slug: "dan", title: "Dan", items: { create: [{ startTime: "10:00", endTime: "11:00", title: "Sesija", position: 0 }] } }] } } });
  draft = await db.project.create({ data: { slug: `${tag}-draft`, name: "Test nacrt", status: "DRAFT" } });
  const mkPoll = (projectId, extra = {}) => db.lunchPoll.create({ data: { projectId, title: "Ručak", ...extra, options: { create: [{ name: "A", position: 0 }, { name: "B", position: 1 }] } }, include: { options: { orderBy: { position: "asc" } } } });
  poll = await mkPoll(proj.id);
  pollNoChange = await mkPoll(proj.id, { allowChange: false });
  pollClosed = await mkPoll(proj.id, { isOpen: false });
  draftPoll = await mkPoll(draft.id);
  otherPollOpt = pollNoChange.options[0].id;
  formAnon = await db.feedbackForm.create({ data: { projectId: proj.id, title: "Anon", mode: "ANONYMOUS", questions: { create: [{ type: "RATING", label: "Ocjena", required: true, position: 0 }] } }, include: { questions: true } });
  qAnonRating = formAnon.questions[0].id;
  formIdent = await db.feedbackForm.create({
    data: {
      projectId: proj.id, title: "Ident", mode: "IDENTIFIED",
      questions: { create: [
        { type: "RATING", label: "Ocjena", required: true, position: 0 },
        { type: "SINGLE_CHOICE", label: "Jedan", options: ["x", "y"], position: 1 },
        { type: "MULTIPLE_CHOICE", label: "Više", options: ["a", "b", "c"], position: 2 },
        { type: "SHORT_TEXT", label: "Kratko =cmd", position: 3 },
      ] },
    },
    include: { questions: { orderBy: { position: "asc" } } },
  });
  [qIdentRating, qChoice1, qChoiceN] = formIdent.questions.map((q) => q.id);
});

after(async () => {
  await db.project.deleteMany({ where: { slug: { startsWith: tag } } });
  await db.$disconnect();
});

/* ---------- Guest / User / Admin ---------- */
test("Guest čita objavljenu agendu i agenda-link bez prijave", async () => {
  assert.equal((await call(`/e/${proj.slug}`)).status, 200);
  assert.equal((await call(`/e/${proj.slug}/agenda/dan`)).status, 200);
  assert.equal((await call(`/e/${proj.slug}/lunch`)).status, 200);
  assert.equal((await call(`/e/${proj.slug}/feedback`)).status, 200);
});

test("Nacrt: Guest i User dobiju 404, Admin vidi pregled", async () => {
  assert.equal((await call(`/e/${draft.slug}`)).status, 404);
  assert.equal((await call(`/e/${draft.slug}`, { as: "user" })).status, 404);
  assert.equal((await call(`/e/${draft.slug}`, { as: "admin" })).status, 200);
});

test("Guest: /admin preusmjerava na prijavu", async () => {
  const r = await call("/admin");
  assert.equal(r.status, 307);
  assert.match(r.headers.get("location"), /\/auth\/login/);
  assert.equal((await call("/admin/events")).status, 307);
});

test("User: /admin preusmjerava na /forbidden", async () => {
  for (const p of ["/admin", "/admin/events", "/admin/participants", `/admin/events/${proj.id}`]) {
    const r = await call(p, { as: "user" });
    assert.equal(r.status, 307, p);
    assert.match(r.headers.get("location"), /\/forbidden/, p);
  }
});

test("Lažni admin (isti email, neverifikovan, ne-Google) je običan User", async () => {
  const r = await call("/admin", { as: "fake" });
  assert.equal(r.status, 307);
  assert.match(r.headers.get("location"), /\/forbidden/);
  assert.equal((await call(`/api/admin/lunch/${poll.id}/csv`, { as: "fake" })).status, 403);
  const u = await db.user.findUnique({ where: { auth0Sub: "auth0|dev-fake" } });
  assert.equal(u.role, "USER");
});

test("Admin ulaže na /admin; lokalni korisnik se kreira s ulogom iz sesije", async () => {
  assert.equal((await call("/admin", { as: "admin" })).status, 200);
  assert.equal((await call("/admin/events", { as: "admin" })).status, 200);
  assert.equal((await call("/admin/participants", { as: "admin" })).status, 200);
  assert.equal((await call("/admin/settings", { as: "admin" })).status, 200);
  assert.equal((await call(`/admin/events/${proj.id}`, { as: "admin" })).status, 200);
  assert.equal((await call(`/admin/events/${proj.id}/lunch`, { as: "admin" })).status, 200);
  assert.equal((await call(`/admin/events/${proj.id}/feedback`, { as: "admin" })).status, 200);
  const a = await db.user.findUnique({ where: { auth0Sub: "google-oauth2|dev-admin" } });
  assert.equal(a.role, "ADMIN");
  assert.equal(a.emailVerified, true);
  const u = await db.user.findUnique({ where: { auth0Sub: "google-oauth2|dev-user" } });
  assert.equal(u.role, "USER");
});

test("Profil traži prijavu", async () => {
  const r = await call("/profile");
  assert.equal(r.status, 307);
  assert.match(r.headers.get("location"), /\/auth\/login/);
  assert.equal((await call("/profile", { as: "user" })).status, 200);
});

test("CSV izvoz: Guest 401, User 403, Admin 200", async () => {
  assert.equal((await call(`/api/admin/lunch/${poll.id}/csv`)).status, 401);
  assert.equal((await call(`/api/admin/lunch/${poll.id}/csv`, { as: "user" })).status, 403);
  assert.equal((await call(`/api/admin/feedback/${formIdent.id}/csv`, { as: "user" })).status, 403);
  const r = await call(`/api/admin/lunch/${poll.id}/csv`, { as: "admin" });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/csv/);
});

test("dev-login ruta ne dozvoljava proizvoljne uloge", async () => {
  const r = await call("/dev-login?as=superadmin");
  const set = r.headers.get("set-cookie") ?? "";
  assert.doesNotMatch(set, /dev_user=superadmin/);
});

/* ---------- Glasanje ---------- */
const vote = (as, pollId, optionId, extra = {}) => call("/api/vote", { as, method: "POST", body: { pollId, optionId, ...extra } });
const votesOf = (pollId) => db.lunchVote.findMany({ where: { pollId }, include: { user: true } });

test("Vote: Guest 401; bez Origin zaglavlja 403", async () => {
  assert.equal((await vote(undefined, poll.id, poll.options[0].id)).status, 401);
  assert.equal((await call("/api/vote", { as: "user", method: "POST", origin: null, body: { pollId: poll.id, optionId: poll.options[0].id } })).status, 403);
  assert.equal((await call("/api/vote", { as: "user", method: "POST", origin: "https://evil.example", body: { pollId: poll.id, optionId: poll.options[0].id } })).status, 403);
});

test("Vote: jedan aktivni glas po korisniku, promjena glasa, više korisnika", async () => {
  const [A, B] = poll.options;
  assert.equal((await vote("user", poll.id, A.id)).status, 200);
  let rows = await votesOf(poll.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].optionId, A.id);

  const same = await (await vote("user", poll.id, A.id)).json();
  assert.equal(same.changed, false);

  const ch = await vote("user", poll.id, B.id);
  assert.equal(ch.status, 200);
  rows = await votesOf(poll.id);
  assert.equal(rows.length, 1, "promjena ne smije praviti drugi red");
  assert.equal(rows[0].optionId, B.id);

  assert.equal((await vote("user2", poll.id, A.id)).status, 200);
  assert.equal((await votesOf(poll.id)).length, 2);
});

test("Vote: istovremeni zahtjevi istog korisnika daju tačno jedan red (DB unique)", async () => {
  const p = await db.lunchPoll.create({ data: { projectId: proj.id, title: "Race", options: { create: [{ name: "A" }, { name: "B" }] } }, include: { options: true } });
  const res = await Promise.all(Array.from({ length: 8 }, (_, i) => vote("admin", p.id, p.options[i % 2].id)));
  assert.ok(res.every((r) => [200, 409].includes(r.status)), res.map((r) => r.status).join());
  assert.equal((await votesOf(p.id)).length, 1);
});

test("Vote: identitet se uzima iz sesije, userId u tijelu se ignoriše", async () => {
  const p = await db.lunchPoll.create({ data: { projectId: proj.id, title: "Spoof", options: { create: [{ name: "A" }] } }, include: { options: true } });
  const victim = await db.user.findUnique({ where: { auth0Sub: "google-oauth2|dev-user2" } });
  assert.equal((await vote("user", p.id, p.options[0].id, { userId: victim.id, user: { id: victim.id }, role: "ADMIN" })).status, 200);
  const rows = await votesOf(p.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user.auth0Sub, "google-oauth2|dev-user");
});

test("Vote: anketa bez dozvole promjene vraća 409 i ne mijenja glas", async () => {
  const [A, B] = pollNoChange.options;
  assert.equal((await vote("user", pollNoChange.id, A.id)).status, 200);
  assert.equal((await vote("user", pollNoChange.id, B.id)).status, 409);
  assert.equal((await votesOf(pollNoChange.id))[0].optionId, A.id);
});

test("Vote: zatvorena anketa 403, nacrt 404, tuđa opcija 400, nepoznat id 404", async () => {
  assert.equal((await vote("user", pollClosed.id, pollClosed.options[0].id)).status, 403);
  assert.equal((await vote("user", draftPoll.id, draftPoll.options[0].id)).status, 404);
  assert.equal((await vote("user", poll.id, otherPollOpt)).status, 400);
  assert.equal((await vote("user", "nepostojeci", "x")).status, 404);
  assert.equal((await votesOf(pollClosed.id)).length, 0);
});

test("Vote: završen i arhiviran događaj zatvaraju glasanje", async () => {
  for (const status of ["COMPLETED", "ARCHIVED"]) {
    await db.project.update({ where: { id: proj.id }, data: { status } });
    assert.equal((await vote("admin", poll.id, poll.options[0].id)).status, 403, status);
  }
  await db.project.update({ where: { id: proj.id }, data: { status: "PUBLISHED" } });
});

test("Stari anonimni glasovi (userId NULL) postoje uz glasove računa i ne krše unique", async () => {
  const p = await db.lunchPoll.create({ data: { projectId: proj.id, title: "Legacy", options: { create: [{ name: "A" }] } }, include: { options: true } });
  await db.lunchVote.createMany({ data: [
    { pollId: p.id, optionId: p.options[0].id, voterHash: "h1", netHash: "n" },
    { pollId: p.id, optionId: p.options[0].id, voterHash: "h2", netHash: "n" },
  ] });
  assert.equal((await vote("user", p.id, p.options[0].id)).status, 200);
  const rows = await votesOf(p.id);
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((r) => !r.userId).length, 2);
  const csv = await (await call(`/api/admin/lunch/${p.id}/csv`, { as: "admin" })).text();
  assert.match(csv, /stari anonimni/);
});

test("CSV ručka: ima ime i email za prijavljene glasače", async () => {
  const csv = await (await call(`/api/admin/lunch/${poll.id}/csv`, { as: "admin" })).text();
  assert.match(csv, /dev\.user@example\.com/);
  assert.match(csv, /Opcija,Broj glasova/);
});

/* ---------- Feedback ---------- */
const fb = (as, formId, answers, acknowledgedMode) => call("/api/feedback", { as, method: "POST", body: { formId, answers, acknowledgedMode } });

test("Anonimni feedback: Guest može poslati; ništa o korisniku se ne čuva; vrijeme je zaokruženo na dan", async () => {
  assert.equal((await fb(undefined, formAnon.id, [{ questionId: qAnonRating, rating: 4 }], "ANONYMOUS")).status, 200);
  // Prijavljen korisnik na anonimnoj formi: i dalje bez veze s računom.
  assert.equal((await fb("user", formAnon.id, [{ questionId: qAnonRating, rating: 5 }], "ANONYMOUS")).status, 200);
  const rows = await db.feedbackResponse.findMany({ where: { formId: formAnon.id } });
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.userId, null);
    assert.equal(r.createdAt.toISOString().slice(11), "00:00:00.000Z");
  }
});

test("Anonimni feedback: obavezno pitanje i neispravna ocjena se odbijaju", async () => {
  assert.equal((await fb(undefined, formAnon.id, [], "ANONYMOUS")).status, 400);
  assert.equal((await fb(undefined, formAnon.id, [{ questionId: qAnonRating, rating: 9 }], "ANONYMOUS")).status, 400);
});

test("Feedback: promijenjen način (acknowledgedMode ne odgovara) vraća 409", async () => {
  assert.equal((await fb(undefined, formAnon.id, [{ questionId: qAnonRating, rating: 3 }], "IDENTIFIED")).status, 409);
  assert.equal((await fb("user", formIdent.id, [{ questionId: qIdentRating, rating: 3 }], "ANONYMOUS")).status, 409);
});

test("Identificirani feedback: Guest 401, User uspješno uz userId, drugi put 409", async () => {
  assert.equal((await fb(undefined, formIdent.id, [{ questionId: qIdentRating, rating: 5 }], "IDENTIFIED")).status, 401);
  assert.equal((await fb("user", formIdent.id, [{ questionId: qIdentRating, rating: 5 }, { questionId: qChoice1, choices: ["x"] }, { questionId: qChoiceN, choices: ["a", "c"] }], "IDENTIFIED")).status, 200);
  assert.equal((await fb("user", formIdent.id, [{ questionId: qIdentRating, rating: 4 }], "IDENTIFIED")).status, 409);
  const rows = await db.feedbackResponse.findMany({ where: { formId: formIdent.id }, include: { user: true, answers: true } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user.auth0Sub, "google-oauth2|dev-user");
  assert.deepEqual(rows[0].answers.find((a) => a.questionId === qChoiceN).choices.sort(), ["a", "c"]);
});

test("Identificirani feedback: istovremena slanja istog korisnika daju jedan odgovor", async () => {
  const res = await Promise.all(Array.from({ length: 6 }, () => fb("user2", formIdent.id, [{ questionId: qIdentRating, rating: 2 }], "IDENTIFIED")));
  assert.equal(res.filter((r) => r.status === 200).length, 1, res.map((r) => r.status).join());
  assert.equal(await db.feedbackResponse.count({ where: { formId: formIdent.id, userId: (await db.user.findUnique({ where: { auth0Sub: "google-oauth2|dev-user2" } })).id } }), 1);
});

test("Identificirani feedback: oneResponsePerUser=false dozvoljava više odgovora", async () => {
  await db.feedbackForm.update({ where: { id: formIdent.id }, data: { oneResponsePerUser: false } });
  assert.equal((await fb("admin", formIdent.id, [{ questionId: qIdentRating, rating: 3 }], "IDENTIFIED")).status, 200);
  assert.equal((await fb("admin", formIdent.id, [{ questionId: qIdentRating, rating: 4 }], "IDENTIFIED")).status, 200);
  await db.feedbackForm.update({ where: { id: formIdent.id }, data: { oneResponsePerUser: true } });
});

test("Feedback: neispravan izbor i više izbora na jedan izbor se odbijaju", async () => {
  assert.equal((await fb("admin", formIdent.id, [{ questionId: qIdentRating, rating: 3 }, { questionId: qChoice1, choices: ["nepostojeca"] }], "IDENTIFIED")).status, 400);
  assert.equal((await fb("admin", formIdent.id, [{ questionId: qIdentRating, rating: 3 }, { questionId: qChoice1, choices: ["x", "y"] }], "IDENTIFIED")).status, 400);
});

test("Feedback: zatvorena forma 403, isključeno pitanje se ignoriše", async () => {
  await db.feedbackForm.update({ where: { id: formAnon.id }, data: { isOpen: false } });
  assert.equal((await fb(undefined, formAnon.id, [{ questionId: qAnonRating, rating: 3 }], "ANONYMOUS")).status, 403);
  await db.feedbackForm.update({ where: { id: formAnon.id }, data: { isOpen: true } });
  await db.feedbackQuestion.update({ where: { id: qAnonRating }, data: { required: false } });
  const extra = await db.feedbackQuestion.create({ data: { formId: formAnon.id, type: "LONG_TEXT", label: "Isključeno", enabled: false, position: 9 } });
  assert.equal((await fb(undefined, formAnon.id, [{ questionId: qAnonRating, rating: 3 }, { questionId: extra.id, text: "x" }], "ANONYMOUS")).status, 200);
  assert.equal(await db.feedbackAnswer.count({ where: { questionId: extra.id } }), 0);
});

test("Feedback CSV: anonimna forma nema kolone identiteta, identificirana ih ima; formule su neutralizovane", async () => {
  const anon = await (await call(`/api/admin/feedback/${formAnon.id}/csv`, { as: "admin" })).text();
  assert.doesNotMatch(anon, /Email|dev\.user/);
  assert.match(anon, /Datum/);
  const ident = await (await call(`/api/admin/feedback/${formIdent.id}/csv`, { as: "admin" })).text();
  assert.match(ident, /Ime,Email/);
  assert.match(ident, /dev\.user@example\.com/);
  assert.match(ident, /'=cmd|Kratko =cmd/); // zaglavlje počinje s "Kratko", ne s "="
});

test("Privatnost: stranica anonimne forme prikazuje oznaku 'Anonimno', identificirane 'Nije anonimno'", async () => {
  const html = await (await call(`/e/${proj.slug}/feedback`, { as: "user" })).text();
  assert.match(html, /Anonimno/);
  assert.match(html, /Nije anonimno/);
});

test("Profil prikazuje vlastite glasove i identificiran feedback, ne tuđe", async () => {
  const html = await (await call("/profile", { as: "user" })).text();
  assert.match(html, /Moji glasovi za ručak/);
  assert.match(html, /Ident/);
  const other = await (await call("/profile", { as: "user2" })).text();
  assert.doesNotMatch(other, /dev\.user@example\.com/);
});
