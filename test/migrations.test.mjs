// Provjera migracija na jednokratnim bazama: nova baza od nule, nadogradnja baze sa starim podacima, i migracija koja se
// zaustavlja (bez promjena) ako podaci krše nova pravila. Zahtijeva Docker kontejner s PostgreSQL-om.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";

const PG = process.env.PG_CONTAINER ?? "eestec-events-db-1";
const url = (n) => `postgresql://eestec:eestec@localhost:5433/${n}`;
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", shell: cmd === "npx" && process.platform === "win32", ...opts });
const psql = (db, sql, input) => run("docker", ["exec", "-i", PG, "psql", "-U", "eestec", "-d", db, "-v", "ON_ERROR_STOP=1", ...(input ? [] : ["-tA", "-c", sql])], input ? { input } : {});
const prisma = (dbName, args) => run("npx", ["prisma", ...args], { env: { ...process.env, DATABASE_URL: url(dbName) } });
const q = (db, sql) => psql(db, sql).stdout.trim();
const created = [];
const mk = (name) => { const n = `mig_${name}_${randomBytes(3).toString("hex")}`; created.push(n); const r = psql("postgres", `CREATE DATABASE ${n}`); assert.equal(r.status, 0, r.stderr); return n; };
const dockerOk = run("docker", ["exec", PG, "true"]).status === 0;
const migrations = readdirSync("prisma/migrations").filter((d) => /^\d/.test(d) || d === "0_init").sort();

after(() => { created.forEach((n) => psql("postgres", `DROP DATABASE IF EXISTS ${n} WITH (FORCE)`)); });

