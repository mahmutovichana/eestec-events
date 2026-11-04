// UI testovi u stvarnom Chrome-u (puppeteer-core). Zahtijevaju pokrenut server (DEV_AUTH=true) i Chrome.
// Pokretanje: BASE_URL=http://localhost:3111 CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" npm test
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("../src/generated/prisma/index.js");
const db = new PrismaClient();
const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = process.env.SHOT_DIR;
const tag = "ui" + Math.random().toString(36).slice(2, 6);
const evName = `UI ${tag}`;

const skip = !existsSync(CHROME);
let browser, admin, user;

async function newPage(as, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.ctx = ctx;
  await page.setViewport(viewport);
  if (as) await page.goto(`${BASE}/dev-login?as=${as}&to=/`, { waitUntil: "networkidle0" });
  page.on("dialog", (d) => d.accept());
  return page;
}
const clickText = async (page, selector, label) => {
  const h = await page.evaluateHandle((sel, t) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(t)) ?? null, selector, label);
  const el = h.asElement();
  assert.ok(el, `nema elementa ${selector} s tekstom "${label}"`);
  await el.click();
};
const waitText = (page, t, timeout = 15000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); } };

before(async () => {
  if (skip) return;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  admin = await newPage("admin");
  user = await newPage("user");
});
after(async () => {
  await db.project.deleteMany({ where: { name: { contains: tag } } });
  await db.$disconnect();
  await browser?.close();
});

let eventId, slug, agendaId;

test("Admin kreira događaj kroz formu", { skip }, async () => {
  await admin.goto(`${BASE}/admin/events/new`, { waitUntil: "networkidle0" });
  await admin.type('input[name="name"]', evName);
  await admin.type('input[name="location"]', "ETF Sarajevo");
  await admin.type('textarea[name="description"]', "Test opis");
  await Promise.all([admin.waitForNavigation({ waitUntil: "networkidle0" }), clickText(admin, "button", "Kreiraj događaj")]);
  eventId = admin.url().split("/admin/events/")[1].split("/")[0];
  const p = await db.project.findUnique({ where: { id: eventId } });
  assert.equal(p.name, evName);
  assert.equal(p.status, "DRAFT");
  slug = p.slug;
});

test("Validacija: prekratak naziv se odbija", { skip }, async () => {
  await admin.goto(`${BASE}/admin/events/new`, { waitUntil: "networkidle0" });
  await admin.type('input[name="name"]', "x");
  await clickText(admin, "button", "Kreiraj događaj");
  const invalid = await admin.$eval('input[name="name"]', (e) => !e.validity.valid);
  assert.ok(invalid);
});

test("Nacrt se vidi samo adminu; objava otvara javnu stranicu", { skip }, async () => {
  const guest = await newPage(null);
  const r = await guest.goto(`${BASE}/e/${slug}`);
  assert.equal(r.status(), 404);
  await admin.goto(`${BASE}/admin/events/${eventId}`, { waitUntil: "networkidle0" });
  await admin.select('select[aria-label="Status događaja"]', "PUBLISHED");
  await waitText(admin, "Status je promijenjen");
  assert.equal((await db.project.findUnique({ where: { id: eventId } })).status, "PUBLISHED");
  const r2 = await guest.goto(`${BASE}/e/${slug}`);
  assert.equal(r2.status(), 200);
  await guest.ctx.close();
});

test("Agenda: kreiranje agende i stavki, validacija vremena", { skip }, async () => {
  await admin.goto(`${BASE}/admin/events/${eventId}/agendas`, { waitUntil: "networkidle0" });
  await admin.type('input[name="title"]', "Dan 1");
  await Promise.all([admin.waitForNavigation({ waitUntil: "networkidle0" }), clickText(admin, "button", "Kreiraj agendu")]);
  agendaId = admin.url().split("/agendas/")[1];
  assert.ok(agendaId);

  const add = async (start, end, title) => {
    const form = 'form:has(input[name="agendaId"])';
    await admin.$eval(`${form} input[name="startTime"]`, (e, v) => { e.value = v; }, start);
    await admin.$eval(`${form} input[name="endTime"]`, (e, v) => { e.value = v; }, end);
    await admin.type(`${form} input[name="title"]`, title);
    await clickText(admin, "button", "Dodaj stavku");
    await waitText(admin, "Stavka je dodana");
    await admin.reload({ waitUntil: "networkidle0" });
  };
  await add("09:00", "10:00", "Uvod");
  await add("10:00", "11:00", "Panel");
  await add("11:00", "11:15", "Pauza");
  const items = await db.agendaItem.findMany({ where: { agendaId }, orderBy: { position: "asc" } });
  assert.deepEqual(items.map((i) => i.title), ["Uvod", "Panel", "Pauza"]);

  // Kraj prije početka: server odbija.
  await admin.$eval('form:has(input[name="agendaId"]) input[name="startTime"]', (e) => { e.value = "12:00"; });
  await admin.$eval('form:has(input[name="agendaId"]) input[name="endTime"]', (e) => { e.value = "11:00"; });
  await admin.type('form:has(input[name="agendaId"]) input[name="title"]', "Loše");
  await clickText(admin, "button", "Dodaj stavku");
  await waitText(admin, "Kraj ne može biti prije početka");
  assert.equal(await db.agendaItem.count({ where: { agendaId } }), 3);
});

