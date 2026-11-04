// Regresijski testovi autorizacije za model s više administratora (list Admins).
// Identitet je simuliran lažnim Googleom (vidi fake-gas.mjs): NE dokazuje da pravi Google token prolazi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGas, makeToken } from './fake-gas.mjs';

const ADMIN_EMAILS = ['hr@eestec-sa.ba', 'hana.mahmutovic@eestec-sa.ba', 'chair@eestec-sa.ba', 'pr@eestec-sa.ba', 'it@eestec-sa.ba', 'fr@eestec-sa.ba', 'cp@eestec-sa.ba', 'treasurer@eestec-sa.ba'];
const tokFor = (email, extra = {}) => makeToken({ sub: 'sub-' + email, email, name: email.split('@')[0], hd: 'eestec-sa.ba', ...extra });
const T = Object.fromEntries(ADMIN_EMAILS.map((e) => [e, tokFor(e)]));
const HR = T['hr@eestec-sa.ba'];
const ANA = makeToken({ sub: '2001', email: 'ana@gmail.com', name: 'Ana' });

const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
const err = (r, code) => { assert.equal(r.ok, false, 'očekivana greška ' + code + ', dobijeno ' + JSON.stringify(r)); assert.equal(r.error.code, code, JSON.stringify(r)); return r.error; };
const fresh = (opts) => { const g = createGas(opts); g.setup(); return g; };
const adminRows = (g) => g.rows('Admins').map((r) => ({ email: r[0], active: r[1], sub: r[4] }));
const ADMIN_ACTIONS = [
  { action: 'listAllEvents' }, { action: 'createEvent', name: 'X', year: 2026 }, { action: 'updateEvent', id: 'x'.repeat(10) }, { action: 'deleteOrArchiveEvent', id: 'x'.repeat(10) },
  { action: 'manageAgenda', op: 'create' }, { action: 'manageAgendaItems', op: 'create' }, { action: 'managePoll', op: 'create' }, { action: 'manageFeedbackForm', op: 'create' },
  { action: 'getAdminStatistics', eventId: 'x'.repeat(10) }, { action: 'exportResults', kind: 'poll', id: 'x'.repeat(10) }, { action: 'importSeed', data: {} },
  { action: 'listAdmins' }, { action: 'addAdmin', email: 'novi@eestec-sa.ba' }, { action: 'setAdminActive', email: 'hr@eestec-sa.ba', active: false },
];

test('setup upisuje tačno 8 početnih administratora, aktivnih, uključujući vlasnika tabele', () => {
  const g = fresh();
  const rows = adminRows(g);
  assert.deepEqual(rows.map((r) => r.email).sort(), [...ADMIN_EMAILS].sort());
  assert.ok(rows.every((r) => r.active === '1'));
  assert.ok(rows.some((r) => r.email === 'hana.mahmutovic@eestec-sa.ba'), 'vlasnik tabele mora biti administrator');
  assert.equal(g.rows('Admins')[0][3], 'setup');
});

test('račun pod kojim je skripta objavljena se uvijek dodaje u početnu listu', () => {
  const g = fresh({ owner: 'drugi.vlasnik@eestec-sa.ba' });
  assert.equal(adminRows(g).length, 9);
  assert.ok(adminRows(g).some((r) => r.email === 'drugi.vlasnik@eestec-sa.ba'));
});

test('setup je idempotentan i NE vraća ukinute administratore', () => {
  const g = fresh();
  ok(g.call({ action: 'setAdminActive', idToken: HR, email: 'treasurer@eestec-sa.ba', active: false }));
  const before = JSON.stringify(g.rows('Admins'));
  g.setup(); g.setup();
  assert.equal(JSON.stringify(g.rows('Admins')), before);
  assert.equal(adminRows(g).find((r) => r.email === 'treasurer@eestec-sa.ba').active, '0');
  assert.equal(adminRows(g).length, 8);
  // čak i ako se red potpuno ukloni iz tabele, setup ga ne vraća (inicijalizacija je već urađena)
  const sh = g.ss.getSheetByName('Admins');
  sh.data = sh.data.filter((r, i) => i === 0 || r[0] !== 'cp@eestec-sa.ba');
  g.setup();
  assert.ok(!adminRows(g).some((r) => r.email === 'cp@eestec-sa.ba'));
});

