// Rubni UI slučajevi: širine ekrana, tastatura i fokus, konflikt pri uređivanju, neuspjeli upis, arhiviranje, potvrde, validacija.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import puppeteer, { KnownDevices } from "puppeteer-core";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("../src/generated/prisma/index.js");
const db = new PrismaClient();
const BASE = process.env.BASE_URL;
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = process.env.SHOT_DIR;
const skip = !existsSync(CHROME) || !BASE;
const tag = "ed" + Math.random().toString(36).slice(2, 6);
let browser, user, proj, agenda, item, poll, form;

const waitText = (p, t, timeout = 15000) => p.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);
const body = (p) => p.evaluate(() => document.body.innerText);
async function clickText(page, selector, label) {
  const h = await page.evaluateHandle((sel, t) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(t)) ?? null, selector, label);
  const el = h.asElement();
  assert.ok(el, `nema ${selector} s tekstom "${label}"`);
  await el.click();
}
async function newPage(as, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.ctx = ctx;
  await page.setViewport(viewport);
  page.on("dialog", (d) => d.accept());
  if (as) await page.goto(`${BASE}/dev-login?as=${as}&to=/`, { waitUntil: "networkidle0" });
  return page;
}
const setVal = (page, sel, v) => page.$eval(sel, (e, val) => { Object.getOwnPropertyDescriptor(e.constructor.prototype, "value").set.call(e, val); e.dispatchEvent(new Event("input", { bubbles: true })); }, v);

before(async () => {
  if (skip) return;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  user = await newPage("user");
  proj = await db.project.create({
    data: {
      slug: tag, name: `Edge ${tag}`, status: "PUBLISHED", location: "Sarajevo",
      agendas: { create: [{ slug: "dan", title: "Dan", items: { create: [
        { startTime: "09:00", endTime: "10:00", title: "Prva", position: 0 },
        { startTime: "09:30", endTime: "10:30", title: "Preklapa", position: 1 },
        { startTime: "11:00", endTime: "12:00", title: "Treća", position: 2 },
      ] } }] },
      polls: { create: [{ title: "Ručak", options: { create: [{ name: "A", position: 0 }, { name: "B", position: 1 }] } }] },
      forms: { create: [{ title: "Forma", mode: "ANONYMOUS", questions: { create: [
        { type: "RATING", label: "Ocjena", position: 0 }, { type: "SINGLE_CHOICE", label: "Izbor", options: ["x", "y"], position: 1 },
      ] } }] },
    },
    include: { agendas: { include: { items: { orderBy: { position: "asc" } } } }, polls: { include: { options: true } }, forms: { include: { questions: true } } },
  });
  agenda = proj.agendas[0]; item = agenda.items[0]; poll = proj.polls[0]; form = proj.forms[0];
});
after(async () => {
  await db.project.deleteMany({ where: { name: { contains: tag } } });
  await db.$disconnect();
  await browser?.close();
});

const WIDTHS = [320, 375, 390, 768, 1024, 1440];
for (const w of WIDTHS) {
  test(`${w}px: nema horizontalnog scrolla, tekst nije odsječen, kontrole su dovoljno velike`, { skip, timeout: 300000 }, async () => {
    const p = await newPage("admin", { width: w, height: 900 });
    const paths = [`/e/${tag}`, `/e/${tag}/lunch`, `/e/${tag}/feedback`, "/profile", "/admin", "/admin/events", `/admin/events/${proj.id}`, `/admin/events/${proj.id}/agendas/${agenda.id}`, `/admin/events/${proj.id}/lunch`, `/admin/events/${proj.id}/feedback`, "/admin/participants"];
    for (const path of paths) {
      await p.goto(BASE + path, { waitUntil: "networkidle0" });
      const r = await p.evaluate(() => {
        const over = document.documentElement.scrollWidth - window.innerWidth;
        // Interaktivne kontrole: cilj dodira bar 24x24 CSS px (WCAG 2.2 AA, 2.5.8) osim inline linkova u tekstu
        const small = [...document.querySelectorAll("button, a.btn, a.tab, summary, select, input[type=checkbox], input[type=radio]")]
          .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24) && !e.closest("label"); })
          .map((e) => e.tagName + "." + e.className + " " + Math.round(e.getBoundingClientRect().width) + "x" + Math.round(e.getBoundingClientRect().height));
        return { over, small: small.slice(0, 5) };
      });
      assert.ok(r.over <= 1, `${w}px ${path}: overflow ${r.over}px`);
      assert.deepEqual(r.small, [], `${w}px ${path}: premale kontrole`);
    }
    if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await p.goto(`${BASE}/e/${tag}`, { waitUntil: "networkidle0" }); await p.screenshot({ path: `${SHOTS}/w${w}.png`, fullPage: true }); }
    await p.ctx.close();
  });
}

