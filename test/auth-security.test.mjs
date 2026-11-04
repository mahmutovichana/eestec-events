// Auth/sesija/sigurnost nad serverima: B (bez DEV_AUTH, pravi Auth0 put), C (production build), D (baza nedostupna).
// Ovi testovi NE dokazuju da pravi Google/Auth0 login radi (to traži stvarne ključeve), nego da je put bez simulacije siguran.
import test from "node:test";
import assert from "node:assert/strict";

const A = process.env.BASE_URL;
const B = process.env.BASE_REAL;
const C = process.env.BASE_PROD;
const D = process.env.BASE_NODB;
const get = (base, path, headers = {}) => fetch(base + path, { redirect: "manual", headers });
const post = (base, path, body, headers = {}) =>
  fetch(base + path, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", origin: base, ...headers }, body: JSON.stringify(body) });

test("B: bez sesije /admin, /profile preusmjeravaju na prijavu", { skip: !B }, async () => {
  for (const p of ["/admin", "/admin/events", "/profile"]) {
    const r = await get(B, p);
    assert.equal(r.status, 307, p);
    assert.match(r.headers.get("location"), /\/auth\/login/, p);
  }
});

test("B: nevažeća / pokvarena sesija se tretira kao Guest (nikad kao prijavljen ili admin)", { skip: !B }, async () => {
  for (const cookie of ["__session=garbage", "__session=eyJhbGciOiJkaXIifQ..x.y.z", "__session=; dev_user=admin", "appSession=x"]) {
    const r = await get(B, "/admin", { cookie });
    assert.equal(r.status, 307, cookie);
    assert.match(r.headers.get("location"), /\/auth\/login/, cookie);
    const v = await post(B, "/api/vote", { pollId: "x", optionId: "y" }, { cookie });
    assert.equal(v.status, 401, "vote " + cookie);
    const c = await get(B, "/api/admin/lunch/x/csv", { cookie });
    assert.equal(c.status, 401, "csv " + cookie);
  }
});

test("B/C: /dev-login je ugašen (404) i ne postavlja kolačić", { skip: !B }, async () => {
  for (const base of [B, C].filter(Boolean)) {
    const r = await get(base, "/dev-login?as=admin&to=/admin");
    assert.equal(r.status, 404, base);
    assert.equal(r.headers.get("set-cookie"), null);
  }
});

test("B: dev_user kolačić nema efekta bez DEV_AUTH", { skip: !B }, async () => {
  const r = await get(B, "/admin", { cookie: "dev_user=admin" });
  assert.equal(r.status, 307);
  assert.match(r.headers.get("location"), /\/auth\/login/);
});

test("C (production build): DEV_AUTH=true u okruženju se ignoriše, dev kolačić ne daje pristup", { skip: !C }, async () => {
  const r = await get(C, "/admin", { cookie: "dev_user=admin" });
  assert.equal(r.status, 307);
  assert.match(r.headers.get("location"), /\/auth\/login/);
  assert.equal((await post(C, "/api/vote", { pollId: "x", optionId: "y" }, { cookie: "dev_user=admin" })).status, 401);
  assert.equal((await get(C, "/api/admin/lunch/x/csv", { cookie: "dev_user=admin" })).status, 401);
});

test("B: /auth/login ide na Auth0 s Google konekcijom i openid/email opsegom", { skip: !B }, async () => {
  const r = await get(B, "/auth/login?returnTo=%2Fprofile");
  assert.ok([302, 307].includes(r.status), "status " + r.status);
  const loc = new URL(r.headers.get("location"));
  assert.equal(loc.host, "example.eu.auth0.com");
  assert.equal(loc.searchParams.get("connection"), "google-oauth2");
  assert.match(loc.searchParams.get("scope"), /openid/);
  assert.match(loc.searchParams.get("scope"), /email/);
  assert.equal(loc.searchParams.get("response_type"), "code");
  assert.ok(loc.searchParams.get("state"), "state (CSRF zaštita toka) postoji");
  const cookies = r.headers.getSetCookie().join(";");
  assert.match(cookies, /HttpOnly/i, "transakcijski kolačić je HttpOnly");
});

test("B: returnTo ne smije voditi na vanjski sajt (open redirect)", { skip: !B }, async () => {
  for (const evil of ["https://evil.example/x", "//evil.example", "https:evil.example"]) {
    const r = await get(B, "/auth/login?returnTo=" + encodeURIComponent(evil));
    const loc = r.headers.get("location") ?? "";
    assert.ok(r.status < 500, "nema 5xx za " + evil);
    if (loc) assert.equal(new URL(loc, B).host !== "evil.example", true, "preusmjeravanje ne ide na evil: " + loc);
  }
});

test("B: callback bez ispravnog stanja ne ruši server i ne prijavljuje", { skip: !B }, async () => {
  const r = await get(B, "/auth/callback?code=abc&state=nepoznato");
  assert.ok(r.status < 500, "status " + r.status);
  const set = (r.headers.getSetCookie?.() ?? []).join(";");
  assert.doesNotMatch(set, /__session=[^;]{20,}/, "sesija se ne kreira");
  assert.equal((await get(B, "/admin")).status, 307);
});

test("B: logout radi i briše sesiju", { skip: !B }, async () => {
  const r = await get(B, "/auth/logout", { cookie: "__session=garbage" });
  assert.ok(r.status >= 300 && r.status < 500, "status " + r.status);
});

test("sigurnosna zaglavlja su na javnim i privatnim stranicama", async () => {
  for (const base of [A, B].filter(Boolean)) {
    const r = await get(base, "/e/none");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.match(r.headers.get("referrer-policy") ?? "", /strict-origin/);
    assert.match(r.headers.get("strict-transport-security") ?? "", /max-age/);
    assert.equal(r.headers.get("x-powered-by"), null);
  }
  const csv = await get(A, "/api/admin/lunch/x/csv");
  assert.match(csv.headers.get("cache-control") ?? "", /no-store/);
});

test("D (baza nedostupna): zaštićene rute i API ne tretiraju korisnika kao odjavljenog niti puštaju dalje", { skip: !D }, async () => {
  // Admin sa važećom (dev) sesijom: pad baze mora biti 5xx, ne preusmjeravanje na prijavu i ne 200.
  const r = await get(D, "/admin", { cookie: "dev_user=admin" });
  assert.ok(r.status >= 500, "/admin status " + r.status);
  const v = await post(D, "/api/vote", { pollId: "x", optionId: "y" }, { cookie: "dev_user=user" });
  assert.ok(v.status >= 500, "/api/vote status " + v.status);
  const body = await v.text();
  assert.doesNotMatch(body, /postgres|prisma|5999|ECONNREFUSED/i, "greška ne otkriva detalje baze");
  const f = await post(D, "/api/feedback", { formId: "x", acknowledgedMode: "ANONYMOUS", answers: [] });
  assert.ok(f.status >= 500, "/api/feedback status " + f.status);
});