test("Autosave: izmjena naslova se sama sprema", { skip }, async () => {
  const sel = '.item input[type="text"][maxlength="200"]';
  const first = (await admin.$$(sel))[0];
  await first.focus();
  await admin.keyboard.down("Control"); await admin.keyboard.press("KeyA"); await admin.keyboard.up("Control");
  await first.type("Uvod izmijenjen");
  await admin.waitForFunction(() => document.querySelector(".save-state.saved"), { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 1500));
  const it = await db.agendaItem.findFirst({ where: { agendaId }, orderBy: { position: "asc" } });
  assert.equal(it.title, "Uvod izmijenjen");
});

test("Autosave: nevažeće vrijeme se ne šalje serveru", { skip }, async () => {
  const card = (await admin.$$(".item"))[1];
  const end = await card.$('input[type="time"]:nth-of-type(1)');
  assert.ok(end);
  await card.$eval('.grid3 label:nth-child(2) input', (e) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(e, "08:00"); e.dispatchEvent(new Event("input", { bubbles: true })); });
  await admin.waitForFunction(() => document.querySelector(".save-state.error"), { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 1500));
  const it = await db.agendaItem.findFirst({ where: { agendaId, title: "Panel" } });
  assert.equal(it.endTime, "11:00");
  await admin.reload({ waitUntil: "networkidle0" });
});

test("Drag-and-drop mijenja redoslijed stavki", { skip }, async () => {
  const tick = () => new Promise((r) => setTimeout(r, 150));
  const fire = (idxFrom, idxTo, type) => admin.evaluate((a, b, t) => {
    window.__dt ??= new DataTransfer();
    const el = t === "dragstart" || t === "dragend" ? document.querySelectorAll(".handle")[a] : document.querySelectorAll(".item")[b];
    el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
  }, idxFrom, idxTo, type);
  await fire(2, 0, "dragstart"); await tick();
  await fire(2, 0, "dragover"); await tick();
  await fire(2, 0, "drop"); await tick();
  await fire(2, 0, "dragend");
  await waitText(admin, "Redoslijed je sačuvan");
  const items = await db.agendaItem.findMany({ where: { agendaId }, orderBy: { position: "asc" } });
  assert.deepEqual(items.map((i) => i.title), ["Pauza", "Uvod izmijenjen", "Panel"]);
});

test("Dugmad gore/dolje mijenjaju redoslijed, brisanje traži potvrdu", { skip }, async () => {
  await admin.reload({ waitUntil: "networkidle0" });
  await (await admin.$$('button[aria-label*="dolje"]'))[0].click();
  await waitText(admin, "Redoslijed je sačuvan");
  const items = await db.agendaItem.findMany({ where: { agendaId }, orderBy: { position: "asc" } });
  assert.deepEqual(items.map((i) => i.title), ["Uvod izmijenjen", "Pauza", "Panel"]);

  // Odustani ne briše
  await (await admin.$$(".item .btn.dark"))[0].click();
  await admin.waitForSelector("dialog[open]");
  await clickText(admin, "dialog[open] button", "Odustani");
  assert.equal(await db.agendaItem.count({ where: { agendaId } }), 3);
  // Potvrda briše
  await (await admin.$$(".item .btn.dark"))[2].click();
  await admin.waitForSelector("dialog[open]");
  await clickText(admin, "dialog[open] button", "Obriši");
  await waitText(admin, "Stavka je obrisana");
  assert.equal(await db.agendaItem.count({ where: { agendaId } }), 2);
});

