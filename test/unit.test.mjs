import test from "node:test";
import assert from "node:assert/strict";
import { canTransition, TRANSITIONS, isPublic, votingAllowed, feedbackAllowed } from "../src/lib/status.ts";
import { findOverlaps } from "../src/lib/overlaps.ts";
import { csvCell, csvRow, slugify, fmtDuration } from "../src/lib/util.ts";

test("prelazi statusa: dozvoljeni i zabranjeni", () => {
  assert.ok(canTransition("DRAFT", "PUBLISHED"));
  assert.ok(canTransition("PUBLISHED", "COMPLETED"));
  assert.ok(canTransition("COMPLETED", "ARCHIVED"));
  assert.ok(canTransition("ARCHIVED", "COMPLETED"), "restore iz arhive");
  assert.ok(canTransition("ARCHIVED", "DRAFT"), "restore u nacrt");
  assert.ok(!canTransition("DRAFT", "COMPLETED"), "nacrt ne može direktno u završen");
  assert.ok(!canTransition("ARCHIVED", "PUBLISHED"), "arhiva se ne objavljuje direktno");
  assert.ok(canTransition("DRAFT", "DRAFT"), "isti status je no-op");
  for (const s of Object.keys(TRANSITIONS)) assert.ok(!TRANSITIONS[s].includes(s), "nema prelaza u sebe");
});

test("pravila vidljivosti po statusu", () => {
  assert.equal(isPublic("DRAFT"), false);
  for (const s of ["PUBLISHED", "COMPLETED", "ARCHIVED"]) assert.equal(isPublic(s), true);
  assert.deepEqual(["DRAFT", "PUBLISHED", "COMPLETED", "ARCHIVED"].map(votingAllowed), [false, true, false, false]);
  assert.deepEqual(["DRAFT", "PUBLISHED", "COMPLETED", "ARCHIVED"].map(feedbackAllowed), [false, true, true, false]);
});

test("preklapanje termina", () => {
  const it = (id, s, e) => ({ id, title: id, startTime: s, endTime: e });
  assert.equal(findOverlaps([it("a", "09:00", "10:00"), it("b", "10:00", "11:00")]).length, 0, "dodir nije preklapanje");
  assert.equal(findOverlaps([it("a", "09:00", "10:30"), it("b", "10:00", "11:00")]).length, 1);
  assert.equal(findOverlaps([it("a", "09:00", "12:00"), it("b", "10:00", "11:00"), it("c", "10:30", "11:30")]).length, 3);
  assert.equal(findOverlaps([it("a", "18:25", "18:25"), it("b", "18:00", "19:00")]).length, 0, "nulta dužina se ignoriše");
  assert.equal(findOverlaps([it("a", "", "10:00"), it("b", "09:00", "11:00")]).length, 0, "nevažeće vrijeme se ignoriše");
});

test("CSV: navodnici, zarezi, nove linije i formule", () => {
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell("x\ny"), '"x\ny"');
  for (const bad of ["=1+1", "+cmd", "-2", "@SUM(A1)", "\tx", "\rx"]) assert.match(csvCell(bad), /^"?'/, bad);
  assert.equal(csvRow([1, null, "a"]), "1,,a");
});

test("slugify: dijakritici, razmaci, prazan ulaz", () => {
  assert.equal(slugify("Đurđevdan Šampion 2027!"), "durdevdan-sampion-2027");
  assert.equal(slugify("  --HOBOM__ 2027 "), "hobom-2027");
  assert.ok(slugify("!!!").length > 0, "prazan slug dobija nasumičan");
});

test("trajanje", () => {
  assert.equal(fmtDuration(5), "5 min");
  assert.equal(fmtDuration(60), "1h");
  assert.equal(fmtDuration(75), "1h 15min");
});
