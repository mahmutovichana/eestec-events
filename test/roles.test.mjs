import test from "node:test";
import assert from "node:assert/strict";
import { computeRole } from "../src/lib/roles.ts";

const ADMIN = "hr@eestec-sa.ba";
const g = (email, verified = true, sub = "google-oauth2|123") => ({ sub, email, email_verified: verified });

test("verifikovan Google račun s admin emailom je ADMIN", () => {
  assert.equal(computeRole(g(ADMIN), ADMIN), "ADMIN");
});
test("velika/mala slova i razmaci ne mijenjaju rezultat", () => {
  assert.equal(computeRole(g("  HR@EESTEC-SA.BA "), ADMIN), "ADMIN");
});
test("neverifikovan email nije ADMIN", () => {
  assert.equal(computeRole(g(ADMIN, false), ADMIN), "USER");
  assert.equal(computeRole({ sub: "google-oauth2|1", email: ADMIN }, ADMIN), "USER");
});
test("ne-Google identitet s istim emailom nije ADMIN", () => {
  assert.equal(computeRole(g(ADMIN, true, "auth0|abc"), ADMIN), "USER");
  assert.equal(computeRole(g(ADMIN, true, null), ADMIN), "USER");
});
test("drugi email je USER", () => {
  assert.equal(computeRole(g("someone@gmail.com"), ADMIN), "USER");
  assert.equal(computeRole(g("hr@eestec-sa.ba.evil.com"), ADMIN), "USER");
  assert.equal(computeRole(g("xhr@eestec-sa.ba"), ADMIN), "USER");
});
test("prazne tvrdnje su USER", () => {
  assert.equal(computeRole({}, ADMIN), "USER");
});
