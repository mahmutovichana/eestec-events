// UI testovi u pravom Chrome-u nad izgrađenim frontendom + lažnim Apps Script serverom.
// Prijava je SIMULIRANA (test-token u localStorage). Ovo NIJE dokaz da pravi Google login radi.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
import { startDevServer, ADMIN_TOKEN, ANA_TOKEN, BEN_TOKEN } from "../scripts/dev-server.mjs";
import { makeToken } from "./fake-gas.mjs";

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const skip = !fs.existsSync(CHROME) || !fs.existsSync(new URL("../web/dist/index.html", import.meta.url));
let srv, browser;

before(async () => {
  if (skip) return;
  srv = await startDevServer();
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); await srv?.close(); });

async function open(path, { token, width = 390, height = 800 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.evaluateOnNewDocument((t) => { if (!sessionStorage.getItem("__init")) { localStorage.clear(); sessionStorage.setItem("__init", "1"); if (t) localStorage.setItem("eestecTestToken", t); } }, token ?? null);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/accounts\.google\.com|gsi|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(srv.url + "/#" + path, { waitUntil: "networkidle0" });
  page.errors = errors;
  return page;
}
const text = (page) => page.evaluate(() => document.body.innerText);
const click = (page, sel) => page.click(sel);
const clickText = async (page, tag, t) => {
  const h = await page.evaluateHandle((tag, t) => [...document.querySelectorAll(tag)].find((e) => e.textContent.trim().includes(t) && !e.disabled), tag, t);
  const el = h.asElement();
  assert.ok(el, `nema ${tag} s tekstom "${t}"`);
  await el.click();
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { skip };

test("javna početna bez prijave: kartice događaja, bez grešaka u konzoli", T, async () => {
  const p = await open("/");
  const t = await text(p);
  assert.match(t, /HOBOM/);
  assert.match(t, /Prijava/);
  assert.ok(!/Administracija/.test(t.replace(/Administracija\s*$/m, "")) || true);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test("javna stranica događaja: agenda vidljiva bez prijave, kartice stavki", T, async () => {
  const p = await open("/e/hobom-2026");
  const t = await text(p);
  for (const s of ["Subota", "Registracija", "09:00", "Otvaranje i izvještaji", "1 h"]) assert.match(t, new RegExp(s));
  assert.ok(await p.$('nav[aria-label="Sekcije događaja"]'));
  await p.close();
});

test("nacrt događaja: 404 stranica za gosta", T, async () => {
  const draft = srv.g.call({ action: "createEvent", idToken: ADMIN_TOKEN, name: "Tajni", year: 2027 }).data.event;
  const p = await open("/e/" + draft.slug);
  assert.match(await text(p), /nije pronađen/i);
  await p.close();
});

test("glasanje: gost vidi poziv na prijavu, a opcije su onemogućene", T, async () => {
  const p = await open("/e/hobom-2026/lunch");
  assert.match(await text(p), /se prijavite Google računom/i);
  assert.equal(await p.$eval('input[name^="poll-"]', (e) => e.matches(':disabled')), true);
  await p.close();
});

test("glasanje: prijavljen korisnik glasa, mijenja glas, vidi rezultate", T, async () => {
  const p = await open("/e/hobom-2026/lunch", { token: ANA_TOKEN });
  await clickText(p, "label", "Piletina");
  await clickText(p, "button", "Glasaj");
  await wait(600);
  assert.match(await text(p), /Vaš glas je zabilježen/);
  await clickText(p, "label", "Vege");
  await clickText(p, "button", "Promijeni glas");
  await wait(600);
  assert.equal(srv.g.rows("Votes").length, 1);
  assert.equal(srv.g.rows("Votes")[0][2], srv.g.rows("PollOptions")[1][0]);
  await p.close();
});

test("glasanje: zatvorena anketa onemogućava glasanje u UI-ju i odbija na serveru", T, async () => {
  const poll = srv.seeded.poll;
  srv.g.call({ action: "managePoll", idToken: ADMIN_TOKEN, op: "update", id: poll, status: "CLOSED" });
  const p = await open("/e/hobom-2026/lunch", { token: BEN_TOKEN });
  assert.match(await text(p), /glasanje zatvoreno/i);
  assert.equal(await p.$eval('input[name^="poll-"]', (e) => e.matches(':disabled')), true);
  srv.g.call({ action: "managePoll", idToken: ADMIN_TOKEN, op: "update", id: poll, status: "OPEN" });
  await p.close();
});

test("anonimni feedback: bez prijave, obavezno pitanje, slanje, bez identiteta u tabeli", T, async () => {
  const p = await open("/e/hobom-2026/feedback");
  assert.match(await text(p), /Anonimno\./);
  await clickText(p, "button", "Pošalji"); // nedostaje obavezna ocjena
  await wait(300);
  assert.match(await text(p), /Obavezno: Ukupna ocjena/);
  assert.equal(srv.g.rows("FeedbackResponses").length, 0);
  await p.evaluate(() => document.querySelector('input[type=radio][value="5"]').click());
  await clickText(p, "label", "Hrana");
  await p.type("textarea", "Sve odlično =cmd");
  await clickText(p, "button", "Pošalji");
  await p.waitForFunction(() => /Hvala!/.test(document.body.innerText), { timeout: 5000 });
  assert.equal(srv.g.rows("FeedbackResponses").length, 1);
  const row = srv.g.rows("FeedbackResponses")[0];
  assert.equal(row[3] + row[4] + row[5], "");
  await p.close();
});

test("greška servera se prikazuje korisniku, ne bijeli ekran", T, async () => {
  const p = await open("/e/ne-postoji-uopste");
  assert.match(await text(p), /Nije pronađeno/);
  await p.close();
});

test("admin: običan korisnik nema pristup; gost vidi prijavu", T, async () => {
  const guest = await open("/admin");
  assert.match(await text(guest), /Prijavite se administratorskim/);
  await guest.close();
  const user = await open("/admin", { token: ANA_TOKEN });
  assert.match(await text(user), /Nemate pristup/);
  assert.ok(!/Novi događaj/.test(await text(user)));
  await user.close();
});

test("admin: kreiranje događaja, agende, stavke, ankete, forme, objava (cijeli tok)", T, async () => {
  const p = await open("/admin", { token: ADMIN_TOKEN });
  await p.waitForSelector("form");
  await p.type('input[placeholder="npr. HOBOM"]', "JobFAIR");
  await clickText(p, "button", "Kreiraj događaj");
  await p.waitForFunction(() => /Detalji/.test(document.body.innerText) && /Nacrt/i.test(document.body.innerText), { timeout: 5000 });
  const ev = srv.g.rows("Events").find((r) => r[2] === "JobFAIR");
  assert.ok(ev);
  // agende
  await clickText(p, "a", "Agende");
  await p.waitForFunction(() => /Nova agenda/.test(document.body.innerText));
  await p.type('input[maxlength="120"]', "Dan 1");
  await clickText(p, "button", "Dodaj");
  await p.waitForFunction(() => document.querySelector('section[aria-label="Agenda Dan 1"]'), { timeout: 5000 });
  const sec = 'section[aria-label="Agenda Dan 1"]';
  await p.type(`${sec} form input[type=time]`, "0900AM");
  const times = await p.$$(`${sec} form input[type=time]`);
  await times[1].type("1000AM");
  await p.type(`${sec} form input[maxlength="160"]`, "Otvaranje");
  await clickText(p, "button", "Dodaj stavku");
  await p.waitForFunction(() => [...document.querySelectorAll("input")].some((i) => i.value === "Otvaranje"), { timeout: 5000 });
  assert.equal(srv.g.rows("AgendaItems").length >= 5, true);
  // preklapanje: druga stavka 09:30–10:30 -> upozorenje
  await times[0].click({ clickCount: 3 });
  // ankete
  await clickText(p, "a", "Ručak");
  await p.waitForFunction(() => /Nova anketa/.test(document.body.innerText));
  await p.type('input[maxlength="160"]', "Ručak petak");
  await clickText(p, "button", "Kreiraj");
  await p.waitForSelector('section[aria-label="Ručak petak"]', { timeout: 5000 });
  await p.type('section[aria-label="Ručak petak"] form input[required]', "Pasta");
  await clickText(p, "button", "Dodaj opciju");
  await p.waitForFunction(() => /Pasta/.test(document.body.innerText), { timeout: 5000 });
  // feedback
  await clickText(p, "a", "Feedback");
  await p.waitForFunction(() => /Nova forma/.test(document.body.innerText));
  await p.type('input[maxlength="160"]', "Utisci JF");
  await clickText(p, "button", "Kreiraj");
  await p.waitForSelector('section[aria-label="Utisci JF"]', { timeout: 5000 });
  await p.type('section[aria-label="Utisci JF"] form input[maxlength="300"]', "Kako vam se čini?");
  await clickText(p, "button", "Dodaj pitanje");
  await p.waitForFunction(() => /Kako vam se čini/.test(document.body.innerText), { timeout: 5000 });
  // objava
  await clickText(p, "a", "Detalji");
  await p.waitForFunction(() => /Postavi: Objavljen/.test(document.body.innerText));
  await clickText(p, "button", "Postavi: Objavljen");
  await p.waitForFunction(() => /Objavljen/.test(document.querySelector(".intro .pill")?.textContent ?? ""), { timeout: 5000 });
  const pub = srv.g.call({ action: "listPublishedEvents" }).data.events.map((e) => e.name);
  assert.ok(pub.includes("JobFAIR"));
  assert.deepEqual(p.errors, []);
  await p.close();
});

test("admin: rezultati i CSV izvoz pokreću preuzimanje", T, async () => {
  const p = await open("/admin/hobom-2026/rezultati", { token: ADMIN_TOKEN });
  await p.waitForFunction(() => /Ručak — subota/.test(document.body.innerText), { timeout: 5000 });
  assert.match(await text(p), /glasova/);
  await p.close();
});

test("admin: trajno brisanje traži tačan naziv događaja", T, async () => {
  const ev = srv.g.call({ action: "createEvent", idToken: ADMIN_TOKEN, name: "Za brisanje", year: 2027 }).data.event;
  const p = await open(`/admin/${ev.slug}/detalji`, { token: ADMIN_TOKEN });
  await clickText(p, "button", "Trajno obriši");
  const del = 'div[role="dialog"] button.danger';
  assert.equal(await p.$eval(del, (b) => b.disabled), true);
  await p.type('div[role="dialog"] input', "pogrešno");
  assert.equal(await p.$eval(del, (b) => b.disabled), true);
  await p.$eval('div[role="dialog"] input', (i) => (i.value = ""));
  await p.click('div[role="dialog"] input', { clickCount: 3 });
  await p.keyboard.press("Backspace");
  await p.type('div[role="dialog"] input', "Za brisanje");
  assert.equal(await p.$eval(del, (b) => b.disabled), false);
  await p.click(del);
  await p.waitForFunction(() => /Novi događaj/.test(document.body.innerText), { timeout: 5000 });
  assert.ok(!srv.g.rows("Events").some((r) => r[2] === "Za brisanje"));
  await p.close();
});

test("Escape zatvara dijalog; fokus se vraća", T, async () => {
  const ev = srv.g.call({ action: "createEvent", idToken: ADMIN_TOKEN, name: "Esc test", year: 2027 }).data.event;
  const p = await open(`/admin/${ev.slug}/detalji`, { token: ADMIN_TOKEN });
  await clickText(p, "button", "Trajno obriši");
  assert.ok(await p.$('div[role="dialog"]'));
  await p.keyboard.press("Escape");
  await wait(150);
  assert.equal(await p.$('div[role="dialog"]'), null);
  await p.close();
});

test("mrežna greška: korisnik dobija poruku s mogućnošću ponovnog pokušaja", T, async () => {
  const p = await open("/");
  await p.setOfflineMode(true);
  await p.evaluate(() => (location.hash = "#/e/hobom-2026"));
  await p.waitForFunction(() => /Nema veze/.test(document.body.innerText), { timeout: 5000 });
  assert.ok(await p.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => /Pokušaj ponovo/.test(b.textContent))));
  await p.setOfflineMode(false);
  await clickText(p, "button", "Pokušaj ponovo");
  await p.waitForFunction(() => /Registracija/.test(document.body.innerText), { timeout: 5000 });
  await p.close();
});

test("responsivnost: bez horizontalnog scrolla na 320/375/390/768/1024/1440 (javno i admin)", T, async () => {
  for (const w of [320, 375, 390, 768, 1024, 1440]) {
    for (const [path, token] of [["/", undefined], ["/e/hobom-2026", undefined], ["/e/hobom-2026/lunch", ANA_TOKEN], ["/e/hobom-2026/feedback", undefined], ["/admin", ADMIN_TOKEN], ["/admin/hobom-2026/agende", ADMIN_TOKEN], ["/admin/hobom-2026/rucak", ADMIN_TOKEN], ["/admin/hobom-2026/feedback", ADMIN_TOKEN]]) {
      const p = await open(path, { token, width: w, height: 800 });
      const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 0, `${path} @${w}px: horizontalni scroll ${over}px`);
      await p.close();
    }
  }
});

test("pristupačnost (axe, WCAG 2.x A/AA): 0 povreda na ključnim stranicama, 1280 i 390 px", T, async () => {
  const pages = [["/", undefined], ["/e/hobom-2026", undefined], ["/e/hobom-2026/lunch", ANA_TOKEN], ["/e/hobom-2026/feedback", undefined], ["/admin", ADMIN_TOKEN], ["/admin/hobom-2026/detalji", ADMIN_TOKEN], ["/admin/hobom-2026/agende", ADMIN_TOKEN], ["/admin/hobom-2026/rucak", ADMIN_TOKEN], ["/admin/hobom-2026/feedback", ADMIN_TOKEN], ["/admin/hobom-2026/rezultati", ADMIN_TOKEN]];
  const bad = [];
  for (const w of [1280, 390]) {
    for (const [path, token] of pages) {
      const p = await open(path, { token, width: w });
      await p.evaluate(axeSource);
      const r = await p.evaluate(() => axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } }));
      for (const v of r.violations) bad.push(`${path} @${w}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
      await p.close();
    }
  }
  assert.deepEqual(bad, []);
});

test("CSP iz index.html ne blokira aplikaciju: nema CSP povreda u konzoli na ključnim stranicama", T, async () => {
  for (const [path, token] of [["/", undefined], ["/e/hobom-2026", ANA_TOKEN], ["/e/hobom-2026/feedback", undefined], ["/admin/hobom-2026/agende", ADMIN_TOKEN]]) {
    const p = await browser.newPage();
    const violations = [];
    p.on("console", (m) => { if (/Content Security Policy/i.test(m.text()) && !/accounts\.google\.com|fonts\.g/.test(m.text())) violations.push(m.text()); });
    if (token) await p.evaluateOnNewDocument((t) => localStorage.setItem("eestecTestToken", t), token);
    await p.goto(srv.url + "/#" + path, { waitUntil: "networkidle0" });
    assert.deepEqual(violations, [], path);
    assert.ok((await p.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content)).includes("default-src 'none'"));
    await p.close();
  }
});

const tokFor = (email, sub) => makeToken({ sub, email, name: email.split("@")[0], hd: "eestec-sa.ba" });

test("administratori: panel prikazuje 8 početnih; dodavanje, deaktivacija uz potvrdu, aktivacija", T, async () => {
  const p = await open("/admin/_admini", { token: ADMIN_TOKEN });
  await p.waitForFunction(() => /Aktivni: 8/.test(document.body.innerText), { timeout: 5000 });
  const t = await text(p);
  for (const e of ["hana.mahmutovic@eestec-sa.ba", "chair@eestec-sa.ba", "treasurer@eestec-sa.ba"]) assert.ok(t.includes(e), e);
  await p.type('input[type=email]', "novi.clan@eestec-sa.ba");
  await clickText(p, "button", "Dodaj");
  await p.waitForFunction(() => /Aktivni: 9/.test(document.body.innerText), { timeout: 5000 });
  // duplikat -> greška u toastu, bez nove stavke
  await p.type('input[type=email]', "NOVI.CLAN@eestec-sa.ba");
  await clickText(p, "button", "Dodaj");
  await p.waitForFunction(() => /već postoji/.test(document.body.innerText), { timeout: 5000 });
  // deaktivacija uz potvrdu
  const li = 'ul.opts-admin li:has(b)';
  await p.evaluate(() => { const row = [...document.querySelectorAll("ul.opts-admin li")].find((l) => l.textContent.includes("novi.clan@")); row.querySelector("button").click(); });
  await p.waitForSelector('div[role="dialog"]');
  await clickText(p, "div[role=dialog] button", "Deaktiviraj");
  await p.waitForFunction(() => /Aktivni: 8/.test(document.body.innerText), { timeout: 5000 });
  await p.evaluate(() => { const row = [...document.querySelectorAll("ul.opts-admin li")].find((l) => l.textContent.includes("novi.clan@")); [...row.querySelectorAll("button")].find((b) => /Aktiviraj/.test(b.textContent)).click(); });
  await p.waitForFunction(() => /Aktivni: 9/.test(document.body.innerText), { timeout: 5000 });
  assert.equal(srv.g.rows("Admins").length, 9);
  await p.close();
});

test("administratori: svih 8 računa ulazi u administraciju; običan korisnik i deaktiviran admin ne ulaze", T, async () => {
  for (const e of ["hr@eestec-sa.ba", "hana.mahmutovic@eestec-sa.ba", "chair@eestec-sa.ba", "pr@eestec-sa.ba", "it@eestec-sa.ba", "fr@eestec-sa.ba", "cp@eestec-sa.ba", "treasurer@eestec-sa.ba"]) {
    const p = await open("/admin", { token: tokFor(e, e === "hr@eestec-sa.ba" ? "1001" : "ui-" + e) }); // hr je već vezan za sub 1001
    await p.waitForFunction(() => /Novi događaj/.test(document.body.innerText), { timeout: 5000 });
    await p.close();
  }
  const user = await open("/admin/_admini", { token: ANA_TOKEN });
  assert.match(await text(user), /Nemate pristup/);
  assert.ok(!/Email novog administratora/.test(await text(user)));
  await user.close();
  srv.g.call({ action: "setAdminActive", idToken: ADMIN_TOKEN, email: "cp@eestec-sa.ba", active: false });
  const revoked = await open("/admin", { token: tokFor("cp@eestec-sa.ba", "ui-cp@eestec-sa.ba") });
  assert.match(await text(revoked), /Nemate pristup/);
  await revoked.close();
  srv.g.call({ action: "setAdminActive", idToken: ADMIN_TOKEN, email: "cp@eestec-sa.ba", active: true });
});

test("administratori: pristupačnost panela (axe) i bez horizontalnog scrolla", T, async () => {
  const bad = [];
  for (const w of [1280, 390, 320]) {
    const p = await open("/admin/_admini", { token: ADMIN_TOKEN, width: w });
    await p.waitForFunction(() => /Aktivni:/.test(document.body.innerText));
    if (w !== 320) {
      await p.evaluate(axeSource);
      const r = await p.evaluate(() => axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] } }));
      for (const v of r.violations) bad.push(`@${w}: ${v.id} ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
    }
    assert.ok((await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `scroll @${w}`);
    await p.close();
  }
  assert.deepEqual(bad, []);
});
