import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Statička provjera: svaka eksportovana server akcija mora pozvati guard() prije prvog pristupa bazi.
test("svaka admin akcija poziva guard() prije db poziva", () => {
  const src = readFileSync("src/app/admin/actions.ts", "utf8");
  const parts = src.split(/^export async function /m).slice(1);
  assert.ok(parts.length >= 25, "očekivano je bar 25 akcija, nađeno " + parts.length);
  for (const p of parts) {
    const name = p.slice(0, p.indexOf("("));
    const body = p.slice(0, p.search(/^}/m));
    const g = body.indexOf("await guard()");
    assert.ok(g >= 0, `${name}: nema await guard()`);
    const d = body.search(/\bdb\./);
    assert.ok(d === -1 || g < d, `${name}: guard() mora doći prije db poziva`);
  }
});

test("jedini 'use server' fajl pod /admin je actions.ts i nijedna akcija nije izložena bez guard-a", () => {
  const files = [];
  (function walk(d) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/.(ts|tsx)$/.test(f)) files.push(p);
    }
  })("src");
  const withUseServer = files.filter((f) => /^\s*["']use server["']/m.test(readFileSync(f, "utf8")));
  assert.deepEqual(withUseServer.map((f) => f.replaceAll("\\", "/")), ["src/app/admin/actions.ts"]);
});

test("admin API rute provjeravaju ulogu ADMIN", () => {
  for (const f of ["src/app/api/admin/lunch/[pollId]/csv/route.ts", "src/app/api/admin/feedback/[formId]/csv/route.ts"]) {
    const s = readFileSync(f, "utf8");
    assert.match(s, /getCurrentUser\(\)/, f);
    assert.match(s, /role !== "ADMIN"/, f);
  }
});

test("klijent nikad ne šalje userId ni role", () => {
  for (const f of ["src/app/api/vote/route.ts", "src/app/api/feedback/route.ts"]) {
    const s = readFileSync(f, "utf8");
    const schema = s.slice(s.indexOf("const Body"), s.indexOf("});", s.indexOf("const Body")));
    assert.doesNotMatch(schema, /userId|role|email/i, f);
  }
});