test('ako je list Admins već ručno popunjen prije prvog setup-a: postojeći redovi ostaju netaknuti, dodaju se samo oni koji fale', () => {
  const g = createGas();
  g.call({ action: 'whoami', idToken: ANA }); // pravi prazan list Admins prije setup-a
  const sh = g.ss.getSheetByName('Admins');
  sh.data.push(['hr@eestec-sa.ba', '0', '2020-01-01', 'rucno', 'stari-sub'], ['samo.jedan@eestec-sa.ba', '1', '2026-01-01', 'rucno', '']);
  g.setup();
  const rows = adminRows(g);
  assert.deepEqual(rows[0], { email: 'hr@eestec-sa.ba', active: '0', sub: 'stari-sub' });
  assert.equal(rows[1].email, 'samo.jedan@eestec-sa.ba');
  assert.equal(rows.length, 2 + 7);
  assert.equal(rows.filter((r) => r.email === 'hr@eestec-sa.ba').length, 1);
});

test('svih 8 administratora ima punu moć: sve admin akcije rade (sa i bez hd claima)', () => {
  for (const withHd of [true, false]) {
    for (const email of ADMIN_EMAILS) {
      const g = fresh();
      const tok = withHd ? tokFor(email) : makeToken({ sub: 'sub-' + email, email, name: 'X' });
      assert.equal(ok(g.call({ action: 'whoami', idToken: tok })).me.isAdmin, true, email);
      const ev = ok(g.call({ action: 'createEvent', idToken: tok, name: 'Test ' + email, year: 2026 })).event;
      ok(g.call({ action: 'updateEvent', idToken: tok, id: ev.id, status: 'PUBLISHED' }));
      ok(g.call({ action: 'manageAgenda', idToken: tok, op: 'create', eventId: ev.id, title: 'Dan' }));
      ok(g.call({ action: 'managePoll', idToken: tok, op: 'create', eventId: ev.id, title: 'Ručak' }));
      ok(g.call({ action: 'manageFeedbackForm', idToken: tok, op: 'create', eventId: ev.id, title: 'F' }));
      ok(g.call({ action: 'getAdminStatistics', idToken: tok, eventId: ev.id }));
      assert.equal(ok(g.call({ action: 'listAdmins', idToken: tok })).admins.length, 8);
      ok(g.call({ action: 'getEvent', idToken: tok, slug: ev.slug }));
    }
  }
});

test('nepovjerljivi računi ne mogu NIJEDNU admin akciju (uključujući upravljanje administratorima)', () => {
  const g = fresh();
  const impostors = {
    gost: undefined,
    obicanGmail: ANA,
    sličanDomen: tokFor('hr@eestec-sa.ba.evil.com'),
    prefiks: tokFor('xhr@eestec-sa.ba'),
    drugiDomen: tokFor('hr@eestec-sa.com'),
    neverifikovan: tokFor('hr@eestec-sa.ba', { email_verified: 'false' }),
    neverifikovanBool: tokFor('chair@eestec-sa.ba', { email_verified: false }),
    tudjiAud: tokFor('hr@eestec-sa.ba', { aud: 'neki-drugi-client' }),
    istekao: tokFor('hr@eestec-sa.ba', { exp: String(Math.floor(Date.now() / 1000) - 5) }),
    losIssuer: tokFor('hr@eestec-sa.ba', { iss: 'https://evil.example' }),
    bezEmaila: makeToken({ sub: '9', name: 'X' }),
    smece: 'abc',
    nijeToken: 'x'.repeat(300),
  };
  const before = JSON.stringify(g.rows('Admins'));
  for (const [name, tok] of Object.entries(impostors)) {
    for (const a of ADMIN_ACTIONS) {
      const r = g.call({ ...a, idToken: tok });
      assert.equal(r.ok, false, `${name}/${a.action}`);
      assert.ok(['UNAUTHENTICATED', 'FORBIDDEN'].includes(r.error.code), `${name}/${a.action}: ${r.error.code}`);
    }
  }
  assert.equal(JSON.stringify(g.rows('Admins')), before);
  assert.equal(g.rows('Events').length, 0);
});

