// Rok čuvanja (24 mjeseca), anonimizacija, zahtjevi za brisanje i dnevnik revizije.
// Vrijeme se simulira upisom starih datuma u lažnu tabelu (Date u vm kontekstu se ne može pomjeriti).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGas, makeToken } from './fake-gas.mjs';

const tokFor = (email, sub) => makeToken({ sub: sub ?? 'sub-' + email, email, name: email.split('@')[0], hd: 'eestec-sa.ba' });
const HR = tokFor('hr@eestec-sa.ba');
const CHAIR = tokFor('chair@eestec-sa.ba');
const user = (n) => makeToken({ sub: 'u' + n, email: `user${n}@gmail.com`, name: 'Korisnik ' + n });
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
const err = (r, code) => { assert.equal(r.ok, false, 'očekivana greška ' + code + ', dobijeno ' + JSON.stringify(r)); assert.equal(r.error.code, code, JSON.stringify(r)); return r.error; };
const monthsAgo = (m) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString(); };
const fresh = () => { const g = createGas(); g.setup(); return g; };

function world(g) {
  const ev = ok(g.call({ action: 'createEvent', idToken: HR, name: 'Stari događaj', year: 2024 })).event;
  ok(g.call({ action: 'updateEvent', idToken: HR, id: ev.id, status: 'PUBLISHED' }));
  const poll = ok(g.call({ action: 'managePoll', idToken: HR, op: 'create', eventId: ev.id, title: 'Ručak', resultsVisibility: 'ALWAYS' })).id;
  const o1 = ok(g.call({ action: 'managePoll', idToken: HR, op: 'addOption', pollId: poll, name: 'A' })).id;
  const o2 = ok(g.call({ action: 'managePoll', idToken: HR, op: 'addOption', pollId: poll, name: 'B' })).id;
  const idf = ok(g.call({ action: 'manageFeedbackForm', idToken: HR, op: 'create', eventId: ev.id, title: 'Identificirana', mode: 'IDENTIFIED' })).id;
  const anf = ok(g.call({ action: 'manageFeedbackForm', idToken: HR, op: 'create', eventId: ev.id, title: 'Anonimna', mode: 'ANONYMOUS' })).id;
  const q = {};
  q.idq = ok(g.call({ action: 'manageFeedbackForm', idToken: HR, op: 'addQuestion', formId: idf, label: 'Ocjena', type: 'RATING' })).id;
  q.idt = ok(g.call({ action: 'manageFeedbackForm', idToken: HR, op: 'addQuestion', formId: idf, label: 'Komentar', type: 'LONG' })).id;
  q.anq = ok(g.call({ action: 'manageFeedbackForm', idToken: HR, op: 'addQuestion', formId: anf, label: 'Ocjena', type: 'RATING' })).id;
  return { ev, poll, o1, o2, idf, anf, q };
}
const vote = (g, w, n, opt) => ok(g.call({ action: 'submitVote', idToken: user(n), pollId: w.poll, optionId: opt }));
let sid = 0;
const idResp = (g, w, n, text) => ok(g.call({ action: 'submitFeedback', idToken: user(n), formId: w.idf, acknowledgedMode: 'IDENTIFIED', submissionId: 'sub-r-' + String(++sid).padStart(6, '0'),
  answers: [{ questionId: w.q.idq, value: 4 }, { questionId: w.q.idt, value: text }] }));
const anResp = (g, w) => ok(g.call({ action: 'submitFeedback', formId: w.anf, acknowledgedMode: 'ANONYMOUS', submissionId: 'sub-r-' + String(++sid).padStart(6, '0'), answers: [{ questionId: w.q.anq, value: 5 }] }));
const setAge = (g, sheet, rowIdx, cols, iso) => { const r = g.ss.getSheetByName(sheet).data[rowIdx]; for (const c of cols) r[c] = iso; };
const voteRow = (g, n) => g.ss.getSheetByName('Votes').data.findIndex((r) => r[3] === 'u' + n);
const respRow = (g, n) => g.ss.getSheetByName('FeedbackResponses').data.findIndex((r) => r[3] === 'u' + n);