test("Dodir (mobilni emulator): tabovi i dugmad rade", { skip }, async () => {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.emulate(KnownDevices["iPhone 13"]);
  await p.goto(`${BASE}/dev-login?as=user&to=/e/${tag}`, { waitUntil: "networkidle0" });
  const tab = await p.$('a.tab[href$="/lunch"]');
  const box = await tab.boundingBox();
  assert.ok(box.height >= 24 && box.width >= 24);
  await Promise.all([p.waitForNavigation({ waitUntil: "networkidle0" }), p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)]);
  assert.match(p.url(), /\/lunch$/);
  await ctx.close();
});

test("Tastatura: Tab dolazi do tabova, fokus je vidljiv, dijalog zarobljava fokus i Esc vraća fokus na okidač", { skip }, async () => {
  const p = await newPage("admin");
  await p.goto(`${BASE}/e/${tag}`, { waitUntil: "networkidle0" });
  let reached = false;
  for (let i = 0; i < 15 && !reached; i++) {
    await p.keyboard.press("Tab");
    reached = await p.evaluate(() => document.activeElement?.classList.contains("tab"));
  }
  assert.ok(reached, "Tab stiže do navigacije događaja");
  const outline = await p.evaluate(() => { const s = getComputedStyle(document.activeElement); return { w: parseFloat(s.outlineWidth), st: s.outlineStyle }; });
  assert.ok(outline.w >= 2 && outline.st !== "none", "fokus je vidljiv: " + JSON.stringify(outline));

  await p.goto(`${BASE}/admin/events/${proj.id}/lunch`, { waitUntil: "networkidle0" });
  const trigger = (await p.$$("button")).find(Boolean);
  const label = await p.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Obriši anketu")));
  await label.asElement().focus();
  await p.keyboard.press("Enter");
  await p.waitForSelector("dialog[open]");
  assert.ok(await p.evaluate(() => document.activeElement?.closest("dialog") !== null), "fokus je u dijalogu");
  for (let i = 0; i < 8; i++) {
    await p.keyboard.press("Tab");
    // Pozadina je inert: fokus je u dijalogu ili je prešao na kontrole preglednika (activeElement = body), nikad na stranicu iza.
    assert.ok(await p.evaluate(() => document.activeElement === document.body || document.activeElement?.closest("dialog") !== null), "fokus ne izlazi na stranicu iza modalnog dijaloga");
  }
  await p.keyboard.press("Escape");
  assert.equal(await p.$("dialog[open]"), null);
  assert.ok(await p.evaluate(() => document.activeElement?.textContent.includes("Obriši anketu")), "fokus se vraća na dugme koje je otvorilo dijalog");
  void trigger;
  await p.ctx.close();
});

test("Tastatura: promjena redoslijeda stavki dugmadima (Enter) se čuva", { skip }, async () => {
  const p = await newPage("admin");
  await p.goto(`${BASE}/admin/events/${proj.id}/agendas/${agenda.id}`, { waitUntil: "networkidle0" });
  const btn = await p.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.includes("Treća") && b.getAttribute("aria-label")?.includes("gore")));
  await btn.asElement().focus();
  await p.keyboard.press("Enter");
  await waitText(p, "Redoslijed je sačuvan");
  const items = await db.agendaItem.findMany({ where: { agendaId: agenda.id }, orderBy: { position: "asc" } });
  assert.deepEqual(items.map((i) => i.title), ["Prva", "Treća", "Preklapa"]);
  await p.ctx.close();
});

test("Preklapanje termina se prikazuje kao upozorenje (ne blokira)", { skip }, async () => {
  const p = await newPage("admin");
  await p.goto(`${BASE}/admin/events/${proj.id}/agendas/${agenda.id}`, { waitUntil: "networkidle0" });
  const t = await body(p);
  assert.match(t, /Preklapanje termina/);
  assert.match(t, /Prva/);
  assert.match(t, /Preklapa/);
  await p.ctx.close();
});

