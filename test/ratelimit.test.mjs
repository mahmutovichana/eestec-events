// Ograničenje brzine s pravim limitima na dvije nezavisne instance koje dijele bazu (dokaz distribuiranog brojanja).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("../src/generated/prisma/index.js");
const db = new PrismaClient();
const E1 = process.env.BASE_RL1;
const E2 = process.env.BASE_RL2;
const tag = "rl" + Math.random().toString(36).slice(2, 7);
const skip = !E1 || !E2;
let proj, poll, form;

const vote = (base, as, optionId) =>
  fetch(base + "/api/vote", { method: "POST", headers: { "content-type": "application/json", origin: base, cookie: `dev_user=${as}` }, body: JSON.stringify({ pollId: poll.id, optionId }) });

before(async () => {
  if (skip) return;
  proj = await db.project.create({
    data: {
      slug: `${tag}-p`, name: "RL", status: "PUBLISHED",
      polls: { create: [{ title: "P", options: { create: [{ name: "A" }] } }] },
      forms: { create: [{ title: "F", questions: { create: [{ type: "RATING", label: "Q" }] } }] },
    },
    include: { polls: { include: { options: true } }, forms: { include: { questions: true } } },
  });
  poll = proj.polls[0]; form = proj.forms[0];
  // Brojači su u zajedničkoj bazi: očisti ostatke prethodnih testova (koji su koristili iste korisnike).
  await db.rateLimit.deleteMany({});
  await fetch(E1 + "/e/" + tag, { headers: { cookie: "dev_user=user" } });
  await fetch(E1 + "/e/" + tag, { headers: { cookie: "dev_user=user2" } });
});
after(async () => {
  await db.project.deleteMany({ where: { slug: { startsWith: tag } } });
  await db.$disconnect();
});

test("glasanje: 30 zahtjeva po minuti po korisniku, 31. dobija 429; drugi korisnik nije pogođen", { skip }, async () => {
  const opt = poll.options[0].id;
  const statuses = [];
  for (let i = 0; i < 30; i++) statuses.push((await vote(E1, "user", opt)).status);
  assert.ok(statuses.every((s) => s === 200), "prvih 30 prolazi: " + [...new Set(statuses)].join());
  assert.equal((await vote(E1, "user", opt)).status, 429);
  assert.equal((await vote(E1, "user2", opt)).status, 200, "drugi korisnik ima svoj brojač");
});

test("ograničenje je distribuirano: brojač koji je napunila instanca 1 vrijedi i na instanci 2", { skip }, async () => {
  // user je već potrošio limit preko E1 u prethodnom testu; E2 mora odmah odbiti.
  assert.equal((await vote(E2, "user", poll.options[0].id)).status, 429);
});

test("brojač se nalazi u bazi i ključ ne sadrži sirov identitet", { skip }, async () => {
  const rows = await db.rateLimit.findMany({ where: { key: { startsWith: "vote:" } } });
  assert.ok(rows.length >= 2);
  for (const r of rows) {
    assert.match(r.key, /^vote:[0-9a-f]{40}$/, "HMAC, ne userId/IP");
  }
});

test("anonimni feedback: 10 slanja na sat po formi i IP-u, 11. dobija 429 (preko dvije instance)", { skip }, async () => {
  const body = { formId: form.id, acknowledgedMode: "ANONYMOUS", answers: [{ questionId: form.questions[0].id, rating: 3 }] };
  const send = (base) => fetch(base + "/api/feedback", { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) });
  const s = [];
  for (let i = 0; i < 6; i++) s.push((await send(E1)).status);
  for (let i = 0; i < 4; i++) s.push((await send(E2)).status);
  assert.ok(s.every((x) => x === 200), s.join());
  assert.equal((await send(E1)).status, 429);
  assert.equal((await send(E2)).status, 429);
  assert.equal(await db.feedbackResponse.count({ where: { formId: form.id } }), 10);
});

test("anonimni odgovori ne sadrže ni IP ni korisnika, a rate-limit ključ je samo HMAC", { skip }, async () => {
  const fb = await db.feedbackResponse.findMany({ where: { formId: form.id } });
  assert.ok(fb.every((r) => r.userId === null));
  const keys = await db.rateLimit.findMany({ where: { key: { startsWith: "fb:" } } });
  assert.ok(keys.every((k) => /^fb:[a-z0-9]+:[0-9a-f]{40}$/.test(k.key)));
});
