// Izvoz postojećih podataka iz STARE baze (samo čitanje!) u JSON spreman za uvoz u Google Sheets.
// Pokretanje (iz korijena repozitorija, sa uključenom starom bazom i DATABASE_URL u .env):
//   node sheets/scripts/export-from-postgres.mjs
// Rezultat: sheets/migration/out/import-payload.json (+ report.json). Folder je u .gitignore jer sadrži emailove.
// Skripta NIKAD ne piše u bazu i ne briše ništa.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mapLegacy } from "./legacy-map.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
if (!process.env.DATABASE_URL && fs.existsSync(path.join(root, ".env"))) {
  for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^DATABASE_URL\s*=\s*"?([^"]+)"?/.exec(line);
    if (m) process.env.DATABASE_URL = m[1];
  }
}
const { PrismaClient } = require(path.join(root, "src/generated/prisma/index.js"));
const db = new PrismaClient();

try {
  const [users, projects, agendas, agendaItems, polls, options, votes, forms, questions, responses, answers] = await Promise.all([
    db.user.findMany(), db.project.findMany(), db.agenda.findMany(), db.agendaItem.findMany(), db.lunchPoll.findMany(), db.lunchOption.findMany(),
    db.lunchVote.findMany(), db.feedbackForm.findMany(), db.feedbackQuestion.findMany(), db.feedbackResponse.findMany(), db.feedbackAnswer.findMany(),
  ]);
  const { data, report } = mapLegacy({ users, projects, agendas, agendaItems, polls, options, votes, forms, questions, responses, answers });
  const out = path.join(root, "sheets/migration/out");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "import-payload.json"), JSON.stringify(data, null, 1));
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 1));
  console.log("Izvezeno:", report.counts);
  if (report.warnings.length) console.log("Upozorenja:\n - " + report.warnings.join("\n - "));
  if (Object.keys(report.skipped).length) console.log("Preskočeno:", report.skipped);
  console.log("Datoteka:", path.join(out, "import-payload.json"));
} catch (e) {
  console.error("Izvoz nije uspio (da li je stara baza pokrenuta?):", e.message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
