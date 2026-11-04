// Negativni testovi integriteta direktno nad bazom (bez aplikacije): pravila moraju držati i mimo koda.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("../src/generated/prisma/index.js");
const db = new PrismaClient();
const tag = "int" + Math.random().toString(36).slice(2, 7);
let p1, p2, poll1, poll2, form1, form2, q1, q2, resp1;

const rejects = (fn, re) => assert.rejects(fn, (e) => (re ? re.test(String(e.code) + " " + String(e.message)) : true));

before(async () => {
  const mk = async (n) => db.project.create({
    data: {
      slug: `${tag}-${n}`, name: `Int ${n}`, status: "PUBLISHED",
      polls: { create: [{ title: "P", options: { create: [{ name: "A" }, { name: "B" }] } }] },
      forms: { create: [{ title: "F", questions: { create: [{ type: "RATING", label: "Q" }, { type: "LONG_TEXT", label: "T" }] } }] },
    },
    include: { polls: { include: { options: true } }, forms: { include: { questions: true } } },
  });
  p1 = await mk(1); p2 = await mk(2);
  [poll1, poll2] = [p1.polls[0], p2.polls[0]];
  [form1, form2] = [p1.forms[0], p2.forms[0]];
  q1 = form1.questions[0]; q2 = form2.questions[0];
  resp1 = await db.feedbackResponse.create({ data: { formId: form1.id } });
});
after(async () => {
  await db.project.deleteMany({ where: { slug: { startsWith: tag } } });
  await db.user.deleteMany({ where: { OR: [{ auth0Sub: { contains: tag } }, { email: { contains: tag } }] } });
  await db.$disconnect();
});

test("glas ne može referencirati opciju iz druge ankete (složeni FK)", async () => {
  await rejects(() => db.lunchVote.create({ data: { pollId: poll1.id, optionId: poll2.options[0].id, voterHash: "x" } }), /P2003|foreign key/i);
  await db.lunchVote.create({ data: { pollId: poll1.id, optionId: poll1.options[0].id, voterHash: "ok" } });
});

test("raw SQL također ne može upisati glas s opcijom iz druge ankete", async () => {
  await rejects(
    () => db.$executeRaw`INSERT INTO "LunchVote" ("id","pollId","optionId","voterHash","updatedAt") VALUES (${"v" + tag},${poll1.id},${poll2.options[0].id},'h',now())`,
    /foreign key|23503/i,
  );
});

test("odgovor ne može referencirati pitanje iz druge forme", async () => {
  await rejects(
    () => db.feedbackAnswer.create({ data: { formId: form1.id, responseId: resp1.id, questionId: q2.id, questionLabel: "x", questionType: "RATING", rating: 3 } }),
    /P2003|foreign key/i,
  );
});

test("odgovor ne može ukazivati na odgovor iz druge forme", async () => {
  await rejects(
    () => db.feedbackAnswer.create({ data: { formId: form2.id, responseId: resp1.id, questionId: q2.id, questionLabel: "x", questionType: "RATING", rating: 3 } }),
    /P2003|foreign key/i,
  );
});

test("isto pitanje dvaput u jednom odgovoru je zabranjeno (unique)", async () => {
  await db.feedbackAnswer.create({ data: { formId: form1.id, responseId: resp1.id, questionId: q1.id, questionLabel: q1.label, questionType: "RATING", rating: 4 } });
  await rejects(
    () => db.feedbackAnswer.create({ data: { formId: form1.id, responseId: resp1.id, questionId: q1.id, questionLabel: q1.label, questionType: "RATING", rating: 5 } }),
    /P2002|unique/i,
  );
});

test("brisanje pitanja s odgovorima je blokirano u bazi (historija se ne briše kaskadno)", async () => {
  await rejects(() => db.feedbackQuestion.delete({ where: { id: q1.id } }), /P2003|foreign key/i);
  assert.equal(await db.feedbackAnswer.count({ where: { questionId: q1.id } }), 1, "odgovor je preživio");
});

test("brisanje opcije s glasovima je blokirano u bazi", async () => {
  await rejects(() => db.lunchOption.delete({ where: { id: poll1.options[0].id } }), /P2003|foreign key/i);
  assert.equal(await db.lunchVote.count({ where: { optionId: poll1.options[0].id } }), 1);
});

test("brisanje forme s odgovorima i pitanjima radi (kaskada kroz odgovore, bez FK konflikta)", async () => {
  const f = await db.feedbackForm.create({ data: { projectId: p1.id, title: "Tmp", questions: { create: [{ type: "RATING", label: "x" }] } }, include: { questions: true } });
  const r = await db.feedbackResponse.create({ data: { formId: f.id } });
  await db.feedbackAnswer.create({ data: { formId: f.id, responseId: r.id, questionId: f.questions[0].id, questionLabel: "x", questionType: "RATING", rating: 1 } });
  await db.feedbackForm.delete({ where: { id: f.id } });
  assert.equal(await db.feedbackAnswer.count({ where: { formId: f.id } }), 0);
});

