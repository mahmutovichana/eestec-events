// Automatska provjera pristupačnosti (axe-core, WCAG 2.x A/AA) u pravom Chrome-u, na ključnim stranicama i širinama.
// Automatski alat pokriva samo dio WCAG kriterija: ovo NIJE potpuna certifikacija (vidi docs/TEST-RESULTS.md).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("../src/generated/prisma/index.js");
const axeSource = require("fs").readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const db = new PrismaClient();
const BASE = process.env.BASE_URL;
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const skip = !existsSync(CHROME) || !BASE;
const tag = "ax" + Math.random().toString(36).slice(2, 6);
let browser, proj, agenda, form;

before(async () => {
  if (skip) return;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  proj = await db.project.create({
    data: {
      slug: `${tag}`, name: `A11y ${tag}`, description: "Opis događaja", location: "Sarajevo", status: "PUBLISHED", startsAt: new Date("2027-03-10T12:00:00Z"),
      agendas: { create: [{ slug: "dan", title: "Dan 1", dateLabel: "10. 3. 2027.", items: { create: [
        { startTime: "09:00", endTime: "10:00", title: "Uvod", kind: "SESSION", position: 0, speaker: "Ime Prezime", location: "A1", description: "Opis sesije", notes: "Napomena" },
        { startTime: "10:00", endTime: "10:15", title: "Pauza", kind: "BREAK", position: 1 },
        { startTime: "10:15", endTime: "11:15", title: "Ručak", kind: "MEAL", position: 2 },
        { startTime: "11:15", endTime: "11:15", title: "Kraj", kind: "END", position: 3 },
      ] } }] },
      polls: { create: [{ title: "Ručak", description: "Odaberi", showResultsWhileOpen: true, options: { create: [{ name: "Piletina", allergens: "gluten" }, { name: "Pasta", description: "Sa sirom" }] } }] },
      forms: { create: [
        { title: "Anonimna", mode: "ANONYMOUS", questions: { create: [
          { type: "RATING", label: "Ocjena", required: true, position: 0 }, { type: "SINGLE_CHOICE", label: "Jedan", options: ["Da", "Ne"], position: 1 },
          { type: "MULTIPLE_CHOICE", label: "Više", options: ["a", "b", "c"], position: 2 }, { type: "SHORT_TEXT", label: "Kratko", position: 3 }, { type: "LONG_TEXT", label: "Dugo", position: 4 },
        ] } },
        { title: "Identificirana", mode: "IDENTIFIED", questions: { create: [{ type: "RATING", label: "Ocjena", position: 0 }] } },
      ] },
    },
    include: { agendas: true, polls: true, forms: true },
  });
  agenda = proj.agendas[0]; form = proj.forms[0];
  // Jedan odgovor da grafikoni i lista odgovora imaju sadržaj
  const qs = await db.feedbackQuestion.findMany({ where: { formId: form.id } });
  const r = await db.feedbackResponse.create({ data: { formId: form.id } });
  await db.feedbackAnswer.createMany({ data: qs.filter((q) => q.type === "RATING" || q.type === "LONG_TEXT").map((q) => ({ formId: form.id, responseId: r.id, questionId: q.id, questionLabel: q.label, questionType: q.type, rating: q.type === "RATING" ? 4 : null, text: q.type === "LONG_TEXT" ? "Komentar" : null })) });
});
after(async () => {
  await db.project.deleteMany({ where: { slug: { startsWith: tag } } });
  await db.$disconnect();
  await browser?.close();
});

async function audit(as, path, width) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height: 900 });
  if (as) await page.goto(`${BASE}/dev-login?as=${as}&to=/`, { waitUntil: "networkidle0" });
  await page.goto(BASE + path, { waitUntil: "networkidle0" });
  await page.evaluate(axeSource);
  const res = await page.evaluate(async () => {
    // Otvori sve <details> i dijaloge nisu potrebni: dijalozi su zatvoreni i nisu u pristupačnom stablu.
    document.querySelectorAll("details").forEach((d) => (d.open = true));
    return await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } });
  });
  await ctx.close();
  return res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, sample: v.nodes.slice(0, 2).map((n) => n.target.join(" ") + " :: " + (n.failureSummary ?? "").split("\n")[1]) }));
}

const PAGES = () => [
  [null, "/", "početna"],
  [null, `/e/${proj.slug}`, "javna agenda"],
  [null, `/e/${proj.slug}/agenda/dan`, "javna agenda (jedan dan)"],
  [null, `/e/${proj.slug}/lunch`, "ručak (guest)"],
  ["user", `/e/${proj.slug}/lunch`, "ručak (user)"],
  [null, `/e/${proj.slug}/feedback`, "feedback (guest)"],
  ["user", `/e/${proj.slug}/feedback`, "feedback (user)"],
  ["user", "/profile", "profil"],
  ["admin", "/admin", "admin pregled"],
  ["admin", "/admin/events", "admin događaji"],
  ["admin", "/admin/events/new", "admin novi događaj"],
  ["admin", `/admin/events/${proj.id}`, "admin postavke događaja"],
  ["admin", `/admin/events/${proj.id}/agendas`, "admin agende"],
  ["admin", `/admin/events/${proj.id}/agendas/${agenda.id}`, "admin urednik agende"],
  ["admin", `/admin/events/${proj.id}/lunch`, "admin ručak"],
  ["admin", `/admin/events/${proj.id}/feedback`, "admin feedback"],
  ["admin", "/admin/participants", "admin učesnici"],
  ["admin", "/admin/settings", "admin postavke"],
];

for (const width of [1280, 390]) {
  test(`axe: nema ozbiljnih/kritičnih povreda na ${width}px`, { skip, timeout: 600000 }, async () => {
    const report = [];
    for (const [as, path, name] of PAGES()) {
      const v = await audit(as, path, width);
      for (const x of v) report.push({ page: name, ...x });
    }
    const blocking = report.filter((v) => v.impact === "serious" || v.impact === "critical");
    const minor = report.filter((v) => !(v.impact === "serious" || v.impact === "critical"));
    console.log(`# axe ${width}px: ${blocking.length} ozbiljnih/kritičnih, ${minor.length} manjih`);
    for (const v of [...blocking, ...minor]) console.log(`#  [${v.impact}] ${v.page}: ${v.id} (${v.nodes}) ${v.help} :: ${v.sample.join(" | ")}`);
    assert.equal(blocking.length, 0, JSON.stringify(blocking, null, 1));
  });
}