test("Javni linkovi: događaj i agenda se prikazuju, imaju kopiraj link", { skip }, async () => {
  const pub = await newPage(null);
  await pub.goto(`${BASE}/e/${slug}`, { waitUntil: "networkidle0" });
  assert.match(await pub.evaluate(() => document.body.innerText), /Dan 1/);
  assert.match(await pub.evaluate(() => document.body.innerText), /Kopiraj link događaja/);
  const a = await db.agenda.findUnique({ where: { id: agendaId } });
  const r = await pub.goto(`${BASE}/e/${slug}/agenda/${a.slug}`, { waitUntil: "networkidle0" });
  assert.equal(r.status(), 200);
  assert.match(await pub.evaluate(() => document.body.innerText), /Uvod izmijenjen/);
  await pub.ctx.close();
});

test("Lunch: admin kreira anketu i opcije, korisnik glasa i mijenja glas kroz UI", { skip }, async () => {
  await admin.goto(`${BASE}/admin/events/${eventId}/lunch`, { waitUntil: "networkidle0" });
  await clickText(admin, "button", "Kreiraj anketu");
  await waitText(admin, "Anketa je kreirana");
  await admin.reload({ waitUntil: "networkidle0" });
  for (const [n, al] of [["Piletina", "bez"], ["Pasta", "gluten"]]) {
    const f = 'form:has(input[name="pollId"])';
    await admin.type(`${f} input[name="name"]`, n);
    await admin.type(`${f} input[name="allergens"]`, al);
    await clickText(admin, "button", "Dodaj opciju");
    await waitText(admin, "Opcija je dodana");
    await admin.reload({ waitUntil: "networkidle0" });
  }
  const poll = await db.lunchPoll.findFirst({ where: { projectId: eventId }, include: { options: { orderBy: { position: "asc" } } } });
  assert.equal(poll.options.length, 2);

  await user.goto(`${BASE}/e/${slug}/lunch`, { waitUntil: "networkidle0" });
  await clickText(user, "label.opt", "Piletina");
  await clickText(user, "button", "Glasaj");
  await waitText(user, "Glas je zabilježen");
  await user.reload({ waitUntil: "networkidle0" });
  assert.match(await user.evaluate(() => document.body.innerText), /tvoj izbor/);
  await clickText(user, "label.opt", "Pasta");
  await clickText(user, "button", "Promijeni glas");
  await waitText(user, "Glas je promijenjen");
  const votes = await db.lunchVote.findMany({ where: { pollId: poll.id } });
  assert.equal(votes.length, 1);
  assert.equal(votes[0].optionId, poll.options[1].id);

  // Rezultati nisu vidljivi dok je anketa otvorena (zadano)
  await user.reload({ waitUntil: "networkidle0" });
  assert.doesNotMatch(await user.evaluate(() => document.body.innerText), /Rezultati ·/);
  // Admin vidi ko je glasao
  await admin.reload({ waitUntil: "networkidle0" });
  assert.match(await admin.evaluate(() => document.body.innerText), /Ko je glasao/);
});

test("Lunch: guest vidi poziv za prijavu umjesto glasanja", { skip }, async () => {
  const g = await newPage(null);
  await g.goto(`${BASE}/e/${slug}/lunch`, { waitUntil: "networkidle0" });
  const t = await g.evaluate(() => document.body.innerText);
  assert.match(t, /Prijavi se da glasaš/);
  assert.equal(await g.$('button[type="submit"]'), null);
  await g.ctx.close();
});

test("Feedback: identificirana forma, banner prije slanja, slanje kroz UI, drugi put blokirano", { skip }, async () => {
  await admin.goto(`${BASE}/admin/events/${eventId}/feedback`, { waitUntil: "networkidle0" });
  await admin.select('select[name="mode"]', "IDENTIFIED");
  await clickText(admin, "button", "Kreiraj formu");
  await waitText(admin, "Forma je kreirana");
  await admin.reload({ waitUntil: "networkidle0" });
  const form = await db.feedbackForm.findFirst({ where: { projectId: eventId }, include: { questions: true } });
  assert.equal(form.mode, "IDENTIFIED");
  assert.equal(form.questions.length, 9);

  const guest = await newPage(null);
  await guest.goto(`${BASE}/e/${slug}/feedback`, { waitUntil: "networkidle0" });
  const gt = await guest.evaluate(() => document.body.innerText);
  assert.match(gt, /Nije anonimno/);
  assert.match(gt, /Prijavi se da pošalješ feedback/);
  await guest.ctx.close();

  await user.goto(`${BASE}/e/${slug}/feedback`, { waitUntil: "networkidle0" });
  assert.match(await user.evaluate(() => document.body.innerText), /Nije anonimno/);
  await clickText(user, "button", "Pošalji feedback");
  await waitText(user, "Obavezno pitanje"); // prvo pitanje je obavezno
  await (await user.$$(".stars"))[0].$("label:nth-child(5)").then((l) => l.click());
  await clickText(user, "button", "Pošalji feedback");
  await waitText(user, "Hvala na feedbacku");
  assert.equal(await db.feedbackResponse.count({ where: { formId: form.id, userId: { not: null } } }), 1);
  await user.reload({ waitUntil: "networkidle0" });
  assert.match(await user.evaluate(() => document.body.innerText), /Već si poslao/);
});

