// Pokreće cijeli skup testova nad JEDNOKRATNOM bazom (kreira se i briše), s više servera:
//   A: dev server s DEV_AUTH=true (simulirana sesija)        -> BASE_URL
//   B: dev server BEZ DEV_AUTH (pravi Auth0 put, lažni ključevi) -> BASE_REAL
//   C: production build (next start) s DEV_AUTH=true u okruženju -> BASE_PROD (dev-login mora biti ugašen)
//   D: dev server s nedostupnom bazom                         -> BASE_NODB
//   E, E2: dvije instance s pravim limitima i zajedničkom bazom -> BASE_RL1, BASE_RL2
// Zahtjevi: Docker s kontejnerom eestec-events-db-1 (ili PG_CONTAINER), Chrome za UI testove (CHROME_PATH).
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const PG = process.env.PG_CONTAINER ?? "eestec-events-db-1";
const PORT_BASE = Number(process.env.TEST_PORT_BASE ?? 3120);
const dbName = "events_test_" + randomBytes(3).toString("hex");
const DB_URL = `postgresql://eestec:eestec@localhost:5433/${dbName}`;
const only = process.argv.slice(2); // npr. "test/api.test.mjs"

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8", shell: process.platform === "win32", ...opts });
// docker se poziva bez shella (argumenti s razmacima), npx kroz shell na Windowsu
const psql = (db, sql) => spawnSync("docker", ["exec", PG, "psql", "-U", "eestec", "-d", db, "-c", sql], { encoding: "utf8" });

// Next.js pri buildu s drugim distDir-om dopisuje putanju u tsconfig.json i next-env.d.ts: vrati ih nakon testova.
const keep = Object.fromEntries(["tsconfig.json", "next-env.d.ts"].map((f) => [f, readFileSync(f)]));
const restore = () => { for (const [f, c] of Object.entries(keep)) writeFileSync(f, c); };

const children = [];
const kill = (c) => {
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    else c.kill("SIGKILL");
  } catch {}
};
async function cleanup() {
  children.forEach(kill);
  restore();
  await new Promise((r) => setTimeout(r, 1500));
  restore();
  psql("postgres", `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
}
process.on("SIGINT", async () => { await cleanup(); process.exit(130); });

async function waitFor(url, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url, { redirect: "manual" }); if (r.status < 600) return; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Server se nije podigao: " + url);
}

function server(name, port, env, cmd = ["next", "dev", "-p", String(port)]) {
  const baseEnv = {
    ...process.env, DATABASE_URL: DB_URL, AUTH0_DOMAIN: "example.eu.auth0.com", AUTH0_CLIENT_ID: "test", AUTH0_CLIENT_SECRET: "test",
    AUTH0_SECRET: "a".repeat(64), APP_BASE_URL: `http://localhost:${port}`, ADMIN_EMAIL: "hr@eestec-sa.ba", ...env,
  };
  const c = spawn("npx", cmd, { env: baseEnv, stdio: "ignore", shell: process.platform === "win32" });
  children.push(c);
  return { name, port, url: `http://localhost:${port}` };
}

let code = 1;
try {
  console.log(`[harness] baza ${dbName}`);
  let r = psql("postgres", `CREATE DATABASE ${dbName}`);
  if (r.status !== 0) throw new Error("Ne mogu kreirati bazu: " + r.stderr);
  r = sh("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: DB_URL } });
  console.log("[harness] migrate deploy od nule:", r.status === 0 ? "OK" : "FAIL\n" + r.stdout + r.stderr);
  if (r.status !== 0) throw new Error("migracije");

  const A = server("A", PORT_BASE, { DEV_AUTH: "true", RATE_LIMIT_SCALE: "1000", NEXT_DIST_DIR: ".next-test-a" });
  // E i E2: dvije nezavisne instance s pravim limitima i istom bazom (dokaz da je ograničenje brzine distribuirano)
  const E = server("E", PORT_BASE + 4, { DEV_AUTH: "true", NEXT_DIST_DIR: ".next-test-e" });
  const E2 = server("E2", PORT_BASE + 5, { DEV_AUTH: "true", NEXT_DIST_DIR: ".next-test-e2" });
  const B = server("B", PORT_BASE + 1, { DEV_AUTH: "false", NEXT_DIST_DIR: ".next-test-b" });
  const D = server("D", PORT_BASE + 3, { DEV_AUTH: "true", NEXT_DIST_DIR: ".next-test-d", DATABASE_URL: "postgresql://eestec:eestec@localhost:5999/none" });
  let C = null;
  if (!process.env.SKIP_PROD) {
    const b = sh("npx", ["next", "build"], { env: { ...process.env, DATABASE_URL: DB_URL, NEXT_DIST_DIR: ".next-test-c", AUTH0_DOMAIN: "example.eu.auth0.com", AUTH0_CLIENT_ID: "t", AUTH0_CLIENT_SECRET: "t", AUTH0_SECRET: "a".repeat(64), APP_BASE_URL: `http://localhost:${PORT_BASE + 2}` } });
    console.log("[harness] production build:", b.status === 0 ? "OK" : "FAIL\n" + b.stdout.slice(-2000));
    if (b.status === 0) C = server("C", PORT_BASE + 2, { DEV_AUTH: "true", NODE_ENV: "production", NEXT_DIST_DIR: ".next-test-c" }, ["next", "start", "-p", String(PORT_BASE + 2)]);
  }
  await Promise.all([waitFor(E.url + "/e/none"), waitFor(E2.url + "/e/none"), waitFor(A.url + "/e/none"), waitFor(B.url + "/e/none"), waitFor(D.url + "/e/none").catch(() => {}), C ? waitFor(C.url + "/e/none") : null]);
  console.log("[harness] serveri spremni");

  const env = { ...process.env, DATABASE_URL: DB_URL, BASE_URL: A.url, BASE_REAL: B.url, BASE_NODB: D.url, BASE_RL1: E.url, BASE_RL2: E2.url, ...(C ? { BASE_PROD: C.url } : {}) };
  const files = only.length ? only : ["test/*.test.mjs"];
  const t = spawn("node", ["--test", "--test-concurrency=1", "--test-timeout=180000", ...files.map((f) => (process.platform === "win32" ? `"${f}"` : f))], { env, stdio: "inherit", shell: process.platform === "win32" });
  code = await new Promise((res) => t.on("exit", (c) => res(c ?? 1)));
} catch (e) {
  console.error("[harness] greška:", e.message);
} finally {
  await cleanup();
}
process.exit(code);
