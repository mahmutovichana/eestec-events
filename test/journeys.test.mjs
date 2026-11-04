// Potpuna korisnička putovanja u pravom Chrome-u: organizator, učesnik, anonimni feedback.
// Prijava je simulirana (DEV_AUTH). Ovo NIJE dokaz da pravi Google/Auth0 OAuth radi.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("../src/generated/prisma/index.js");
const db = new PrismaClient();
const BASE = process.env.BASE_URL;
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const skip = !existsSync(CHROME) || !BASE;
const tag = "jr" + Math.random().toString(36).slice(2, 6);
const name = `JobFair ${tag}`;
let browser, admin, user, guest, id, slug, agenda1;

const waitText = (p, t, timeout = 15000) => p.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);
const body = (p) => p.evaluate(() => document.body.innerText);
async function clickText(page, selector, label) {
  const h = await page.evaluateHandle((sel, t) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(t)) ?? null, selector, label);
  const el = h.asElement();
  assert.ok(el, `nema ${selector} s tekstom "${label}"`);
  await el.click();
}
async function newPage(as) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.ctx = ctx;
  await page.setViewport({ width: 1280, height: 900 });
  page.on("dialog", (d) => d.accept());
  if (as) await page.goto(`${BASE}/dev-login?as=${as}&to=/`, { waitUntil: "networkidle0" });
  return page;
}

before(async () => {
  if (skip) return;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  [admin, user, guest] = await Promise.all([newPage("admin"), newPage("user"), newPage(null)]);
});
after(async () => {
  await db.project.deleteMany({ where: { name: { contains: tag } } });
  await db.$disconnect();
  await browser?.close();
});

test("Organizator 1-5: kreira događaj, konfiguriše ga, dodaje dvije agende i stavke, mijenja redoslijed", { skip }, async () => {
  await admin.goto(`${BASE}/admin/events/new`, { waitUntil: "networkidle0" });
  await admin.type('input[name="name"]', name);
  await admin.type('input[name="location"]', "ETF Sarajevo");
  await admin.type('textarea[name="description"]', "Sajam poslova");
  await admin.$eval('input[name="startsAt"]', (e) => { e.value = "2027-03-10"; });
  await admin.$eval('input[name="endsAt"]', (e) => { e.value = "2027-03-12"; });
  await Promise.all([admin.waitForNavigation({ waitUntil: "networkidle0" }), clickText(admin, "button", "Kreiraj događaj")]);
  id = admin.url().split("/admin/events/")[1].split("/")[0];
  const p = await db.project.findUnique({ where: { id } });
  slug = p.slug;
  assert.equal(p.status, "DRAFT");
  assert.equal(p.location, "ETF Sarajevo");

  for (const t of ["Dan 1", "Dan 2"]) {
    await admin.goto(`${BASE}/admin/events/${id}/agendas`, { waitUntil: "networkidle0" });
    await admin.type('input[name="title"]', t);
    await Promise.all([admin.waitForNavigation({ waitUntil: "networkidle0" }), clickText(admin, "button", "Kreiraj agendu")]);
    const aid = admin.url().split("/agendas/")[1];
    if (t === "Dan 1") agenda1 = aid;
    for (const [s, e, title] of [["09:00", "10:00", "Otvaranje"], ["10:00", "11:00", "Panel"], ["11:00", "11:30", "Pauza za kafu"]]) {
      const f = 'form:has(input[name="agendaId"])';
      await admin.$eval(`${f} input[name="startTime"]`, (el, v) => { el.value = v; }, s);
      await admin.$eval(`${f} input[name="endTime"]`, (el, v) => { el.value = v; }, e);
      await admin.type(`${f} input[name="title"]`, title);
      await clickText(admin, "button", "Dodaj stavku");
      await waitText(admin, "Stavka je dodana");
      await admin.reload({ waitUntil: "networkidle0" });
    }
  }
  // Pomjeri "Pauza za kafu" na vrh (dva klika gore)
  await admin.goto(`${BASE}/admin/events/${id}/agendas/${agenda1}`, { waitUntil: "networkidle0" });
  for (let i = 0; i < 2; i++) {
    const ups = await admin.$$('button[aria-label*="gore"]');
    await ups[2 - i].click();
    await waitText(admin, "Redoslijed je sačuvan");
    await admin.evaluate(() => { document.querySelectorAll(".toast").forEach((t) => t.remove()); });
  }
  const items = await db.agendaItem.findMany({ where: { agendaId: agenda1 }, orderBy: { position: "asc" } });
  assert.deepEqual(items.map((i) => i.title), ["Pauza za kafu", "Otvaranje", "Panel"]);
  const positions = items.map((i) => i.position);
  assert.deepEqual(positions, [0, 1, 2], "pozicije su uzastopne, bez duplikata");
});