/** 1: 25 mjeseci staro (zastarjelo), 2: 23 mjeseca (ne), 3: kreiran prije 30 mjeseci ali izmijenjen nedavno (ne). */
function aged(g) {
  const w = world(g);
  vote(g, w, 1, w.o1); vote(g, w, 2, w.o2); vote(g, w, 3, w.o1);
  setAge(g, 'Votes', voteRow(g, 1), [6, 7], monthsAgo(25));
  setAge(g, 'Votes', voteRow(g, 2), [6, 7], monthsAgo(23));
  setAge(g, 'Votes', voteRow(g, 3), [6], monthsAgo(30));
  idResp(g, w, 1, 'Zovite me na 061 123 456'); idResp(g, w, 2, 'ok');
  setAge(g, 'FeedbackResponses', respRow(g, 1), [6], monthsAgo(26));
  setAge(g, 'FeedbackResponses', respRow(g, 2), [6], monthsAgo(1));
  anResp(g, w); setAge(g, 'FeedbackResponses', g.ss.getSheetByName('FeedbackResponses').data.length - 1, [6], monthsAgo(40)); // anonimni: nema ličnih podataka
  return w;
}

test('pregled rokova: samo zapisi sa ličnim podacima starijim od 24 mjeseca; pregled ništa ne mijenja', () => {
  const g = fresh(); aged(g);
  const before = JSON.stringify([g.rows('Votes'), g.rows('FeedbackResponses'), g.rows('AuditLog')]);
  const p = ok(g.call({ action: 'previewRetention', idToken: HR }));
  assert.equal(p.months, 24);
  assert.equal(p.votes, 1);
  assert.equal(p.responses, 1);
  assert.ok(p.oldest);
  assert.ok(Math.abs(new Date(p.cutoff) - new Date(monthsAgo(24))) < 5000, 'rok je tačno 24 mjeseca');
  assert.equal(JSON.stringify([g.rows('Votes'), g.rows('FeedbackResponses'), g.rows('AuditLog')]), before);
});

test('klijent ne može skratiti rok: months/cutoff/olderThan u zahtjevu se ignorišu', () => {
  const g = fresh(); aged(g);
  const p = ok(g.call({ action: 'previewRetention', idToken: HR, months: 0, cutoff: new Date().toISOString(), olderThan: 0 }));
  assert.equal(p.votes, 1);
  err(g.call({ action: 'applyRetention', idToken: HR, confirm: 'ANONIMIZIRAJ', expectedVotes: 3, expectedResponses: 2, months: 0 }), 'CONFLICT');
  assert.equal(g.rows('Votes').filter((r) => r[3].startsWith('u')).length, 3);
});

test('samo administratori: gost, običan korisnik i opozvani admin ne mogu nijednu novu akciju', () => {
  const g = fresh(); aged(g);
  ok(g.call({ action: 'setAdminActive', idToken: HR, email: 'chair@eestec-sa.ba', active: false }));
  const actions = [{ action: 'previewRetention' }, { action: 'applyRetention', confirm: 'ANONIMIZIRAJ', expectedVotes: 1, expectedResponses: 1 }, { action: 'previewUserData', email: 'user1@gmail.com' },
    { action: 'eraseUserData', email: 'user1@gmail.com', mode: 'DELETE', requestRef: 'x', confirm: 'OBRIŠI', expectedVotes: 1, expectedResponses: 1 }, { action: 'listAudit' }];
  const before = JSON.stringify([g.rows('Votes'), g.rows('FeedbackResponses'), g.rows('FeedbackAnswers')]);
  for (const tok of [undefined, user(1), CHAIR, makeToken({ sub: 'x', email: 'hr@eestec-sa.ba', email_verified: 'false' })]) {
    for (const a of actions) { const r = g.call({ ...a, idToken: tok }); assert.equal(r.ok, false); assert.ok(['UNAUTHENTICATED', 'FORBIDDEN'].includes(r.error.code), JSON.stringify(r)); }
  }
  assert.equal(JSON.stringify([g.rows('Votes'), g.rows('FeedbackResponses'), g.rows('FeedbackAnswers')]), before);
});

