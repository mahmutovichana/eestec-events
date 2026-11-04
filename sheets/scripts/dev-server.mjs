// Lokalni razvojni/test server: statički frontend (web/dist) + lažni Apps Script (Code.gs nad tabelom u memoriji).
// Ponaša se kao Apps Script web app: samo POST text/plain, nema CORS preflighta (OPTIONS => 405), uvijek HTTP 200 s JSON-om.
// NIJE dokaz da stvarni Google radi: služi za razvoj UI-ja i testiranje logike.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGas, makeToken, CLIENT_ID } from "../test/fake-gas.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "../web/dist");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };

export const ADMIN_TOKEN = makeToken({ sub: "1001", email: "hr@eestec-sa.ba", name: "EESTEC HR", hd: "eestec-sa.ba" });
export const ANA_TOKEN = makeToken({ sub: "2001", email: "ana@gmail.com", name: "Ana Anić" });
export const BEN_TOKEN = makeToken({ sub: "2002", email: "ben@gmail.com", name: "Ben Benić" });

export function seed(g) {
  const A = ADMIN_TOKEN;
  const ok = (r) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r.data; };
  const ev = ok(g.call({ action: "createEvent", idToken: A, name: "HOBOM", year: 2026, startDate: "2026-11-07", endDate: "2026-11-08", location: "Sarajevo", description: "HandOver BOard Meeting EESTEC LC Sarajevo." })).event;
  ok(g.call({ action: "updateEvent", idToken: A, id: ev.id, status: "PUBLISHED" }));
  const sat = ok(g.call({ action: "manageAgenda", idToken: A, op: "create", eventId: ev.id, title: "Subota", date: "2026-11-07" })).id;
  const items = [["09:00", "09:30", "Registracija", "TALK"], ["09:30", "10:30", "Otvaranje i izvještaji", "SESSION"], ["10:30", "10:45", "Pauza", "BREAK"], ["10:45", "12:30", "Radionica", "SESSION"], ["12:30", "13:30", "Ručak", "MEAL"], ["13:30", "13:30", "Kraj prvog dana", "END"]];
  for (const [s, e, t, kind] of items) ok(g.call({ action: "manageAgendaItems", idToken: A, op: "create", agendaId: sat, startTime: s, endTime: e, title: t, kind }));
  const poll = ok(g.call({ action: "managePoll", idToken: A, op: "create", eventId: ev.id, title: "Ručak — subota", resultsVisibility: "ALWAYS" })).id;
  ok(g.call({ action: "managePoll", idToken: A, op: "addOption", pollId: poll, name: "Piletina s povrćem", allergens: "gluten" }));
  ok(g.call({ action: "managePoll", idToken: A, op: "addOption", pollId: poll, name: "Vege burger" }));
  const form = ok(g.call({ action: "manageFeedbackForm", idToken: A, op: "create", eventId: ev.id, title: "Utisci o HOBOM-u", mode: "ANONYMOUS" })).id;
  ok(g.call({ action: "manageFeedbackForm", idToken: A, op: "addQuestion", formId: form, label: "Ukupna ocjena", type: "RATING", required: true }));
  ok(g.call({ action: "manageFeedbackForm", idToken: A, op: "addQuestion", formId: form, label: "Šta vam se najviše svidjelo?", type: "SINGLE", options: ["Radionice", "Druženje", "Hrana"] }));
  ok(g.call({ action: "manageFeedbackForm", idToken: A, op: "addQuestion", formId: form, label: "Komentar", type: "LONG" }));
  return { ev, poll, form };
}

export async function startDevServer({ port = 0, withSeed = true } = {}) {
  const g = createGas();
  g.setup();
  const seeded = withSeed ? seed(g) : null;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (req.method !== "POST") { res.writeHead(405); return res.end(); } // kao Apps Script: nema preflighta
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const ct = (req.headers["content-type"] || "").split(";")[0];
        if (!["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"].includes(ct)) { res.writeHead(415); return res.end(); }
        const out = g.call(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out));
      });
      return;
    }
    if (url.pathname === "/config.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      return res.end(`window.EESTEC_CONFIG = { apiUrl: "http://${req.headers.host}/api", clientId: "${CLIENT_ID}" };`);
    }
    if (url.pathname === "/" || url.pathname === "/index.html") { // isti CSP kao u produkciji, samo uz dozvolu za lokalni lažni API
      const html = fs.readFileSync(path.join(dist, "index.html"), "utf8").replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:*");
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      return res.end(html);
    }
    let file = path.join(dist, url.pathname);
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { g, seeded, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await startDevServer({ port: Number(process.env.PORT || 8787) });
  console.log(`Dev server: ${s.url}  (podaci u memoriji, lažni Google token)`);
  console.log(`Za prijavu u pregledniku u konzoli: localStorage.eestecTestToken = "${ADMIN_TOKEN}"`);
}