test('klijent ne može nametnuti administratora: admin/role/email u tijelu se ignorišu', () => {
  const g = fresh();
  err(g.call({ action: 'addAdmin', email: 'napadac@gmail.com', admin: true, role: 'ADMIN', isAdmin: true, adminEmail: 'hr@eestec-sa.ba' }), 'UNAUTHENTICATED');
  err(g.call({ action: 'addAdmin', idToken: ANA, email: 'ana@gmail.com', role: 'ADMIN', isAdmin: true }), 'FORBIDDEN');
  err(g.call({ action: 'setAdminActive', idToken: ANA, email: 'hr@eestec-sa.ba', active: false, role: 'ADMIN' }), 'FORBIDDEN');
  err(g.call({ action: 'listAdmins', idToken: ANA, email: 'hr@eestec-sa.ba' }), 'FORBIDDEN');
  assert.equal(adminRows(g).length, 8);
  assert.ok(!adminRows(g).some((r) => r.email.includes('gmail')));
});

test('opozvani administrator gubi pristup ODMAH (i sa već keširanim tokenom); ponovna aktivacija vraća pristup', () => {
  const g = fresh();
  const chair = T['chair@eestec-sa.ba'];
  ok(g.call({ action: 'listAllEvents', idToken: chair })); // token je sada u kešu
  ok(g.call({ action: 'setAdminActive', idToken: HR, email: 'chair@eestec-sa.ba', active: false }));
  err(g.call({ action: 'listAllEvents', idToken: chair }), 'FORBIDDEN');
  err(g.call({ action: 'createEvent', idToken: chair, name: 'X', year: 2026 }), 'FORBIDDEN');
  err(g.call({ action: 'listAdmins', idToken: chair }), 'FORBIDDEN');
  assert.equal(ok(g.call({ action: 'whoami', idToken: chair })).me.isAdmin, false);
  assert.equal(g.rows('Events').length, 0);
  ok(g.call({ action: 'setAdminActive', idToken: HR, email: 'chair@eestec-sa.ba', active: true }));
  ok(g.call({ action: 'listAllEvents', idToken: chair }));
});

test('opozvani administrator ne vidi nacrte događaja', () => {
  const g = fresh();
  const ev = ok(g.call({ action: 'createEvent', idToken: HR, name: 'Nacrt', year: 2026 })).event;
  const pr = T['pr@eestec-sa.ba'];
  ok(g.call({ action: 'getEvent', idToken: pr, slug: ev.slug }));
  ok(g.call({ action: 'setAdminActive', idToken: HR, email: 'pr@eestec-sa.ba', active: false }));
  err(g.call({ action: 'getEvent', idToken: pr, slug: ev.slug }), 'NOT_FOUND');
});

test('dodavanje administratora: novi račun odmah dobija pristup; zapis ima addedBy i addedAt', () => {
  const g = fresh();
  const novi = tokFor('novi.clan@eestec-sa.ba');
  err(g.call({ action: 'listAllEvents', idToken: novi }), 'FORBIDDEN');
  ok(g.call({ action: 'addAdmin', idToken: T['it@eestec-sa.ba'], email: '  Novi.Clan@EESTEC-SA.ba ' }));
  ok(g.call({ action: 'listAllEvents', idToken: novi }));
  const row = g.rows('Admins').find((r) => r[0] === 'novi.clan@eestec-sa.ba');
  assert.equal(row[1], '1');
  assert.equal(row[3], 'it@eestec-sa.ba');
  assert.match(row[2], /^\d{4}-\d\d-\d\dT/);
});

test('validacija emaila i duplikati (bez obzira na velika/mala slova)', () => {
  const g = fresh();
  for (const bad of ['', 'nije-email', 'a@b', '@eestec-sa.ba', 'a b@eestec-sa.ba', 'a@@eestec-sa.ba', 'x'.repeat(250) + '@eestec-sa.ba', 'a@-eestec.ba', 'a@eestec_sa.ba', '<script>@x.ba']) {
    err(g.call({ action: 'addAdmin', idToken: HR, email: bad }), 'BAD_REQUEST');
  }
  for (const nonString of [null, 5, ['a@b.ba'], { e: 1 }, undefined]) err(g.call({ action: 'addAdmin', idToken: HR, email: nonString }), 'BAD_REQUEST');
  err(g.call({ action: 'addAdmin', idToken: HR, email: 'HR@eestec-sa.ba' }), 'CONFLICT');
  err(g.call({ action: 'addAdmin', idToken: HR, email: ' chair@EESTEC-sa.ba' }), 'CONFLICT');
  ok(g.call({ action: 'addAdmin', idToken: HR, email: 'ok@gmail.com' })); // bez ograničenja domena, dozvoljen je bilo koji valjan email
  err(g.call({ action: 'addAdmin', idToken: HR, email: 'OK@gmail.com' }), 'CONFLICT');
  err(g.call({ action: 'setAdminActive', idToken: HR, email: 'nepostojeci@eestec-sa.ba', active: false }), 'NOT_FOUND');
  err(g.call({ action: 'setAdminActive', idToken: HR, email: 'chair@eestec-sa.ba', active: 'false' }), 'BAD_REQUEST');
  err(g.call({ action: 'setAdminActive', idToken: HR, email: 'chair@eestec-sa.ba' }), 'BAD_REQUEST');
  assert.equal(adminRows(g).length, 9);
});