test('anonimizacija zahtijeva frazu i tačan broj iz pregleda; bez toga ništa se ne mijenja', () => {
  const g = fresh(); aged(g);
  const snap = () => JSON.stringify([g.rows('Votes'), g.rows('FeedbackResponses')]);
  const before = snap();
  err(g.call({ action: 'applyRetention', idToken: HR, expectedVotes: 1, expectedResponses: 1 }), 'BAD_REQUEST');
  err(g.call({ action: 'applyRetention', idToken: HR, confirm: 'anonimiziraj', expectedVotes: 1, expectedResponses: 1 }), 'BAD_REQUEST');
  err(g.call({ action: 'applyRetention', idToken: HR, confirm: 'OBRIŠI', expectedVotes: 1, expectedResponses: 1 }), 'BAD_REQUEST');
  err(g.call({ action: 'applyRetention', idToken: HR, confirm: 'ANONIMIZIRAJ', expectedVotes: 2, expectedResponses: 1 }), 'CONFLICT');
  err(g.call({ action: 'applyRetention', idToken: HR, confirm: 'ANONIMIZIRAJ', expectedVotes: '1', expectedResponses: 1 }), 'CONFLICT');
  err(g.call({ action: 'applyRetention', idToken: HR, confirm: 'ANONIMIZIRAJ' }), 'CONFLICT');
  assert.equal(snap(), before);
  assert.equal(g.rows('AuditLog').filter((r) => r[2] === 'retention.anonymize').length, 0);
});

test('anonimizacija uklanja identitet, čuva zbirne rezultate i odgovore, ne dira novije zapise, upisuje reviziju', () => {
  const g = fresh(); const w = aged(g);
  const tally = () => ok(g.call({ action: 'getEvent', slug: w.ev.slug })).polls[0].options.map((o) => o.votes);
  const tallyBefore = tally();
  const r = ok(g.call({ action: 'applyRetention', idToken: tokFor('chair@eestec-sa.ba'), confirm: 'ANONIMIZIRAJ', expectedVotes: 1, expectedResponses: 1 }));
  assert.deepEqual([r.votes, r.responses], [1, 1]);
  assert.deepEqual(tally(), tallyBefore, 'zbirni rezultati ostaju isti');
  const votes = g.rows('Votes');
  assert.equal(votes.length, 3);
  const old = votes.find((v) => v[3].startsWith('anonymized:'));
  assert.ok(old);
  assert.equal(old[4] + old[5], '');
  assert.equal(votes.filter((v) => v[3].startsWith('anonymized:')).length, 1);
  assert.ok(votes.some((v) => v[4] === 'user2@gmail.com') && votes.some((v) => v[4] === 'user3@gmail.com'), 'novije ostaje');
  const resps = g.rows('FeedbackResponses');
  const rr = resps.find((x) => x[1] === w.idf && !x[3] && !x[4]);
  assert.ok(rr, 'anonimizovan identificirani odgovor');
  assert.match(rr[6], /T00:00:00\.000Z$/);
  assert.equal(resps.find((x) => x[4] === 'user2@gmail.com') !== undefined, true);
  assert.equal(g.rows('FeedbackAnswers').filter((a) => a[1] === rr[0]).length, 2, 'odgovori ostaju');
  const log = g.rows('AuditLog').filter((x) => x[2] === 'retention.anonymize');
  assert.equal(log.length, 1);
  assert.equal(log[0][1], 'chair@eestec-sa.ba');
  const detail = JSON.parse(log[0][3]);
  assert.deepEqual([detail.months, detail.votes, detail.responses], [24, 1, 1]);
  assert.ok(!JSON.stringify(g.rows('AuditLog')).includes('user1@gmail.com'));
  // ponovno pokretanje nema šta raditi
  assert.equal(ok(g.call({ action: 'previewRetention', idToken: HR })).votes, 0);
  err(g.call({ action: 'applyRetention', idToken: HR, confirm: 'ANONIMIZIRAJ', expectedVotes: 0, expectedResponses: 0 }), 'CONFLICT');
});

test('zastarjeli stari anonimni glasovi (legacy) i anonimni odgovori nisu lični podaci i ne ulaze u brojanje', () => {
  const g = fresh(); const w = world(g);
  ok(g.call({ action: 'importSeed', idToken: HR, data: { Votes: [{ id: 'legacyvote-0001', pollId: w.poll, optionId: w.o1, userSub: 'legacy:abc', userEmail: '', userName: 'Anonimni (stari glas)', createdAt: monthsAgo(60), updatedAt: monthsAgo(60) }] } }));
  anResp(g, w); setAge(g, 'FeedbackResponses', g.ss.getSheetByName('FeedbackResponses').data.length - 1, [6], monthsAgo(60));
  const p = ok(g.call({ action: 'previewRetention', idToken: HR }));
  assert.deepEqual([p.votes, p.responses], [0, 0]);
});