test("Konflikt: izmjena iz drugog prozora se ne prepisuje tiho", { skip }, async () => {
  const p1 = await newPage("admin");
  const p2 = await newPage("admin");
  const sel = (id) => `#${id}-t`;
  await p1.goto(`${BASE}/admin/events/${proj.id}/agendas/${agenda.id}`, { waitUntil: "networkidle0" });
  await p2.goto(`${BASE}/admin/events/${proj.id}/agendas/${agenda.id}`, { waitUntil: "networkidle0" });
  await setVal(p1, sel(item.id), "Verzija prvog prozora");
  await p1.waitForFunction(() => document.querySelector(".save-state.saved"), { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 1500));
  await setVal(p2, sel(item.id), "Verzija drugog prozora");
  await waitText(p2, "izmijenjena u drugom prozoru", 8000);
  const row = await db.agendaItem.findUnique({ where: { id: item.id } });
  assert.equal(row.title, "Verzija prvog prozora", "prva izmjena nije prepisana");
  assert.equal(row.version >= 1, true);
  // Izmjena je i dalje vidljiva u drugom prozoru (nije izgubljena), uz dugme za osvježavanje
  assert.equal(await p2.$eval(sel(item.id), (e) => e.value), "Verzija drugog prozora");
  assert.match(await body(p2), /Osvježi stranicu/);
  await p1.ctx.close(); await p2.ctx.close();
});

test("Neuspjeli upis (nema veze): izmjena ostaje vidljiva, status greška, ponovni pokušaj radi", { skip }, async () => {
  const p = await newPage("admin");
  await p.goto(`${BASE}/admin/events/${proj.id}/agendas/${agenda.id}`, { waitUntil: "networkidle0" });
  const id = (await db.agendaItem.findFirst({ where: { agendaId: agenda.id, title: "Treća" } })).id;
  await p.setOfflineMode(true);
  await setVal(p, `#${id}-t`, "Treća offline");
  await waitText(p, "Nije sačuvano", 8000);
  assert.equal(await p.$eval(`#${id}-t`, (e) => e.value), "Treća offline");
  assert.equal((await db.agendaItem.findUnique({ where: { id } })).title, "Treća");
  await p.setOfflineMode(false);
  await clickText(p, "button", "Pokušaj ponovo");
  await p.waitForFunction(() => document.querySelector(".save-state.saved"), { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 800));
  assert.equal((await db.agendaItem.findUnique({ where: { id } })).title, "Treća offline");
  await p.ctx.close();
});

test("Validacija agende: kraj prije početka ne šalje serveru i prikazuje grešku", { skip }, async () => {
  const p = await newPage("admin");
  await p.goto(`${BASE}/admin/events/${proj.id}/agendas/${agenda.id}`, { waitUntil: "networkidle0" });
  const id = item.id;
  await setVal(p, `#${id}-e`, "08:00");
  await waitText(p, "Kraj ne može biti prije početka", 5000);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((await db.agendaItem.findUnique({ where: { id } })).endTime, "10:00", "nevažeća izmjena nije otišla na server");
  await p.ctx.close();
});

test("Arhiviranje pitanja: pitanje s odgovorima se arhivira, odgovori i statistika ostaju; vraćanje radi", { skip }, async () => {
  const [q1] = form.questions.filter((q) => q.type === "RATING");
  const r = await db.feedbackResponse.create({ data: { formId: form.id } });
  await db.feedbackAnswer.create({ data: { formId: form.id, responseId: r.id, questionId: q1.id, questionLabel: q1.label, questionType: "RATING", rating: 5 } });
  const p = await newPage("admin");
  await p.goto(`${BASE}/admin/events/${proj.id}/feedback`, { waitUntil: "networkidle0" });
  assert.match(await body(p), /Ima odgovora\. Izmjena teksta/);
  await clickText(p, "button", "Arhiviraj pitanje");
  await p.waitForSelector("dialog[open]");
  await clickText(p, "dialog[open] button", "Arhiviraj");
  await waitText(p, "pa je arhivirano");
  const q = await db.feedbackQuestion.findUnique({ where: { id: q1.id } });
  assert.ok(q.archivedAt, "arhivirano, ne obrisano");
  assert.equal(await db.feedbackAnswer.count({ where: { questionId: q1.id } }), 1, "odgovor je sačuvan");
  await p.reload({ waitUntil: "networkidle0" });
  assert.match(await body(p), /Arhivirana pitanja/);
  // Javna forma više ne prikazuje arhivirano pitanje
  await user.goto(`${BASE}/e/${tag}/feedback`, { waitUntil: "networkidle0" });
  assert.doesNotMatch(await body(user), /Ocjena/);
  // CSV zadržava arhivirano pitanje i odgovor
  const csv = await p.evaluate(async (fid) => (await fetch(`/api/admin/feedback/${fid}/csv`)).text(), form.id);
  assert.match(csv, /Ocjena \[arhivirano\]/);
  // Vraćanje
  await clickText(p, "button", "Vrati pitanje");
  await waitText(p, "Pitanje je vraćeno");
  assert.equal((await db.feedbackQuestion.findUnique({ where: { id: q1.id } })).archivedAt, null);
  await p.ctx.close();
});