test('ADMIN_EMAIL_DOMAINS (opcionalno): ograničava ko se može dodati i ko ostaje administrator', () => {
  const g = fresh({ props: { ADMIN_EMAIL_DOMAINS: 'eestec-sa.ba' } });
  err(g.call({ action: 'addAdmin', idToken: HR, email: 'ana@gmail.com' }), 'BAD_REQUEST');
  ok(g.call({ action: 'addAdmin', idToken: HR, email: 'ok@eestec-sa.ba' }));
  // red s domenom van dozvoljenih (npr. ručno upisan) ne daje pristup
  g.ss.getSheetByName('Admins').data.push(['ana@gmail.com', '1', '2026-01-01', 'rucno', '']);
  err(g.call({ action: 'listAllEvents', idToken: ANA }), 'FORBIDDEN');
});

test('bez ADMIN_EMAIL_DOMAINS nijedan listani administrator nije blokiran domenom (npr. gmail administrator)', () => {
  const g = fresh();
  ok(g.call({ action: 'addAdmin', idToken: HR, email: 'ana@gmail.com' }));
  assert.equal(ok(g.call({ action: 'whoami', idToken: ANA })).me.isAdmin, true);
});

test('ADMIN_REQUIRE_HD: isključeno podrazumijevano; kad je "true" traži hd jednak domeni emaila', () => {
  const noHd = makeToken({ sub: 'sub-chair@eestec-sa.ba', email: 'chair@eestec-sa.ba', name: 'C' });
  const wrongHd = tokFor('chair@eestec-sa.ba', { hd: 'drugi.ba' });
  const rightHd = tokFor('chair@eestec-sa.ba');
  const off = fresh();
  for (const t of [noHd, wrongHd, rightHd]) assert.equal(ok(off.call({ action: 'whoami', idToken: t })).me.isAdmin, true);
  const on = fresh({ props: { ADMIN_REQUIRE_HD: 'true' } });
  assert.equal(ok(on.call({ action: 'whoami', idToken: noHd })).me.isAdmin, false);
  assert.equal(ok(on.call({ action: 'whoami', idToken: wrongHd })).me.isAdmin, false);
  assert.equal(ok(on.call({ action: 'whoami', idToken: rightHd })).me.isAdmin, true);
  const other = fresh({ props: { ADMIN_REQUIRE_HD: 'yes' } }); // samo tačno "true" uključuje
  assert.equal(ok(other.call({ action: 'whoami', idToken: noHd })).me.isAdmin, true);
});

test('posljednji aktivni administrator se ne može deaktivirati; samo-deaktivacija je dozvoljena dok ima drugih', () => {
  const g = fresh();
  for (const e of ADMIN_EMAILS.slice(1)) ok(g.call({ action: 'setAdminActive', idToken: HR, email: e, active: false }));
  assert.equal(adminRows(g).filter((r) => r.active === '1').length, 1);
  err(g.call({ action: 'setAdminActive', idToken: HR, email: 'hr@eestec-sa.ba', active: false }), 'CONFLICT');
  assert.equal(ok(g.call({ action: 'listAdmins', idToken: HR })).activeCount, 1);
  ok(g.call({ action: 'setAdminActive', idToken: HR, email: 'hr@eestec-sa.ba', active: true })); // već aktivan: bez promjene
  ok(g.call({ action: 'addAdmin', idToken: HR, email: 'drugi@eestec-sa.ba' }));
  ok(g.call({ action: 'setAdminActive', idToken: HR, email: 'hr@eestec-sa.ba', active: false })); // sada smije
  err(g.call({ action: 'listAllEvents', idToken: HR }), 'FORBIDDEN');
  err(g.call({ action: 'setAdminActive', idToken: tokFor('drugi@eestec-sa.ba'), email: 'drugi@eestec-sa.ba', active: false }), 'CONFLICT');
});