test("Organizator 6-8: anketa za ručak, feedback forma, pregled nacrta prije objave", { skip }, async () => {
  await admin.goto(`${BASE}/admin/events/${id}/lunch`, { waitUntil: "networkidle0" });
  await clickText(admin, "button", "Kreiraj anketu");
  await waitText(admin, "Anketa je kreirana");
  await admin.reload({ waitUntil: "networkidle0" });
  for (const [n, a] of [["Piletina", ""], ["Pasta", "gluten"]]) {
    const f = 'form:has(input[name="pollId"])';
    await admin.type(`${f} input[name="name"]`, n);
    if (a) await admin.type(`${f} input[name="allergens"]`, a);
    await clickText(admin, "button", "Dodaj opciju");
    await waitText(admin, "Opcija je dodana");
    await admin.reload({ waitUntil: "networkidle0" });
  }
  await admin.goto(`${BASE}/admin/events/${id}/feedback`, { waitUntil: "networkidle0" });
  await clickText(admin, "button", "Kreiraj formu"); // anonimna po zadanom
  await waitText(admin, "Forma je kreirana");
  await admin.reload({ waitUntil: "networkidle0" });
  await admin.select('form:has(input[name="projectId"]) select[name="mode"]', "IDENTIFIED");
  await admin.type('form:has(input[name="projectId"]) input[name="title"]', "Identificirana evaluacija");
  await clickText(admin, "button", "Kreiraj formu");
  await waitText(admin, "Forma je kreirana");
  assert.equal(await db.feedbackForm.count({ where: { projectId: id } }), 2);

  // Pregled prije objave: admin vidi nacrt, ostali ne
  await admin.goto(`${BASE}/e/${slug}`, { waitUntil: "networkidle0" });
  assert.match(await body(admin), /Pregled za administratora/);
  assert.match(await body(admin), /Otvaranje/);
  assert.equal((await guest.goto(`${BASE}/e/${slug}`)).status(), 404);
  assert.equal((await guest.goto(`${BASE}/e/${slug}/lunch`)).status(), 404);
  assert.equal((await guest.goto(`${BASE}/e/${slug}/agenda/dan-1`)).status(), 404);
});

test("Organizator 9-10: objava i dijeljenje linka", { skip }, async () => {
  await admin.goto(`${BASE}/admin/events/${id}`, { waitUntil: "networkidle0" });
  const opts = await admin.$$eval('select[aria-label="Status događaja"] option', (o) => o.map((x) => x.value));
  assert.deepEqual(opts, ["DRAFT", "PUBLISHED", "ARCHIVED"], "iz nacrta su dozvoljeni samo Objavljen i Arhiviran");
  await admin.select('select[aria-label="Status događaja"]', "PUBLISHED");
  await waitText(admin, "Status je promijenjen");
  assert.equal((await guest.goto(`${BASE}/e/${slug}`)).status(), 200);
  const btn = await admin.$$eval("button", (b) => b.map((x) => x.textContent.trim()));
  assert.ok(btn.includes("Kopiraj javni link"));
});

