// Utrke: glasanje naspram zatvaranja, istovremeno slanje, zaključavanje forme. Zahtijeva server A i stvarnu bazu.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("../src/generated/prisma/index.js");
const db = new PrismaClient();
const db2 = new PrismaClient();
const BASE = process.env.BASE_URL;
const tag = "cc" + Math.random().toString(36).slice(2, 7);
const call = (path, as, body) =>
  fetch(BASE + path, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", origin: BASE, cookie: `dev_user=${as}` }, body: JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let proj;

before(async () => {
  proj = await db.project.create({ data: { slug: `${tag}-p`, name: "CC", status: "PUBLISHED" } });
  // Osiguraj korisnike u bazi (prvi zahtjev ih kreira)
  for (const u of ["user", "user2", "admin"]) await fetch(BASE + "/e/" + tag, { headers: { cookie: `dev_user=${u}` } });
});
after(async () => {
  await db.project.deleteMany({ where: { slug: { startsWith: tag } } });
  await db.$disconnect();
  await db2.$disconnect();
});

test("lock: zatvaranje ankete čeka dok traje transakcija glasanja (FOR SHARE), pa se glasovi nakon zatvaranja ne primaju", async () => {
  const poll = await db.lunchPoll.create({ data: { projectId: proj.id, title: "Lock", options: { create: [{ name: "A" }] } } });
  let released = 0;
  const holder = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT p."isOpen" FROM "LunchPoll" p WHERE p."id" = ${poll.id} FOR SHARE OF p`;
    await sleep(900);
    released = Date.now();
  });
  await sleep(200);
  const t0 = Date.now();
  await db2.lunchPoll.update({ where: { id: poll.id }, data: { isOpen: false } }); // admin zatvaranje
  const waited = Date.now() - t0;
  await holder;
  assert.ok(waited >= 500, `zatvaranje je trebalo čekati glasanje (čekalo ${waited} ms)`);
  assert.ok(Date.now() >= released);
});

test("utrka glasanje/zatvaranje: nijedan glas nije primljen nakon što je zatvaranje potvrđeno", async () => {
  const poll = await db.lunchPoll.create({ data: { projectId: proj.id, title: "Race", options: { create: [{ name: "A" }, { name: "B" }] } }, include: { options: true } });
  const opts = poll.options.map((o) => o.id);
  const started = [];
  const reqs = [];
  const fire = (i) => {
    const t = Date.now();
    const p = call("/api/vote", ["user", "user2", "admin"][i % 3], { pollId: poll.id, optionId: opts[i % 2] }).then(async (r) => ({ status: r.status, t }));
    reqs.push(p);
    started.push(t);
  };
  for (let i = 0; i < 30; i++) { fire(i); if (i === 8) await sleep(1); }
  await sleep(60);
  await db2.lunchPoll.update({ where: { id: poll.id }, data: { isOpen: false } });
  const closedAt = Date.now();
  for (let i = 30; i < 60; i++) fire(i);
  const res = await Promise.all(reqs);
  const late = res.filter((r) => r.t > closedAt);
  assert.ok(late.length >= 20, "ima dovoljno zahtjeva poslanih nakon zatvaranja");
  assert.ok(late.every((r) => r.status === 403), "svi zahtjevi nakon zatvaranja su odbijeni: " + late.map((r) => r.status).join(","));
  // Nijedan glas u bazi nije izmijenjen nakon zatvaranja
  const votes = await db.lunchVote.findMany({ where: { pollId: poll.id } });
  assert.ok(votes.length <= 3, "najviše jedan glas po korisniku (3 korisnika), nađeno " + votes.length);
  assert.ok(votes.every((v) => v.updatedAt.getTime() <= closedAt + 5), "nijedan glas nije upisan/izmijenjen nakon zatvaranja");
});

test("utrka glasanje/promjena statusa događaja: nakon prelaska u Završen nema novih glasova", async () => {
  const p = await db.project.create({ data: { slug: `${tag}-st`, name: "ST", status: "PUBLISHED", polls: { create: [{ title: "P", options: { create: [{ name: "A" }] } }] } }, include: { polls: { include: { options: true } } } });
  const poll = p.polls[0];
  const reqs = [];
  for (let i = 0; i < 20; i++) reqs.push(call("/api/vote", ["user", "user2", "admin"][i % 3], { pollId: poll.id, optionId: poll.options[0].id }));
  await sleep(30);
  await db2.project.update({ where: { id: p.id }, data: { status: "COMPLETED" } });
  const doneAt = Date.now();
  await Promise.all(reqs);
  const after = await call("/api/vote", "user", { pollId: poll.id, optionId: poll.options[0].id });
  assert.equal(after.status, 403);
  const votes = await db.lunchVote.findMany({ where: { pollId: poll.id } });
  assert.ok(votes.every((v) => v.updatedAt.getTime() <= doneAt + 5));
});

test("promjena glasa i zatvaranje: glas se ne mijenja nakon zatvaranja", async () => {
  const poll = await db.lunchPoll.create({ data: { projectId: proj.id, title: "Change", options: { create: [{ name: "A" }, { name: "B" }] } }, include: { options: true } });
  const [A, B] = poll.options;
  assert.equal((await call("/api/vote", "user", { pollId: poll.id, optionId: A.id })).status, 200);
  await db2.lunchPoll.update({ where: { id: poll.id }, data: { isOpen: false } });
  assert.equal((await call("/api/vote", "user", { pollId: poll.id, optionId: B.id })).status, 403);
  assert.equal((await db.lunchVote.findFirst({ where: { pollId: poll.id } })).optionId, A.id);
});

test("istovremeno mijenjanje glasa dvije opcije: ostaje tačno jedan red i valjana opcija", async () => {
  const poll = await db.lunchPoll.create({ data: { projectId: proj.id, title: "Flip", options: { create: [{ name: "A" }, { name: "B" }] } }, include: { options: true } });
  const res = await Promise.all(Array.from({ length: 24 }, (_, i) => call("/api/vote", "user2", { pollId: poll.id, optionId: poll.options[i % 2].id })));
  assert.ok(res.every((r) => r.status === 200), res.map((r) => r.status).join());
  const votes = await db.lunchVote.findMany({ where: { pollId: poll.id } });
  assert.equal(votes.length, 1);
  assert.ok(poll.options.some((o) => o.id === votes[0].optionId));
});

test("feedback: mode se ne može promijeniti dok traje slanje (FOR SHARE vs FOR UPDATE)", async () => {
  const f = await db.feedbackForm.create({ data: { projectId: proj.id, title: "Lock", mode: "ANONYMOUS", questions: { create: [{ type: "RATING", label: "Q" }] } } });
  const holder = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT f."id" FROM "FeedbackForm" f WHERE f."id" = ${f.id} FOR SHARE OF f`;
    await sleep(800);
  });
  await sleep(200);
  const t0 = Date.now();
  await db2.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "FeedbackForm" WHERE "id" = ${f.id} FOR UPDATE`;
    await tx.feedbackForm.update({ where: { id: f.id }, data: { mode: "IDENTIFIED" } });
  });
  assert.ok(Date.now() - t0 >= 450, "promjena moda je čekala slanje");
  await holder;
});

test("feedback: 20 istovremenih slanja istog korisnika daje tačno jedan odgovor; više korisnika po jedan", async () => {
  const q = { type: "RATING", label: "Q", required: true };
  const f = await db.feedbackForm.create({ data: { projectId: proj.id, title: "Once", mode: "IDENTIFIED", questions: { create: [q] } }, include: { questions: true } });
  const body = { formId: f.id, acknowledgedMode: "IDENTIFIED", answers: [{ questionId: f.questions[0].id, rating: 4 }] };
  const res = await Promise.all([
    ...Array.from({ length: 20 }, () => call("/api/feedback", "user", body)),
    ...Array.from({ length: 10 }, () => call("/api/feedback", "user2", body)),
  ]);
  assert.equal(res.filter((r) => r.status === 200).length, 2, res.map((r) => r.status).join());
  assert.ok(res.every((r) => [200, 409].includes(r.status)));
  assert.equal(await db.feedbackResponse.count({ where: { formId: f.id } }), 2);
});

test("feedback: oneResponsePerUser=false dopušta istovremena slanja (svako se upisuje)", async () => {
  const f = await db.feedbackForm.create({ data: { projectId: proj.id, title: "Many", mode: "IDENTIFIED", oneResponsePerUser: false, questions: { create: [{ type: "RATING", label: "Q" }] } }, include: { questions: true } });
  const body = { formId: f.id, acknowledgedMode: "IDENTIFIED", answers: [{ questionId: f.questions[0].id, rating: 2 }] };
  const res = await Promise.all(Array.from({ length: 6 }, () => call("/api/feedback", "admin", body)));
  assert.ok(res.every((r) => r.status === 200), res.map((r) => r.status).join());
  assert.equal(await db.feedbackResponse.count({ where: { formId: f.id } }), 6);
});

test("feedback: zatvaranje forme tokom slanja — nema odgovora nakon zatvaranja", async () => {
  const f = await db.feedbackForm.create({ data: { projectId: proj.id, title: "Close", mode: "ANONYMOUS", questions: { create: [{ type: "RATING", label: "Q" }] } }, include: { questions: true } });
  const body = { formId: f.id, acknowledgedMode: "ANONYMOUS", answers: [{ questionId: f.questions[0].id, rating: 5 }] };
  const first = Array.from({ length: 10 }, () => call("/api/feedback", "user", body));
  await sleep(30);
  await db2.feedbackForm.update({ where: { id: f.id }, data: { isOpen: false } });
  const closedAt = Date.now();
  const lateReq = await Promise.all(Array.from({ length: 5 }, () => call("/api/feedback", "user", body)));
  await Promise.all(first);
  assert.ok(lateReq.every((r) => r.status === 403), lateReq.map((r) => r.status).join());
  assert.ok(Date.now() >= closedAt);
});