test('lista administratora nikad ne curi kroz javne odgovore', () => {
  const g = fresh();
  const ev = ok(g.call({ action: 'createEvent', idToken: HR, name: 'Javni', year: 2026 })).event;
  ok(g.call({ action: 'updateEvent', idToken: HR, id: ev.id, status: 'PUBLISHED' }));
  const poll = ok(g.call({ action: 'managePoll', idToken: HR, op: 'create', eventId: ev.id, title: 'Ručak' })).id;
  const opt = ok(g.call({ action: 'managePoll', idToken: HR, op: 'addOption', pollId: poll, name: 'A' })).id;
  ok(g.call({ action: 'submitVote', idToken: ANA, pollId: poll, optionId: opt }));
  const secret = ADMIN_EMAILS.filter((e) => e !== 'hr@eestec-sa.ba'); // hr@ je i javna kontakt adresa (Settings.contactEmail)
  const outputs = [];
  for (const tok of [undefined, ANA]) {
    outputs.push(JSON.stringify(ok(g.call({ action: 'listPublishedEvents', idToken: tok }))));
    outputs.push(JSON.stringify(ok(g.call({ action: 'getEvent', idToken: tok, slug: ev.slug }))));
    outputs.push(JSON.stringify(ok(g.call({ action: 'whoami', idToken: tok }))));
  }
  outputs.push(JSON.stringify(g.get({ action: 'listPublishedEvents' })));
  outputs.push(JSON.stringify(g.get({})));
  for (const o of outputs) for (const e of secret) assert.ok(!o.includes(e), `curi ${e}`);
  for (const o of outputs) assert.ok(!/Admins|addedBy|"sub"/.test(o));
  // obični korisnik ne dobija listu čak ni kad pita na više načina
  for (const a of ['listAdmins', 'getAdminStatistics', 'listAllEvents', 'exportResults']) err(g.call({ action: a, idToken: ANA, eventId: ev.id, kind: 'poll', id: poll }), 'FORBIDDEN');
  // GET ne podržava nijednu admin akciju
  assert.equal(g.get({ action: 'listAdmins' }).data.service, 'eestec-events');
});

test('importSeed ne može upisati administratore ni preko dozvoljenih listova', () => {
  const g = fresh();
  const before = JSON.stringify(adminRows(g).map((x) => x.email));
  const r = g.call({ action: 'importSeed', idToken: HR, data: { Admins: [{ email: 'napadac@gmail.com', active: true, id: 'abcdefgh1234' }], Events: [] } });
  assert.equal(r.ok, true);
  assert.equal(r.data.report.Admins, undefined);
  assert.equal(JSON.stringify(adminRows(g).map((x) => x.email)), before);
});

test('stabilni identitet: sub se veže pri prvoj prijavi; isti email s drugim sub-om se odbija', () => {
  const g = fresh();
  const first = tokFor('fr@eestec-sa.ba', { sub: '111' });
  assert.equal(adminRows(g).find((r) => r.email === 'fr@eestec-sa.ba').sub, '');
  assert.equal(ok(g.call({ action: 'whoami', idToken: first })).me.isAdmin, true);
  assert.equal(adminRows(g).find((r) => r.email === 'fr@eestec-sa.ba').sub, '111');
  const clone = tokFor('fr@eestec-sa.ba', { sub: '999' }); // npr. obrisan pa ponovo napravljen račun s istim emailom
  assert.equal(ok(g.call({ action: 'whoami', idToken: clone })).me.isAdmin, false);
  err(g.call({ action: 'createEvent', idToken: clone, name: 'X', year: 2026 }), 'FORBIDDEN');
  assert.equal(ok(g.call({ action: 'whoami', idToken: first })).me.isAdmin, true);
  assert.equal(ok(g.call({ action: 'listAdmins', idToken: HR })).admins.find((a) => a.email === 'fr@eestec-sa.ba').signedInBefore, true);
  assert.ok(!JSON.stringify(ok(g.call({ action: 'listAdmins', idToken: HR }))).includes('111'), 'sub se ne vraća klijentu');
});

test('vezanje sub-a se dešava i pri prvoj admin akciji, ne samo pri whoami', () => {
  const g = fresh();
  ok(g.call({ action: 'createEvent', idToken: tokFor('cp@eestec-sa.ba', { sub: '777' }), name: 'X', year: 2026 }));
  assert.equal(adminRows(g).find((r) => r.email === 'cp@eestec-sa.ba').sub, '777');
});