test("Feedback: način se ne može promijeniti nakon prvog odgovora", { skip }, async () => {
  await admin.goto(`${BASE}/admin/events/${eventId}/feedback`, { waitUntil: "networkidle0" });
  await admin.select('select[name="mode"]', "ANONYMOUS");
  await clickText(admin, "button", "Sačuvaj formu");
  await waitText(admin, "ne može promijeniti jer već postoje odgovori");
  assert.equal((await db.feedbackForm.findFirst({ where: { projectId: eventId } })).mode, "IDENTIFIED");
  assert.match(await admin.evaluate(() => document.body.innerText), /dev\.user@example\.com/);
});

test("Feedback: admin dodaje pitanja svih tipova", { skip }, async () => {
  await admin.goto(`${BASE}/admin/events/${eventId}/feedback`, { waitUntil: "networkidle0" });
  const f = 'form:has(input[name="formId"])';
  await admin.type(`${f} input[name="label"]`, "Kratko pitanje");
  await admin.select(`${f} select[name="type"]`, "SHORT_TEXT");
  await clickText(admin, "button", "Dodaj pitanje");
  await waitText(admin, "Pitanje je dodano");
  await admin.reload({ waitUntil: "networkidle0" });
  await admin.type(`${f} input[name="label"]`, "Izbor");
  await admin.select(`${f} select[name="type"]`, "SINGLE_CHOICE");
  await clickText(admin, "button", "Dodaj pitanje");
  await waitText(admin, "bar dvije opcije"); // validacija
  await admin.type(`${f} textarea[name="options"]`, "Da\nNe");
  await clickText(admin, "button", "Dodaj pitanje");
  await waitText(admin, "Pitanje je dodano");
  const qs = await db.feedbackQuestion.findMany({ where: { form: { projectId: eventId } } });
  assert.ok(qs.some((q) => q.type === "SHORT_TEXT"));
  assert.ok(qs.some((q) => q.type === "SINGLE_CHOICE" && q.options.join() === "Da,Ne"));
});

test("Profil: korisnik vidi događaj, glas i feedback", { skip }, async () => {
  await user.goto(`${BASE}/profile`, { waitUntil: "networkidle0" });
  const t = await user.evaluate(() => document.body.innerText);
  assert.match(t, new RegExp(evName));
  assert.match(t, /Pasta/);
  assert.match(t, /Poslano/);
  assert.match(t, /Odjavi se/);
});

test("Duplikat događaja kao šablon i brisanje s potvrdom", { skip }, async () => {
  await admin.goto(`${BASE}/admin/events/${eventId}`, { waitUntil: "networkidle0" });
  await Promise.all([admin.waitForNavigation({ waitUntil: "networkidle0" }), (async () => { await clickText(admin, "button", "Dupliciraj kao šablon"); await admin.waitForSelector("dialog[open]"); await clickText(admin, "dialog[open] button", "Dupliciraj"); })()]);
  const copyId = admin.url().split("/admin/events/")[1].split("/")[0];
  assert.notEqual(copyId, eventId);
  const copy = await db.project.findUnique({ where: { id: copyId }, include: { agendas: { include: { items: true } }, polls: { include: { options: true, votes: true } }, forms: { include: { questions: true, responses: true } } } });
  assert.equal(copy.status, "DRAFT");
  assert.equal(copy.agendas[0].items.length, 2);
  assert.equal(copy.polls[0].options.length, 2);
  assert.equal(copy.polls[0].votes.length, 0, "glasovi se ne kopiraju");
  assert.ok(copy.forms[0].questions.length >= 9);
  assert.equal(copy.forms[0].responses.length, 0, "odgovori se ne kopiraju");

  await Promise.all([admin.waitForNavigation({ waitUntil: "networkidle0" }), (async () => {
    await clickText(admin, "button", "Obriši događaj"); await admin.waitForSelector("dialog[open]");
    const btn = await admin.evaluateHandle(() => [...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent.includes("Obriši trajno")));
    assert.ok(await btn.evaluate((b) => b.disabled), "bez upisa naziva dugme je onemogućeno");
    await admin.type("dialog[open] input[type=text]", copy.name);
    await clickText(admin, "dialog[open] button", "Obriši trajno");
  })()]);
  assert.equal(await db.project.findUnique({ where: { id: copyId } }), null);
  assert.match(admin.url(), /\/admin\/events$/);
});