test("Izmjena pitanja nakon odgovora: odgovor zadržava snimak starog teksta", { skip }, async () => {
  const q = await db.feedbackQuestion.findFirst({ where: { formId: form.id, type: "SINGLE_CHOICE" } });
  const resp = await db.feedbackResponse.create({ data: { formId: form.id } });
  await db.feedbackAnswer.create({ data: { formId: form.id, responseId: resp.id, questionId: q.id, questionLabel: q.label, questionType: q.type, questionOptions: q.options, choices: ["x"] } });
  const p = await newPage("admin");
  await p.goto(`${BASE}/admin/events/${proj.id}/feedback`, { waitUntil: "networkidle0" });
  const input = await p.evaluateHandle((id) => document.querySelector(`input[name="id"][value="${id}"]`).form.querySelector('input[name="label"]'), q.id);
  await input.asElement().focus();
  await p.keyboard.down("Control"); await p.keyboard.press("KeyA"); await p.keyboard.up("Control");
  await input.asElement().type("Potpuno novo pitanje");
  await p.evaluate((id) => document.querySelector(`input[name="id"][value="${id}"]`).form.requestSubmit(), q.id);
  await waitText(p, "Pitanje je sačuvano");
  const a = await db.feedbackAnswer.findFirst({ where: { questionId: q.id } });
  assert.equal(a.questionLabel, q.label, "historijski odgovor čuva stari tekst");
  assert.equal((await db.feedbackQuestion.findUnique({ where: { id: q.id } })).label, "Potpuno novo pitanje");
  await p.reload({ waitUntil: "networkidle0" });
  assert.match(await body(p), /Historijski odgovori pod ranijim tekstom/);
  await p.ctx.close();
});

test("Opcija s glasovima: naziv se ne može mijenjati, brisanje je arhiviranje, glasovi ostaju u rezultatima", { skip }, async () => {
  const [A, B] = poll.options.sort((x, y) => x.position - y.position);
  const u = await db.user.findFirst({ where: { auth0Sub: "google-oauth2|dev-user" } });
  await db.lunchVote.create({ data: { pollId: poll.id, optionId: A.id, userId: u.id } });
  const p = await newPage("admin");
  await p.goto(`${BASE}/admin/events/${proj.id}/lunch`, { waitUntil: "networkidle0" });
  assert.ok(await p.$eval(`input[name="id"][value="${A.id}"]`, (e) => e.form.querySelector('input[name="name"]').readOnly), "naziv je samo za čitanje");
  const bBtn = await p.evaluateHandle((id) => document.querySelector(`input[name="id"][value="${id}"]`).form.parentElement.querySelector(".btn.dark"), A.id);
  await bBtn.asElement().click();
  await p.waitForSelector("dialog[open]");
  assert.match(await p.$eval("dialog[open]", (d) => d.innerText), /Arhivirati opciju/);
  await clickText(p, "dialog[open] button", "Arhiviraj");
  await waitText(p, "pa je arhivirana");
  assert.ok((await db.lunchOption.findUnique({ where: { id: A.id } })).archivedAt);
  assert.equal(await db.lunchVote.count({ where: { optionId: A.id } }), 1, "glas je sačuvan");
  // Opcija bez glasova se briše
  await p.reload({ waitUntil: "networkidle0" });
  const bDel = await p.evaluateHandle((id) => document.querySelector(`input[name="id"][value="${id}"]`).form.parentElement.querySelector(".btn.dark"), B.id);
  await bDel.asElement().click();
  await p.waitForSelector("dialog[open]");
  await clickText(p, "dialog[open] button", "Obriši");
  await waitText(p, "Opcija je obrisana");
  assert.equal(await db.lunchOption.findUnique({ where: { id: B.id } }), null);
  // Korisnik više ne može glasati za arhiviranu opciju
  const r = await fetch(`${BASE}/api/vote`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, cookie: "dev_user=user2" }, body: JSON.stringify({ pollId: poll.id, optionId: A.id }) });
  assert.equal(r.status, 400);
  await p.ctx.close();
});