test("nova baza: svi migrations prolaze redom i šema odgovara Prisma modelu", { skip: !dockerOk }, () => {
  const n = mk("fresh");
  const r = prisma(n, ["migrate", "deploy"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const m of migrations) assert.match(r.stdout, new RegExp(m), "primijenjena " + m);
  const d = prisma(n, ["migrate", "diff", "--from-url", url(n), "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"]);
  assert.equal(d.status, 0, "šema baze == schema.prisma\n" + d.stdout);
  const st = prisma(n, ["migrate", "status"]);
  assert.match(st.stdout + st.stderr, /up to date/i);
});

function seedLegacy(n, { inconsistent = false } = {}) {
  // Stanje baze prije platform_v2: stara šema (0_init) s podacima koje je stvorila prva verzija aplikacije.
  const init = readFileSync("prisma/migrations/0_init/migration.sql", "utf8");
  let r = psql(n, "", init);
  assert.equal(r.status, 0, r.stderr);
  r = prisma(n, ["migrate", "resolve", "--applied", "0_init"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const sql = `
    INSERT INTO "Project"(id,slug,name,status) VALUES ('p1','hobom','HOBOM','PUBLISHED'),('p2','skriven','Skriven','HIDDEN'),('p3','arh','Arh','ARCHIVED');
    INSERT INTO "LunchPoll"(id,"projectId",title,"showResults") VALUES ('poll1','p1','Ručak',true),('poll2','p2','Drugi',false);
    INSERT INTO "LunchOption"(id,"pollId",name) VALUES ('o1','poll1','A'),('o2','poll1','B'),('o3','poll2','C');
    INSERT INTO "LunchVote"(id,"pollId","optionId","voterHash","netHash") VALUES ('v1','poll1','o1','h1','n1'),('v2','poll1','o2','h2','n1');
    ${inconsistent ? `INSERT INTO "LunchVote"(id,"pollId","optionId","voterHash","netHash") VALUES ('vbad','poll1','o3','h3','n1');` : ""}
    INSERT INTO "FeedbackForm"(id,"projectId",title) VALUES ('f1','p1','Eval');
    INSERT INTO "FeedbackQuestion"(id,"formId",position,type,label,required) VALUES ('q1','f1',0,'RATING','Ocjena',true),('q2','f1',1,'TEXT','Komentar',false);
    INSERT INTO "FeedbackResponse"(id,"formId","createdAt") VALUES ('r1','f1','2026-11-03 14:37:11.123');
    INSERT INTO "FeedbackAnswer"(id,"responseId","questionId",rating,text) VALUES ('a1','r1','q1',5,NULL),('a2','r1','q2',NULL,'Super');
  `;
  r = psql(n, "", sql);
  assert.equal(r.status, 0, r.stderr);
}

test("nadogradnja sa starim podacima: sve se čuva i ispravno pretvara", { skip: !dockerOk }, () => {
  const n = mk("upgrade");
  seedLegacy(n);
  const r = prisma(n, ["migrate", "deploy"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);

  assert.equal(q(n, `SELECT status FROM "Project" WHERE id='p2'`), "DRAFT", "HIDDEN -> DRAFT");
  assert.equal(q(n, `SELECT status FROM "Project" WHERE id='p3'`), "ARCHIVED");
  assert.equal(q(n, `SELECT type FROM "FeedbackQuestion" WHERE id='q2'`), "LONG_TEXT", "TEXT -> LONG_TEXT");
  assert.equal(q(n, `SELECT "showResultsWhileOpen" FROM "LunchPoll" WHERE id='poll1'`), "t", "showResults očuvan");
  assert.equal(q(n, `SELECT count(*) FROM "LunchVote" WHERE "userId" IS NULL AND "voterHash" IS NOT NULL`), "2", "stari anonimni glasovi ostaju");
  assert.equal(q(n, `SELECT "questionLabel" || '|' || "questionType" || '|' || "formId" FROM "FeedbackAnswer" WHERE id='a2'`), "Komentar|LONG_TEXT|f1", "snimak pitanja popunjen");
  assert.equal(q(n, `SELECT "questionType" FROM "FeedbackAnswer" WHERE id='a1'`), "RATING");
  assert.equal(q(n, `SELECT count(*) FROM "FeedbackAnswer"`), "2", "odgovori očuvani");
  assert.equal(q(n, `SELECT to_char("createdAt",'HH24:MI:SS') FROM "FeedbackResponse" WHERE id='r1'`), "00:00:00", "anonimno vrijeme zaokruženo na dan");
  assert.equal(q(n, `SELECT mode FROM "FeedbackForm" WHERE id='f1'`), "ANONYMOUS", "stari feedback ostaje anoniman");

  // Nova pravila su aktivna na migriranim podacima
  const bad = psql(n, `INSERT INTO "LunchVote"(id,"pollId","optionId","voterHash") VALUES ('x','poll1','o3','z')`);
  assert.notEqual(bad.status, 0, "složeni FK radi poslije migracije");
  const del = psql(n, `DELETE FROM "FeedbackQuestion" WHERE id='q1'`);
  assert.notEqual(del.status, 0, "brisanje pitanja s odgovorom je blokirano poslije migracije");

  const d = prisma(n, ["migrate", "diff", "--from-url", url(n), "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"]);
  assert.equal(d.status, 0, "šema nakon nadogradnje == schema.prisma\n" + d.stdout);
});

test("migracija se zaustavlja bez ikakve promjene ako podaci krše nova pravila (glas s opcijom iz druge ankete)", { skip: !dockerOk }, () => {
  const n = mk("bad");
  seedLegacy(n, { inconsistent: true });
  const r = prisma(n, ["migrate", "deploy"]);
  assert.notEqual(r.status, 0, "deploy mora pasti");
  assert.match(r.stdout + r.stderr, /Migracija prekinuta|opcijom iz druge ankete/);
  // Transakcija je poništena: nove kolone ne postoje, podaci su netaknuti
  assert.equal(q(n, `SELECT count(*) FROM information_schema.columns WHERE table_name='LunchOption' AND column_name='archivedAt'`), "0");
  assert.equal(q(n, `SELECT count(*) FROM "LunchVote"`), "3");
  assert.equal(q(n, `SELECT count(*) FROM "FeedbackAnswer"`), "2");
});

test("migracije su dodatne: nijedna ne sadrži DROP TABLE ni TRUNCATE ni DELETE FROM nad korisničkim podacima", () => {
  for (const m of migrations.filter((x) => x !== "0_init")) {
    const sql = readFileSync(`prisma/migrations/${m}/migration.sql`, "utf8").replace(/--.*$/gm, "");
    assert.doesNotMatch(sql, /DROP\s+TABLE|TRUNCATE|DELETE\s+FROM/i, m);
    assert.doesNotMatch(sql, /DROP\s+COLUMN/i, m + " ne smije brisati kolone");
  }
});