test("brisanje ankete s glasovima radi (kaskada)", async () => {
  const p = await db.lunchPoll.create({ data: { projectId: p1.id, title: "Tmp", options: { create: [{ name: "A" }] } }, include: { options: true } });
  await db.lunchVote.create({ data: { pollId: p.id, optionId: p.options[0].id, voterHash: "t" } });
  await db.lunchPoll.delete({ where: { id: p.id } });
  assert.equal(await db.lunchVote.count({ where: { pollId: p.id } }), 0);
});

test("brisanje događaja kaskadno briše sve njegove podatke", async () => {
  const p = await db.project.create({ data: { slug: `${tag}-del`, name: "Del", polls: { create: [{ title: "P", options: { create: [{ name: "A" }] } }] } }, include: { polls: { include: { options: true } } } });
  await db.lunchVote.create({ data: { pollId: p.polls[0].id, optionId: p.polls[0].options[0].id, voterHash: "d" } });
  await db.project.delete({ where: { id: p.id } });
  assert.equal(await db.lunchPoll.count({ where: { projectId: p.id } }), 0);
});

test("brisanje korisnika ne briše glas ni odgovor (userId postaje NULL)", async () => {
  const u = await db.user.create({ data: { auth0Sub: `google-oauth2|${tag}`, email: `${tag}@x.com`, name: "T" } });
  const v = await db.lunchVote.create({ data: { pollId: poll1.id, optionId: poll1.options[1].id, userId: u.id } });
  const r = await db.feedbackResponse.create({ data: { formId: form1.id, userId: u.id } });
  await db.user.delete({ where: { id: u.id } });
  assert.equal((await db.lunchVote.findUnique({ where: { id: v.id } })).userId, null);
  assert.equal((await db.feedbackResponse.findUnique({ where: { id: r.id } })).userId, null);
});

test("jedan glas po korisniku po anketi (unique), više NULL glasova je dozvoljeno", async () => {
  const u = await db.user.create({ data: { auth0Sub: `google-oauth2|${tag}u2`, email: `${tag}2@x.com`, name: "U2" } });
  await db.lunchVote.create({ data: { pollId: poll1.id, optionId: poll1.options[0].id, userId: u.id } });
  await rejects(() => db.lunchVote.create({ data: { pollId: poll1.id, optionId: poll1.options[1].id, userId: u.id } }), /P2002|unique/i);
  await db.lunchVote.create({ data: { pollId: poll1.id, optionId: poll1.options[0].id, voterHash: "n1" } });
  await db.lunchVote.create({ data: { pollId: poll1.id, optionId: poll1.options[0].id, voterHash: "n2" } });
});

test("auth0Sub je jedinstven, email nije (isti email, različit identitet)", async () => {
  await db.user.create({ data: { auth0Sub: `auth0|${tag}a`, email: `dup-${tag}@x.com`, name: "A" } });
  await db.user.create({ data: { auth0Sub: `auth0|${tag}b`, email: `dup-${tag}@x.com`, name: "B" } });
  await rejects(() => db.user.create({ data: { auth0Sub: `auth0|${tag}a`, email: "other@x.com", name: "C" } }), /P2002|unique/i);
});

test("slug događaja je jedinstven (istovremeno kreiranje: tačno jedan uspije)", async () => {
  const res = await Promise.allSettled(Array.from({ length: 6 }, () => db.project.create({ data: { slug: `${tag}-same`, name: "Same" } })));
  assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
});

test("slug agende je jedinstven unutar događaja, a različit među događajima", async () => {
  await db.agenda.create({ data: { projectId: p1.id, slug: "dan", title: "Dan" } });
  await rejects(() => db.agenda.create({ data: { projectId: p1.id, slug: "dan", title: "Dan 2" } }), /P2002|unique/i);
  await db.agenda.create({ data: { projectId: p2.id, slug: "dan", title: "Dan" } });
});

test("RateLimit upsert je atomaran pod paralelnim pozivima (SQL isti kao u aplikaciji)", async () => {
  const key = "t:" + tag;
  const hit = () => db.$queryRaw`
    INSERT INTO "RateLimit" ("key","count","windowStart") VALUES (${key},1,now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${60}) THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${60}) THEN now() ELSE "RateLimit"."windowStart" END
    RETURNING "count"`;
  const rows = await Promise.all(Array.from({ length: 25 }, hit));
  const counts = rows.map((r) => Number(r[0].count)).sort((a, b) => a - b);
  assert.deepEqual(counts, Array.from({ length: 25 }, (_, i) => i + 1), "svaki poziv dobija jedinstven brojač 1..25");
  await db.$executeRaw`UPDATE "RateLimit" SET "windowStart" = now() - interval '2 minutes' WHERE "key" = ${key}`;
  assert.equal(Number((await hit())[0].count), 1, "nakon isteka prozora brojač kreće ispočetka");
  await db.$executeRaw`DELETE FROM "RateLimit" WHERE "key" = ${key}`;
});