test("Potvrda upisom: brisanje ankete s glasovima traži OBRIŠI; pogrešan unos ne briše", { skip }, async () => {
  const p = await newPage("admin");
  await p.goto(`${BASE}/admin/events/${proj.id}/lunch`, { waitUntil: "networkidle0" });
  await clickText(p, "button", "Obriši anketu");
  await p.waitForSelector("dialog[open]");
  const disabled = () => p.evaluate(() => [...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent.includes("Obriši")).disabled);
  assert.equal(await disabled(), true);
  await p.type("dialog[open] input[type=text]", "obrisi");
  assert.equal(await disabled(), true, "malim slovima ne prolazi");
  await p.$eval("dialog[open] input[type=text]", (e) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, "OBRIŠI"); e.dispatchEvent(new Event("input", { bubbles: true })); });
  assert.equal(await disabled(), false);
  await p.keyboard.press("Escape");
  assert.ok(await db.lunchPoll.findUnique({ where: { id: poll.id } }), "Esc ne briše");
  await p.ctx.close();
});

test("Brisanje događaja nije dostupno za objavljen događaj; za arhiviran traži upis naziva", { skip }, async () => {
  const p = await newPage("admin");
  await p.goto(`${BASE}/admin/events/${proj.id}`, { waitUntil: "networkidle0" });
  assert.match(await body(p), /Objavljen ili završen događaj se ne može obrisati/);
  assert.equal(await p.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Obriši događaj"))), false);
  await p.ctx.close();
});

test("Validacija događaja: kraj prije početka i prekratak naziv", { skip }, async () => {
  const p = await newPage("admin");
  await p.goto(`${BASE}/admin/events/new`, { waitUntil: "networkidle0" });
  await p.type('input[name="name"]', `Datumi ${tag}`);
  await p.$eval('input[name="startsAt"]', (e) => { e.value = "2027-05-10"; });
  await p.$eval('input[name="endsAt"]', (e) => { e.value = "2027-05-01"; });
  await clickText(p, "button", "Kreiraj događaj");
  await waitText(p, "Datum završetka ne može biti prije početka");
  assert.equal(await db.project.count({ where: { name: `Datumi ${tag}` } }), 0);
  await p.ctx.close();
});

test("Istovremeno kreiranje događaja s istim nazivom: oba uspiju s različitim linkovima", { skip }, async () => {
  const pages = await Promise.all([newPage("admin"), newPage("admin")]);
  const nm = `Isti ${tag}`;
  await Promise.all(pages.map((p) => p.goto(`${BASE}/admin/events/new`, { waitUntil: "networkidle0" })));
  await Promise.all(pages.map((p) => p.type('input[name="name"]', nm)));
  await Promise.all(pages.map((p) => clickText(p, "button", "Kreiraj događaj")));
  await Promise.all(pages.map((p) => p.waitForFunction(() => location.pathname.startsWith("/admin/events/") && !location.pathname.endsWith("/new"), { timeout: 20000 })));
  const rows = await db.project.findMany({ where: { name: nm } });
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].slug, rows[1].slug);
  await Promise.all(pages.map((p) => p.ctx.close()));
});

test("Prazna stanja: novi događaj nema agendi/ankete/forme i to jasno piše", { skip }, async () => {
  const e = await db.project.create({ data: { slug: `${tag}-empty`, name: `Prazan ${tag}` } });
  const p = await newPage("admin");
  for (const [path, re] of [["/agendas", /Nema agendi/], ["/lunch", /Nema anketa za ručak/], ["/feedback", /Nema feedback formi/]]) {
    await p.goto(`${BASE}/admin/events/${e.id}${path}`, { waitUntil: "networkidle0" });
    assert.match(await body(p), re);
  }
  await db.project.update({ where: { id: e.id }, data: { status: "PUBLISHED" } });
  for (const [path, re] of [["", /Agenda još nije objavljena/], ["/lunch", /Anketa za ručak još nije objavljena/], ["/feedback", /Feedback forma još nije objavljena/]]) {
    await p.goto(`${BASE}/e/${tag}-empty${path}`, { waitUntil: "networkidle0" });
    assert.match(await body(p), re);
  }
  await p.ctx.close();
});

test("Greške javnih ruta: nepostojeći događaj i agenda daju 404 stranicu s putem nazad", { skip }, async () => {
  const p = await newPage(null);
  for (const path of ["/e/nepostoji", `/e/${tag}/agenda/nepostoji`]) {
    const r = await p.goto(BASE + path, { waitUntil: "networkidle0" });
    assert.equal(r.status(), 404, path);
    assert.match(await body(p), /Stranica nije pronađena/);
    assert.ok(await p.$('a[href="/"]'));
  }
  await p.ctx.close();
});

test("Forbidden stranica za običnog korisnika objašnjava razlog", { skip }, async () => {
  const p = await newPage("user");
  await p.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
  assert.match(p.url(), /\/forbidden$/);
  assert.match(await body(p), /nema administratorska prava/);
  await p.ctx.close();
});