test("Arhiviranje: događaj ostaje javan, glasanje zatvoreno", { skip }, async () => {
  await admin.goto(`${BASE}/admin/events/${eventId}`, { waitUntil: "networkidle0" });
  await clickText(admin, "button", "Arhiviraj");
  await admin.waitForSelector("dialog[open]");
  await clickText(admin, "dialog[open] button", "Arhiviraj");
  await waitText(admin, "Događaj je arhiviran");
  assert.equal((await db.project.findUnique({ where: { id: eventId } })).status, "ARCHIVED");
  await user.goto(`${BASE}/e/${slug}/lunch`, { waitUntil: "networkidle0" });
  assert.match(await user.evaluate(() => document.body.innerText), /Glasanje je zatvoreno/);
  assert.match(await user.evaluate(() => document.body.innerText), /Rezultati ·/); // zatvoreno => rezultati vidljivi
});

test("Admin pretraga i filter događaja", { skip }, async () => {
  await admin.goto(`${BASE}/admin/events?q=${tag}&status=ARCHIVED`, { waitUntil: "networkidle0" });
  assert.match(await admin.evaluate(() => document.body.innerText), new RegExp(evName));
  await admin.goto(`${BASE}/admin/events?q=${tag}&status=DRAFT`, { waitUntil: "networkidle0" });
  assert.match(await admin.evaluate(() => document.body.innerText), /Nema rezultata/);
});

test("Responzivnost: nema horizontalnog scrolla na 390px (javno, admin, profil)", { skip }, async () => {
  await db.project.update({ where: { id: eventId }, data: { status: "PUBLISHED" } });
  const m = await newPage("admin", { width: 390, height: 800 });
  for (const path of [`/e/${slug}`, `/e/${slug}/lunch`, `/e/${slug}/feedback`, "/profile", "/admin", "/admin/events", `/admin/events/${eventId}`, `/admin/events/${eventId}/agendas/${agendaId}`, `/admin/events/${eventId}/feedback`, `/admin/events/${eventId}/lunch`, "/admin/participants"]) {
    await m.goto(BASE + path, { waitUntil: "networkidle0" });
    const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 1, `${path}: horizontalni overflow ${over}px`);
    await shot(m, "m" + path.replace(/[^a-z0-9]+/gi, "_").slice(0, 50));
  }
  await m.ctx.close();
});

test("Pristupačnost (osnovne provjere): slike imaju alt, kontrole imaju imena, jedan h1", { skip }, async () => {
  const p = await newPage("admin");
  for (const path of [`/e/${slug}`, `/e/${slug}/lunch`, `/e/${slug}/feedback`, "/admin", `/admin/events/${eventId}/agendas/${agendaId}`, `/admin/events/${eventId}/feedback`]) {
    await p.goto(BASE + path, { waitUntil: "networkidle0" });
    const r = await p.evaluate(() => {
      const name = (el) => (el.getAttribute("aria-label") || el.textContent || el.value || el.title || "").trim();
      const noAlt = [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length;
      const btn = [...document.querySelectorAll("button, a[href]")].filter((b) => !name(b)).length;
      const inputs = [...document.querySelectorAll("input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea, select")].filter((i) => !(i.labels && i.labels.length) && !i.getAttribute("aria-label")).length;
      const h1 = document.querySelectorAll("h1").length;
      return { noAlt, btn, inputs, h1, lang: document.documentElement.lang };
    });
    assert.equal(r.noAlt, 0, path + " slike bez alt");
    assert.equal(r.btn, 0, path + " dugmad/linkovi bez imena");
    assert.equal(r.inputs, 0, path + " polja bez labele");
    assert.ok(r.h1 <= 1, path + " više h1");
    assert.equal(r.lang, "bs");
  }
  // Tastatura: dijalog se zatvara na Esc (brisanje je dostupno samo iz Nacrta ili Arhive)
  await db.project.update({ where: { id: eventId }, data: { status: "ARCHIVED" } });
  await p.goto(`${BASE}/admin/events/${eventId}`, { waitUntil: "networkidle0" });
  await clickText(p, "button", "Obriši događaj");
  await p.waitForSelector("dialog[open]");
  await p.keyboard.press("Escape");
  assert.equal(await p.$("dialog[open]"), null);
  await p.ctx.close();
});