test('resetAdminBinding (samo iz editora): oslobađa zaključanog administratora, jednokratno', () => {
  const g = fresh();
  ok(g.call({ action: 'whoami', idToken: tokFor('fr@eestec-sa.ba', { sub: '111' }) }));
  const newAcc = tokFor('fr@eestec-sa.ba', { sub: '999' });
  assert.equal(ok(g.call({ action: 'whoami', idToken: newAcc })).me.isAdmin, false);
  assert.match(g.editorRun('resetAdminBinding'), /Postavite RESET_BINDING_EMAIL/);
  g.scriptProps.RESET_BINDING_EMAIL = 'FR@eestec-sa.ba';
  assert.match(g.editorRun('resetAdminBinding'), /Veza resetovana/);
  assert.equal(g.scriptProps.RESET_BINDING_EMAIL, undefined);
  assert.equal(ok(g.call({ action: 'whoami', idToken: newAcc })).me.isAdmin, true);
});

test('oporavak pristupa: nakon slučajnog gubitka svih administratora recoverAccess() vraća vlasnika, a web nema zaobilazni put', () => {
  const g = fresh();
  // simulacija nesreće: svi redovi neaktivni (ručna izmjena tabele)
  g.ss.getSheetByName('Admins').data.forEach((r, i) => { if (i > 0) r[1] = '0'; });
  for (const [e, t] of Object.entries(T)) err(g.call({ action: 'listAllEvents', idToken: t }), 'FORBIDDEN');
  // web aplikacija se ne može nagovoriti na oporavak
  for (const a of ['recoverAccess', 'resetAdminBinding', 'seedAdmins_', 'setup', 'ensureSheet_', 'addAdmin_']) err(g.call({ action: a, idToken: HR }), 'BAD_REQUEST');
  err(g.call({ action: 'addAdmin', idToken: ANA, email: 'ana@gmail.com' }), 'FORBIDDEN');
  assert.match(g.editorRun('recoverAccess'), /Pristup vraćen za hana\.mahmutovic@eestec-sa\.ba/);
  const active = adminRows(g).filter((r) => r.active === '1').map((r) => r.email);
  assert.deepEqual(active, ['hana.mahmutovic@eestec-sa.ba']); // samo vlasnik, ostali ostaju onakvi kakvi su bili
  ok(g.call({ action: 'listAllEvents', idToken: T['hana.mahmutovic@eestec-sa.ba'] }));
  err(g.call({ action: 'listAllEvents', idToken: HR }), 'FORBIDDEN');
});

test('oporavak dodaje vlasnika ako je red obrisan, bez dupliranja', () => {
  const g = fresh();
  const sh = g.ss.getSheetByName('Admins');
  sh.data = sh.data.filter((r, i) => i === 0 || r[0] !== 'hana.mahmutovic@eestec-sa.ba');
  g.editorRun('recoverAccess'); g.editorRun('recoverAccess');
  assert.equal(adminRows(g).filter((r) => r.email === 'hana.mahmutovic@eestec-sa.ba').length, 1);
});

test('ručno unesen red (velika slova, "TRUE") u listu Admins funkcioniše', () => {
  const g = fresh();
  g.ss.getSheetByName('Admins').data.push(['Rucni.Unos@EESTEC-SA.ba', 'TRUE', '2026-01-01', 'rucno', '']);
  assert.equal(ok(g.call({ action: 'whoami', idToken: tokFor('rucni.unos@eestec-sa.ba') })).me.isAdmin, true);
  err(g.call({ action: 'addAdmin', idToken: HR, email: 'rucni.unos@eestec-sa.ba' }), 'CONFLICT');
});

test('concurrency: zauzeta brava ne dozvoljava dodavanje administratora (BUSY, bez upisa)', () => {
  const g = fresh();
  g.holdLock();
  err(g.call({ action: 'addAdmin', idToken: HR, email: 'novi@eestec-sa.ba' }), 'BUSY');
  g.releaseLock();
  assert.equal(adminRows(g).length, 8);
});

test('izvorni kod nema fiksnu admin adresu u logici autorizacije (samo u početnoj listi)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  assert.ok(!/ADMIN_EMAIL\b(?!_DOMAINS)/.test(src.replace(/ADMIN_EMAIL_DOMAINS/g, '')), 'stari ADMIN_EMAIL model je uklonjen');
  assert.ok(!/ADMIN_HD/.test(src));
  const logic = src.slice(src.indexOf('function adminRow_'), src.indexOf('function requireUser_'));
  assert.ok(!/@eestec-sa\.ba/.test(logic));
});