test("Učesnik 1-3: otvara dijeljeni link, čita agendu bez prijave, vidi poziv za prijavu na akcijama", { skip }, async () => {
  await guest.goto(`${BASE}/e/${slug}`, { waitUntil: "networkidle0" });
  const t = await body(guest);
  assert.match(t, /Dan 1/);
  assert.match(t, /Dan 2/);
  assert.match(t, /ETF Sarajevo/);
  assert.match(t, /Prijavi se sa Google/);
  const href = await guest.$eval("a.gbtn", (a) => a.getAttribute("href"));
  assert.match(href, /^\/auth\/login\?returnTo=.*connection=google-oauth2/, "dugme vodi na Auth0 Google prijavu s povratkom");
  await guest.goto(`${BASE}/e/${slug}/lunch`, { waitUntil: "networkidle0" });
  assert.match(await body(guest), /Prijavi se da glasaš/);
  await guest.goto(`${BASE}/e/${slug}/agenda/dan-2`, { waitUntil: "networkidle0" });
  assert.match(await body(guest), /Panel/);
});

test("Učesnik 4-5 i organizator 11: glasa, mijenja glas; admin prati glasove", { skip }, async () => {
  await user.goto(`${BASE}/e/${slug}/lunch`, { waitUntil: "networkidle0" });
  await clickText(user, "label.opt", "Piletina");
  await clickText(user, "button", "Glasaj");
  await waitText(user, "Glas je zabilježen");
  await user.reload({ waitUntil: "networkidle0" });
  await clickText(user, "label.opt", "Pasta");
  await clickText(user, "button", "Promijeni glas");
  await waitText(user, "Glas je promijenjen");
  const poll = await db.lunchPoll.findFirst({ where: { projectId: id }, include: { votes: { include: { option: true, user: true } } } });
  assert.equal(poll.votes.length, 1);
  assert.equal(poll.votes[0].option.name, "Pasta");

  await admin.goto(`${BASE}/admin/events/${id}/lunch`, { waitUntil: "networkidle0" });
  const t = await body(admin);
  assert.match(t, /1 glasova/);
  assert.match(t, /Ko je glasao/);
  const csv = await admin.evaluate(async (pid) => { const r = await fetch(`/api/admin/lunch/${pid}/csv`); return { s: r.status, t: await r.text() }; }, poll.id);
  assert.equal(csv.s, 200);
  assert.match(csv.t, /dev\.user@example\.com/);
});

