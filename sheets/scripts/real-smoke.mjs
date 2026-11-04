// STVARNI smoke test: izgrađeni frontend (sa pravnim config.js) u pravom Chrome-u protiv STVARNOG Apps Script deploymenta.
// Samo čitanje: poziva javne akcije bez prijave, ništa ne upisuje u tabelu. Pokretanje: node sheets/scripts/real-smoke.mjs
// Ne može provjeriti Google prijavu (traži ručni klik pravog korisnika) niti admin akcije.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web/dist");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const cfg = fs.readFileSync(path.join(dist, "config.js"), "utf8");
const API = /apiUrl:\s*"([^"]+)"/.exec(cfg)?.[1];
if (!API) { console.error("config.js nema apiUrl"); process.exit(2); }

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let f = path.join(dist, u.pathname === "/" ? "index.html" : u.pathname);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(f);
  if (path.basename(f) === "index.html" && u.pathname === "/") body = Buffer.from(body.toString().replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:*")); // samo zbog lokalnog origina
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); };
try {
  const page = await browser.newPage();
  const log = { requests: [], responses: [], consoleErrors: [], failed: [] };
  page.on("request", (r) => { if (/script\.google(usercontent)?\.com/.test(r.url())) log.requests.push({ m: r.method(), url: r.url().slice(0, 80), ct: r.headers()["content-type"] }); });
  page.on("response", (r) => { if (/script\.google(usercontent)?\.com/.test(r.url())) log.responses.push({ status: r.status(), url: r.url().slice(0, 80), acao: r.headers()["access-control-allow-origin"] }); });
  page.on("requestfailed", (r) => log.failed.push(r.url().slice(0, 80) + " " + r.failure()?.errorText));
  page.on("console", (m) => { if (m.type() === "error") log.consoleErrors.push(m.text().slice(0, 200)); });
  await page.goto(origin + "/", { waitUntil: "networkidle0", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));
  const text = await page.evaluate(() => document.body.innerText);
  const posts = log.requests.filter((r) => r.m === "POST");
  check("frontend poziva stvarni Apps Script POST-om", posts.length >= 1, posts[0]?.url);
  check("zahtjev je 'simple request' (text/plain), bez preflighta", posts.every((p) => /text\/plain/.test(p.ct || "")) && !log.requests.some((r) => r.m === "OPTIONS"));
  check("redirect na script.googleusercontent.com je slijeđen", log.responses.some((r) => /googleusercontent/.test(r.url)));
  const final = log.responses.find((r) => /googleusercontent/.test(r.url) && r.status === 200);
  check("završni odgovor ima CORS zaglavlje i status 200", !!final && (final.acao === "*" || final.acao === origin), `ACAO=${final?.acao}`);
  check("nema CORS/mrežnih grešaka u konzoli", !log.consoleErrors.some((e) => /CORS|blocked|Failed to fetch|net::/i.test(e)) && log.failed.filter((f) => /script\.google/.test(f)).length === 0, [...log.consoleErrors, ...log.failed].join(" | ").slice(0, 200));
  check("stranica prikazuje odgovor servera (a ne grešku)", /Događaji/.test(text) && !/Nema veze|nije povezana|Greška/.test(text) && /(Trenutno nema objavljenih|Arhiva|Otvori)/.test(text), text.replace(/\s+/g, " ").slice(0, 160));
  const cfgInPage = await page.evaluate(() => window.EESTEC_CONFIG);
  check("config.js učitan s pravim clientId", /\.apps\.googleusercontent\.com$/.test(cfgInPage.clientId));
  // GIS skripta se učitava s pravog Googlea (ne puni dugme jer origin nije registrovan)
  const gis = await page.evaluate(() => !!window.google?.accounts?.id);
  check("Google Identity Services biblioteka se učitava", gis);
  await page.close();

  // Pravi API direktno iz stranice drugog origina: nevažeća akcija i lažni token ne smiju srušiti server
  const p2 = await browser.newPage();
  await p2.goto(origin + "/", { waitUntil: "domcontentloaded" });
  const out = await p2.evaluate(async (api) => {
    const post = async (body) => (await fetch(api, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) })).json();
    const fake = "a".repeat(48) + "." + "b".repeat(60) + "." + "c".repeat(28);
    return { admins: await post({ action: "listAdmins" }), junk: await post({ action: "nemaOvoga" }), tok: await post({ action: "listPublishedEvents", idToken: fake }), big: await post({ action: "x", pad: "y".repeat(210000) }) };
  }, API);
  check("admin akcija bez prijave je odbijena (UNAUTHENTICATED)", out.admins.error?.code === "UNAUTHENTICATED");
  check("nepoznata akcija je odbijena (BAD_REQUEST)", out.junk.error?.code === "BAD_REQUEST");
  check("lažni ID token: server kontaktira Google, odbija ga i tretira zahtjev kao gosta (nema INTERNAL greške)", out.tok.ok === true && out.tok.data.me.loggedIn === false);
  check("preveliko tijelo (>200 KB) odbijeno", out.big.error?.code === "BAD_REQUEST");
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} provjera prošlo`);
process.exit(failed ? 1 : 0);