test('zahtjev za brisanje: pregled daje samo brojeve; ANONYMIZE zadržava odgovore; sve uz frazu, oznaku zahtjeva i tačne brojeve', () => {
  const g = fresh(); const w = world(g);
  vote(g, w, 1, w.o1); vote(g, w, 2, w.o2); idResp(g, w, 1, 'moj komentar'); idResp(g, w, 2, 'tuđi');
  const pv = ok(g.call({ action: 'previewUserData', idToken: HR, email: ' User1@GMAIL.com ' }));
  assert.deepEqual(pv, { votes: 1, responses: 1, answers: 2, isAdmin: false });
  assert.ok(!JSON.stringify(pv).includes('moj komentar'));
  const base = { action: 'eraseUserData', idToken: CHAIR, email: 'user1@gmail.com', mode: 'ANONYMIZE', requestRef: 'zahtjev 2026-11-04', confirm: 'OBRIŠI', expectedVotes: 1, expectedResponses: 1 };
  err(g.call({ ...base, confirm: 'da' }), 'BAD_REQUEST');
  err(g.call({ ...base, requestRef: '' }), 'BAD_REQUEST');
  err(g.call({ ...base, mode: 'SVE' }), 'BAD_REQUEST');
  err(g.call({ ...base, email: 'nije-email' }), 'BAD_REQUEST');
  err(g.call({ ...base, expectedVotes: 5 }), 'CONFLICT');
  err(g.call({ ...base, email: 'niko@gmail.com', expectedVotes: 0, expectedResponses: 0 }), 'NOT_FOUND');
  assert.equal(g.rows('Votes').filter((v) => v[4] === 'user1@gmail.com').length, 1, 'ništa promijenjeno');
  ok(g.call(base));
  assert.ok(!JSON.stringify([g.rows('Votes'), g.rows('FeedbackResponses')]).includes('user1@gmail.com'));
  assert.ok(JSON.stringify([g.rows('Votes'), g.rows('FeedbackResponses')]).includes('user2@gmail.com'), 'ostali netaknuti');
  assert.equal(g.rows('FeedbackAnswers').length, 4, 'odgovori ostaju kod ANONYMIZE');
  assert.equal(ok(g.call({ action: 'previewUserData', idToken: HR, email: 'user1@gmail.com' })).votes, 0);
});

test('zahtjev za brisanje DELETE: briše glasove, odgovore i njihove stavke samo za tu osobu (i po sub-u ako je email promijenjen)', () => {
  const g = fresh(); const w = world(g);
  vote(g, w, 1, w.o1); vote(g, w, 2, w.o2); idResp(g, w, 1, 'lični podatak u tekstu'); idResp(g, w, 2, 'tuđi');
  // stariji zapis iste osobe (isti Google račun) s drugim emailom
  const sh = g.ss.getSheetByName('FeedbackResponses'); const row = sh.data.find((r) => r[3] === 'u1'); row[4] = 'stara.adresa@gmail.com';
  const pv = ok(g.call({ action: 'previewUserData', idToken: HR, email: 'user1@gmail.com' }));
  assert.equal(pv.responses, 1);
  ok(g.call({ action: 'eraseUserData', idToken: HR, email: 'user1@gmail.com', mode: 'DELETE', requestRef: 'REF-1', confirm: 'OBRIŠI', expectedVotes: pv.votes, expectedResponses: pv.responses }));
  assert.equal(g.rows('Votes').length, 1);
  assert.equal(g.rows('FeedbackResponses').length, 1);
  assert.equal(g.rows('FeedbackAnswers').length, 2);
  assert.ok(!JSON.stringify(g.ss.sheets.get('FeedbackAnswers').data).includes('lični podatak'));
  assert.ok(JSON.stringify(g.ss.sheets.get('FeedbackAnswers').data).includes('tuđi'));
});