test("Anonimni put: obavijest o anonimnosti, slanje bez prijave, bez identiteta u odgovoru", { skip }, async () => {
  await guest.goto(`${BASE}/e/${slug}/feedback`, { waitUntil: "networkidle0" });
  const t = await body(guest);
  assert.match(t, /Anonimno/);
  assert.match(t, /Ne čuvamo ime, email ni IP adresu uz odgovor/);
  const form = await db.feedbackForm.findFirst({ where: { projectId: id, mode: "ANONYMOUS" } });
  // Popuni prvu formu (anonimna je prva po id-u)
  const sections = await guest.$$("section.panel");
  const sec = sections[0];
  await (await sec.$$(".stars"))[0].$("label:nth-child(4)").then((l) => l.click());
  await (await sec.$("textarea")).type("Sve pohvale");
  await (await sec.$("button.btn")).click();
  await waitText(guest, "Odgovor je anoniman");
  const rows = await db.feedbackResponse.findMany({ where: { formId: form.id }, include: { answers: true } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, null);
  assert.ok(rows[0].answers.some((a) => a.text === "Sve pohvale"));
  assert.equal(rows[0].createdAt.toISOString().slice(11), "00:00:00.000Z");
});

test("Učesnik 6-8: identificirani feedback, profil i povratak kasnije", { skip }, async () => {
  await user.goto(`${BASE}/e/${slug}/feedback`, { waitUntil: "networkidle0" });
  assert.match(await body(user), /Nije anonimno/);
  const secs = await user.$$("section.panel");
  const ident = secs[1];
  await (await ident.$$(".stars"))[0].$("label:nth-child(5)").then((l) => l.click());
  await (await ident.$$("button.btn"))[0].click();
  await waitText(user, "povezan s tvojim računom");

  await user.goto(`${BASE}/profile`, { waitUntil: "networkidle0" });
  let t = await body(user);
  assert.match(t, new RegExp(name));
  assert.match(t, /Pasta/);
  assert.match(t, /Identificirana evaluacija/);
  assert.match(t, /Poslano/);
  assert.match(t, /Poslani odgovori se ne mogu mijenjati/);

  // "Vraća se kasnije": novi prozor, ista sesija. Vidi raniji izbor i da je feedback već poslan.
  const again = await user.browserContext().newPage();
  await again.setViewport({ width: 1280, height: 900 });
  await again.goto(`${BASE}/e/${slug}/lunch`, { waitUntil: "networkidle0" });
  t = await body(again);
  assert.match(t, /Pasta · tvoj izbor/);
  await again.goto(`${BASE}/e/${slug}/feedback`, { waitUntil: "networkidle0" });
  assert.match(await body(again), /Već si poslao/);
  await again.close();
});

test("Organizator 12-13: pregled feedbacka, odgovori s identitetom samo za identificiranu formu, CSV izvoz", { skip }, async () => {
  await admin.goto(`${BASE}/admin/events/${id}/feedback`, { waitUntil: "networkidle0" });
  await admin.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  const t = await body(admin);
  assert.match(t, /Anonimni odgovor/);
  assert.match(t, /dev\.user@example\.com/);
  assert.match(t, /prosječna popunjenost/);
  const forms = await db.feedbackForm.findMany({ where: { projectId: id }, orderBy: { id: "asc" } });
  for (const f of forms) {
    const csv = await admin.evaluate(async (fid) => (await fetch(`/api/admin/feedback/${fid}/csv`)).text(), f.id);
    if (f.mode === "ANONYMOUS") assert.doesNotMatch(csv, /dev\.user|Email|Ime,/);
    else assert.match(csv, /dev\.user@example\.com/);
  }
});

test("Organizator 14-16: završava, arhivira, vraća iz arhive i duplicira za sljedeću godinu", { skip }, async () => {
  await admin.goto(`${BASE}/admin/events/${id}`, { waitUntil: "networkidle0" });
  await admin.select('select[aria-label="Status događaja"]', "COMPLETED");
  await waitText(admin, "Status je promijenjen");
  // Završen: glasanje zatvoreno, feedback otvoren
  await user.goto(`${BASE}/e/${slug}/lunch`, { waitUntil: "networkidle0" });
  assert.match(await body(user), /Glasanje je zatvoreno/);
  assert.equal(await db.lunchVote.count({ where: { poll: { projectId: id } } }), 1);

  await admin.reload({ waitUntil: "networkidle0" });
  await admin.select('select[aria-label="Status događaja"]', "ARCHIVED");
  await waitText(admin, "Status je promijenjen");
  await admin.reload({ waitUntil: "networkidle0" });
  const opts = await admin.$$eval('select[aria-label="Status događaja"] option', (o) => o.map((x) => x.textContent.trim()));
  assert.ok(opts.some((o) => o.startsWith("Vrati")), "iz arhive postoji vraćanje: " + opts.join());
  await admin.select('select[aria-label="Status događaja"]', "COMPLETED");
  await waitText(admin, "Status je promijenjen");
  assert.equal((await db.project.findUnique({ where: { id } })).status, "COMPLETED");

  // Duplikat za sljedeću godinu
  await admin.reload({ waitUntil: "networkidle0" });
  await Promise.all([
    admin.waitForNavigation({ waitUntil: "networkidle0" }),
    (async () => { await clickText(admin, "button", "Dupliciraj kao šablon"); await admin.waitForSelector("dialog[open]"); await clickText(admin, "dialog[open] button", "Dupliciraj"); })(),
  ]);
  const copyId = admin.url().split("/admin/events/")[1].split("/")[0];
  const copy = await db.project.findUnique({
    where: { id: copyId },
    include: { agendas: { include: { items: true } }, polls: { include: { options: true, votes: true } }, forms: { include: { questions: true, responses: true } } },
  });
  assert.equal(copy.status, "DRAFT");
  assert.equal(copy.agendas.length, 2);
  assert.equal(copy.agendas.reduce((s, a) => s + a.items.length, 0), 6);
  assert.equal(copy.polls[0].options.length, 2);
  assert.equal(copy.polls[0].votes.length, 0);
  assert.equal(copy.forms.length, 2);
  assert.equal(copy.forms.every((f) => f.responses.length === 0), true);
  assert.deepEqual(copy.forms.map((f) => f.mode).sort(), ["ANONYMOUS", "IDENTIFIED"], "način privatnosti se kopira kao postavka");
});