test('dnevnik revizije: brisanje bilježi hash osobe, a ne email; promjene administratora se bilježe; samo admin čita', () => {
  const g = fresh(); const w = world(g);
  vote(g, w, 1, w.o1); idResp(g, w, 1, 'x');
  ok(g.call({ action: 'eraseUserData', idToken: HR, email: 'user1@gmail.com', mode: 'DELETE', requestRef: 'REF-77', confirm: 'OBRIŠI', expectedVotes: 1, expectedResponses: 1 }));
  ok(g.call({ action: 'addAdmin', idToken: HR, email: 'novi@eestec-sa.ba' }));
  ok(g.call({ action: 'setAdminActive', idToken: HR, email: 'novi@eestec-sa.ba', active: false }));
  const dump = JSON.stringify(g.ss.getSheetByName('AuditLog').data);
  assert.ok(!dump.includes('user1@gmail.com') && !dump.includes('"u1"') && !dump.includes('sub-'), 'dnevnik ne sadrži identitet obrisane osobe');
  const { entries } = ok(g.call({ action: 'listAudit', idToken: HR }));
  assert.deepEqual(entries.map((e) => e.action), ['admin.deactivate', 'admin.add', 'erasure.delete']);
  assert.equal(entries[2].detail.requestRef, 'REF-77');
  assert.equal(entries[2].detail.subject.length, 16);
  assert.equal(entries[2].actor, 'hr@eestec-sa.ba');
  err(g.call({ action: 'listAudit', idToken: user(1) }), 'FORBIDDEN');
  assert.ok(!JSON.stringify(g.call({ action: 'getEvent', slug: w.ev.slug })).includes('erasure'));
});

test('erasure ne dira listu Admins, ali javlja da je osoba administrator', () => {
  const g = fresh(); const w = world(g);
  const pr = tokFor('pr@eestec-sa.ba');
  ok(g.call({ action: 'submitVote', idToken: pr, pollId: w.poll, optionId: w.o1 }));
  const pv = ok(g.call({ action: 'previewUserData', idToken: HR, email: 'pr@eestec-sa.ba' }));
  assert.equal(pv.isAdmin, true);
  ok(g.call({ action: 'eraseUserData', idToken: HR, email: 'pr@eestec-sa.ba', mode: 'ANONYMIZE', requestRef: 'R', confirm: 'OBRIŠI', expectedVotes: 1, expectedResponses: 0 }));
  assert.equal(g.rows('Admins').length, 8);
  assert.equal(ok(g.call({ action: 'whoami', idToken: pr })).me.isAdmin, true);
});

test('zauzeta brava: anonimizacija i brisanje vraćaju BUSY bez izmjena', () => {
  const g = fresh(); aged(g);
  const before = JSON.stringify([g.rows('Votes'), g.rows('FeedbackResponses')]);
  g.holdLock();
  err(g.call({ action: 'applyRetention', idToken: HR, confirm: 'ANONIMIZIRAJ', expectedVotes: 1, expectedResponses: 1 }), 'BUSY');
  err(g.call({ action: 'eraseUserData', idToken: HR, email: 'user1@gmail.com', mode: 'DELETE', requestRef: 'x', confirm: 'OBRIŠI', expectedVotes: 1, expectedResponses: 1 }), 'BUSY');
  g.releaseLock();
  assert.equal(JSON.stringify([g.rows('Votes'), g.rows('FeedbackResponses')]), before);
});

test('nema automatskog brisanja: kod ne instalira okidače niti briše po vremenu; AuditLog se ne uvozi', () => {
  const src = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  assert.ok(!/ScriptApp|newTrigger|everyDays|timeBased/.test(src), 'nema okidača');
  const g = fresh();
  const r = g.call({ action: 'importSeed', idToken: HR, data: { AuditLog: [{ at: 'x', actor: 'y', action: 'z', detail: '{}', id: 'abcdefgh1234' }] } });
  assert.equal(r.ok, true);
  assert.equal(r.data.report.AuditLog, undefined);
  assert.equal(g.rows('AuditLog').filter((x) => x[2] === 'z').length, 0);
});

test('setup pravi i list AuditLog (13 listova) i ne mijenja administratore', () => {
  const g = fresh();
  assert.ok(g.ss.getSheetByName('AuditLog'));
  assert.equal(g.ss.sheets.size, 13);
  const before = JSON.stringify(g.rows('Admins'));
  g.setup();
  assert.equal(JSON.stringify(g.rows('Admins')), before);
});
