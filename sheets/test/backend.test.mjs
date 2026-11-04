import test from 'node:test';
import assert from 'node:assert/strict';
import { createGas, makeToken, CLIENT_ID } from './fake-gas.mjs';

const ADMIN = makeToken({ sub: '1001', email: 'hr@eestec-sa.ba', name: 'HR', hd: 'eestec-sa.ba' });
const ANA = makeToken({ sub: '2001', email: 'ana@gmail.com', name: 'Ana' });
const BEN = makeToken({ sub: '2002', email: 'ben@gmail.com', name: 'Ben' });

function fresh(opts) { const g = createGas(opts); g.setup(); return g; }
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
const err = (r, code) => { assert.equal(r.ok, false, 'očekivana greška ' + code); assert.equal(r.error.code, code, JSON.stringify(r)); return r.error; };

/** Događaj s agendom, anketom (2 opcije) i formom (rating + single + text), objavljen. */
function seeded(g) {
  const ev = ok(g.call({ action: 'createEvent', idToken: ADMIN, name: 'HOBOM', year: 2026, startDate: '2026-11-07', endDate: '2026-11-08' })).event;
  ok(g.call({ action: 'updateEvent', idToken: ADMIN, id: ev.id, status: 'PUBLISHED' }));
  const poll = ok(g.call({ action: 'managePoll', idToken: ADMIN, op: 'create', eventId: ev.id, title: 'Ručak subota' })).id;
  const o1 = ok(g.call({ action: 'managePoll', idToken: ADMIN, op: 'addOption', pollId: poll, name: 'Pileći file', allergens: 'gluten' })).id;
  const o2 = ok(g.call({ action: 'managePoll', idToken: ADMIN, op: 'addOption', pollId: poll, name: 'Vege burger' })).id;
  const form = ok(g.call({ action: 'manageFeedbackForm', idToken: ADMIN, op: 'create', eventId: ev.id, title: 'Utisci', mode: 'ANONYMOUS' })).id;
  const q1 = ok(g.call({ action: 'manageFeedbackForm', idToken: ADMIN, op: 'addQuestion', formId: form, label: 'Ukupna ocjena', type: 'RATING', required: true })).id;
  const q2 = ok(g.call({ action: 'manageFeedbackForm', idToken: ADMIN, op: 'addQuestion', formId: form, label: 'Šta vam se najviše svidjelo?', type: 'SINGLE', options: ['Panel', 'Hrana'] })).id;
  const q3 = ok(g.call({ action: 'manageFeedbackForm', idToken: ADMIN, op: 'addQuestion', formId: form, label: 'Komentar', type: 'LONG' })).id;
  return { ev, poll, o1, o2, form, q1, q2, q3 };
}

test('setup pravi sve listove sa zaglavljima i tekstualnim formatom', () => {
  const g = fresh();
  for (const n of ['Events', 'Agendas', 'AgendaItems', 'Polls', 'PollOptions', 'Votes', 'FeedbackForms', 'FeedbackQuestions', 'FeedbackResponses', 'FeedbackAnswers', 'Settings']) {
    const sh = g.ss.getSheetByName(n);
    assert.ok(sh, n);
    assert.equal(sh.formats, '@');
    assert.ok(sh.data[0].length > 1 || n === 'Settings');
  }
  g.setup(); // idempotentno
  assert.equal(g.rows('Settings').length, 3);
});

test('listovi se prave i sami pri prvom zahtjevu (bez setup)', () => {
  const g = createGas();
  const d = ok(g.call({ action: 'listPublishedEvents' }));
  assert.deepEqual(d.events, []);
  assert.ok(g.ss.getSheetByName('Events'));
});

test('javni pristup bez prijave: samo objavljeni događaji; nacrt je 404', () => {
  const g = fresh();
  const { ev } = seeded(g);
  const draft = ok(g.call({ action: 'createEvent', idToken: ADMIN, name: 'Tajni nacrt', year: 2026 })).event;
  const list = ok(g.call({ action: 'listPublishedEvents' }));
  assert.deepEqual(list.events.map((e) => e.name), ['HOBOM']);
  assert.equal(ok(g.call({ action: 'getEvent', slug: ev.slug })).event.name, 'HOBOM');
  err(g.call({ action: 'getEvent', slug: draft.slug }), 'NOT_FOUND');
  assert.equal(ok(g.call({ action: 'getEvent', slug: draft.slug, idToken: ADMIN })).event.name, 'Tajni nacrt');
  err(g.call({ action: 'getEvent', slug: draft.slug, idToken: ANA }), 'NOT_FOUND');
  assert.deepEqual(g.get({ action: 'listPublishedEvents' }).data.events.map((e) => e.name), ['HOBOM']);
});

test('javni odgovor ne sadrži emailove ni identitete glasača', () => {
  const g = fresh();
  const s = seeded(g);
  ok(g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: s.o1 }));
  const pub = JSON.stringify(ok(g.call({ action: 'getEvent', slug: s.ev.slug, idToken: BEN })));
  assert.ok(!pub.includes('ana@gmail.com') && !pub.includes('2001') && !pub.includes('userSub'));
});

test('admin: samo verifikovan hr@eestec-sa.ba; sve ostalo je odbijeno', () => {
  const g = fresh();
  const adminActions = ['createEvent', 'updateEvent', 'deleteOrArchiveEvent', 'manageAgenda', 'manageAgendaItems', 'managePoll', 'manageFeedbackForm', 'getAdminStatistics', 'exportResults', 'listAllEvents', 'importSeed'];
  const attackers = {
    none: undefined,
    obicanKorisnik: ANA,
    neverifikovanAdminEmail: makeToken({ sub: '9', email: 'hr@eestec-sa.ba', email_verified: 'false' }),
    pogresanClientId: makeToken({ sub: '9', email: 'hr@eestec-sa.ba', aud: 'tudji-client' }),
    istekao: makeToken({ sub: '9', email: 'hr@eestec-sa.ba', exp: String(Math.floor(Date.now() / 1000) - 10) }),
    pogresanIssuer: makeToken({ sub: '9', email: 'hr@eestec-sa.ba', iss: 'https://evil.example' }),
    smeće: 'abc',
    nijeToken: 'x'.repeat(200),
  };
  for (const [name, tok] of Object.entries(attackers)) {
    for (const a of adminActions) {
      const r = g.call({ action: a, idToken: tok, name: 'X', year: 2026, id: 'x'.repeat(10) });
      assert.equal(r.ok, false, `${name}/${a}`);
      assert.ok(['UNAUTHENTICATED', 'FORBIDDEN'].includes(r.error.code), `${name}/${a}: ${r.error.code}`);
    }
  }
  assert.equal(g.rows('Events').length, 0);
  assert.equal(ok(g.call({ action: 'whoami', idToken: ADMIN })).me.isAdmin, true);
  assert.equal(ok(g.call({ action: 'whoami', idToken: ANA })).me.isAdmin, false);
});

test('klijent ne može nametnuti identitet ni ulogu: email/role/isAdmin/userSub u tijelu se ignorišu', () => {
  const g = fresh();
  const r = g.call({ action: 'createEvent', email: 'hr@eestec-sa.ba', role: 'ADMIN', isAdmin: true, userSub: '1001', adminPassword: 'x', name: 'Hack', year: 2026 });
  err(r, 'UNAUTHENTICATED');
  const s = seeded(g);
  ok(g.call({ action: 'submitVote', idToken: ANA, email: 'hr@eestec-sa.ba', userSub: '1001', pollId: s.poll, optionId: s.o1 }));
  const v = g.rows('Votes')[0];
  assert.ok(v.includes('2001') && v.includes('ana@gmail.com') && !v.includes('1001'));
});

test('ADMIN_HD: ako je postavljen, token mora imati isti hd claim', () => {
  const g = fresh({ props: { ADMIN_HD: 'eestec-sa.ba' } });
  const noHd = makeToken({ sub: '1001', email: 'hr@eestec-sa.ba' });
  err(g.call({ action: 'listAllEvents', idToken: noHd }), 'FORBIDDEN');
  ok(g.call({ action: 'listAllEvents', idToken: ADMIN }));
});

test('provjera tokena se kešira: jedan poziv Googleu po tokenu', () => {
  const g = fresh();
  for (let i = 0; i < 5; i++) ok(g.call({ action: 'whoami', idToken: ANA }));
  assert.equal(g.stats.fetches, 1);
});

test('CLIENT_ID nije postavljen: server odbija umjesto da prihvati bilo koji token', () => {
  const g = fresh();
  delete g.scriptProps.CLIENT_ID;
  err(g.call({ action: 'whoami', idToken: ANA }), 'CONFIG');
});

test('događaji: CRUD, jedinstven slug, validacija, prelazi statusa', () => {
  const g = fresh();
  const a = ok(g.call({ action: 'createEvent', idToken: ADMIN, name: 'JobFAIR', year: 2027 })).event;
  const b = ok(g.call({ action: 'createEvent', idToken: ADMIN, name: 'JobFAIR', year: 2027 })).event;
  assert.equal(a.slug, 'jobfair-2027');
  assert.equal(b.slug, 'jobfair-2027-2');
  err(g.call({ action: 'createEvent', idToken: ADMIN, name: '', year: 2027 }), 'BAD_REQUEST');
  err(g.call({ action: 'createEvent', idToken: ADMIN, name: 'X', year: 1999 }), 'BAD_REQUEST');
  err(g.call({ action: 'createEvent', idToken: ADMIN, name: 'X', year: 2027, startDate: '2027-02-30' }), 'BAD_REQUEST');
  err(g.call({ action: 'createEvent', idToken: ADMIN, name: 'X', year: 2027, startDate: '2027-05-02', endDate: '2027-05-01' }), 'BAD_REQUEST');
  ok(g.call({ action: 'updateEvent', idToken: ADMIN, id: a.id, name: 'JobFAIR Sarajevo', location: 'ETF' }));
  assert.equal(ok(g.call({ action: 'listAllEvents', idToken: ADMIN })).events.find((e) => e.id === a.id).name, 'JobFAIR Sarajevo');
  err(g.call({ action: 'updateEvent', idToken: ADMIN, id: a.id, status: 'COMPLETED' }), 'CONFLICT'); // DRAFT -> COMPLETED
  ok(g.call({ action: 'updateEvent', idToken: ADMIN, id: a.id, status: 'PUBLISHED' }));
  ok(g.call({ action: 'updateEvent', idToken: ADMIN, id: a.id, status: 'COMPLETED' }));
  ok(g.call({ action: 'deleteOrArchiveEvent', idToken: ADMIN, id: a.id }));
  assert.equal(g.rows('Events').find((r) => r[0] === a.id)[8], 'ARCHIVED');
  err(g.call({ action: 'updateEvent', idToken: ADMIN, id: 'nepostojeci-id-123' }), 'NOT_FOUND');
});

test('trajno brisanje: samo Nacrt/Arhiva, tačan naziv, briše i povezane redove', () => {
  const g = fresh();
  const s = seeded(g);
  err(g.call({ action: 'deleteOrArchiveEvent', idToken: ADMIN, id: s.ev.id, hard: true, confirmName: 'HOBOM' }), 'CONFLICT'); // PUBLISHED
  ok(g.call({ action: 'deleteOrArchiveEvent', idToken: ADMIN, id: s.ev.id })); // arhiva
  err(g.call({ action: 'deleteOrArchiveEvent', idToken: ADMIN, id: s.ev.id, hard: true, confirmName: 'hobom' }), 'BAD_REQUEST');
  assert.equal(g.rows('Events').length, 1);
  ok(g.call({ action: 'deleteOrArchiveEvent', idToken: ADMIN, id: s.ev.id, hard: true, confirmName: 'HOBOM' }));
  for (const n of ['Events', 'Polls', 'PollOptions', 'FeedbackForms', 'FeedbackQuestions']) assert.equal(g.rows(n).length, 0, n);
});

test('agenda: stavke, redoslijed, validacija vremena, optimistički konflikt', () => {
  const g = fresh();
  const { ev } = seeded(g);
  const ag = ok(g.call({ action: 'manageAgenda', idToken: ADMIN, op: 'create', eventId: ev.id, title: 'Subota', date: '2026-11-07' })).id;
  const i1 = ok(g.call({ action: 'manageAgendaItems', idToken: ADMIN, op: 'create', agendaId: ag, startTime: '09:00', endTime: '09:30', title: 'Registracija' }));
  const i2 = ok(g.call({ action: 'manageAgendaItems', idToken: ADMIN, op: 'create', agendaId: ag, startTime: '09:30', endTime: '10:30', title: 'Otvaranje', speaker: 'Predsjednik' }));
  err(g.call({ action: 'manageAgendaItems', idToken: ADMIN, op: 'create', agendaId: ag, startTime: '25:00', endTime: '26:00', title: 'x' }), 'BAD_REQUEST');
  err(g.call({ action: 'manageAgendaItems', idToken: ADMIN, op: 'create', agendaId: ag, startTime: '10:00', endTime: '09:00', title: 'x' }), 'BAD_REQUEST');
  ok(g.call({ action: 'manageAgendaItems', idToken: ADMIN, op: 'reorder', agendaId: ag, ids: [i2.id, i1.id] }));
  let pub = ok(g.call({ action: 'getEvent', slug: ev.slug }));
  assert.deepEqual(pub.agendas[0].items.map((i) => i.title), ['Otvaranje', 'Registracija']);
  err(g.call({ action: 'manageAgendaItems', idToken: ADMIN, op: 'reorder', agendaId: ag, ids: [i2.id] }), 'BAD_REQUEST');
  const upd = ok(g.call({ action: 'manageAgendaItems', idToken: ADMIN, op: 'update', id: i1.id, version: 1, title: 'Prijava' }));
  assert.equal(upd.version, 2);
  err(g.call({ action: 'manageAgendaItems', idToken: ADMIN, op: 'update', id: i1.id, version: 1, title: 'Zastarjelo' }), 'CONFLICT');
  ok(g.call({ action: 'manageAgendaItems', idToken: ADMIN, op: 'delete', id: i2.id }));
  pub = ok(g.call({ action: 'getEvent', slug: ev.slug }));
  assert.equal(pub.agendas[0].items.length, 1);
  assert.equal(pub.agendas[0].items[0].title, 'Prijava');
  ok(g.call({ action: 'manageAgenda', idToken: ADMIN, op: 'delete', id: ag }));
  assert.equal(g.rows('AgendaItems').length, 0);
});

test('tekst koji liči na formulu ili datum se čuva kao običan tekst', () => {
  const g = fresh();
  const { ev } = seeded(g);
  const ag = ok(g.call({ action: 'manageAgenda', idToken: ADMIN, op: 'create', eventId: ev.id, title: '=HYPERLINK("http://x")', date: '2026-11-07' })).id;
  ok(g.call({ action: 'manageAgendaItems', idToken: ADMIN, op: 'create', agendaId: ag, startTime: '09:00', endTime: '09:30', title: '+1+1' }));
  const pub = ok(g.call({ action: 'getEvent', slug: ev.slug }));
  assert.equal(pub.agendas[0].title, '=HYPERLINK("http://x")');
  assert.equal(pub.agendas[0].items[0].startTime, '09:00');
  assert.equal(typeof g.ss.getSheetByName('AgendaItems').data[1][2], 'string');
});

test('glasanje: zahtijeva prijavu; jedan glas po računu; izmjena samo ako je dozvoljena', () => {
  const g = fresh();
  const s = seeded(g);
  err(g.call({ action: 'submitVote', pollId: s.poll, optionId: s.o1 }), 'UNAUTHENTICATED');
  ok(g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: s.o1 }));
  ok(g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: s.o1 })); // idempotentno
  assert.equal(g.rows('Votes').length, 1);
  ok(g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: s.o2 })); // izmjena
  assert.equal(g.rows('Votes').length, 1);
  assert.equal(ok(g.call({ action: 'getEvent', slug: s.ev.slug, idToken: ANA })).polls[0].myOptionId, s.o2);
  ok(g.call({ action: 'managePoll', idToken: ADMIN, op: 'update', id: s.poll, allowChange: false }));
  err(g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: s.o1 }), 'CONFLICT');
  assert.equal(g.rows('Votes')[0][2], s.o2);
  ok(g.call({ action: 'submitVote', idToken: BEN, pollId: s.poll, optionId: s.o1 }));
  assert.equal(g.rows('Votes').length, 2);
});

test('glasanje: opcija mora pripadati anketi; zatvorena anketa i događaj odbijaju glas', () => {
  const g = fresh();
  const s = seeded(g);
  const poll2 = ok(g.call({ action: 'managePoll', idToken: ADMIN, op: 'create', eventId: s.ev.id, title: 'Ručak nedjelja' })).id;
  const other = ok(g.call({ action: 'managePoll', idToken: ADMIN, op: 'addOption', pollId: poll2, name: 'Tuđa opcija' })).id;
  err(g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: other }), 'BAD_REQUEST');
  err(g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: 'nepostojeca-opcija-1' }), 'NOT_FOUND');
  err(g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: '<script>' }), 'BAD_REQUEST');
  assert.equal(g.rows('Votes').length, 0);
  ok(g.call({ action: 'managePoll', idToken: ADMIN, op: 'update', id: s.poll, status: 'CLOSED' }));
  err(g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: s.o1 }), 'CLOSED');
  ok(g.call({ action: 'managePoll', idToken: ADMIN, op: 'update', id: s.poll, status: 'OPEN' }));
  ok(g.call({ action: 'updateEvent', idToken: ADMIN, id: s.ev.id, status: 'COMPLETED' }));
  err(g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: s.o1 }), 'CLOSED');
  assert.equal(g.rows('Votes').length, 0);
});

test('glasanje u nacrtu događaja je 404 za običnog korisnika', () => {
  const g = fresh();
  const s = seeded(g);
  ok(g.call({ action: 'updateEvent', idToken: ADMIN, id: s.ev.id, status: 'DRAFT' }));
  err(g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: s.o1 }), 'NOT_FOUND');
});

test('istovremeni zahtjevi: brava štiti pisanje; zauzet sistem vraća BUSY, ne upisuje ništa', () => {
  const g = fresh();
  const s = seeded(g);
  g.holdLock();
  err(g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: s.o1 }), 'BUSY');
  g.releaseLock();
  assert.equal(g.rows('Votes').length, 0);
  assert.equal(g.stats.lockWaits, 1);
  ok(g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: s.o1 }));
  // brava se oslobađa i nakon greške unutar akcije
  err(g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: 'nepostojeca-opcija-1' }), 'NOT_FOUND');
  ok(g.call({ action: 'submitVote', idToken: BEN, pollId: s.poll, optionId: s.o2 }));
});

test('50 uzastopnih glasova istog korisnika daju jedan red; brava ne ostaje zaključana', () => {
  const g = fresh();
  const s = seeded(g);
  for (let i = 0; i < 50; i++) g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: i % 2 ? s.o1 : s.o2 });
  assert.equal(g.rows('Votes').length, 1);
});

test('vidljivost rezultata ankete', () => {
  const g = fresh();
  const s = seeded(g);
  ok(g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: s.o1 }));
  const poll = (tok) => ok(g.call({ action: 'getEvent', slug: s.ev.slug, idToken: tok })).polls[0];
  const set = (v) => ok(g.call({ action: 'managePoll', idToken: ADMIN, op: 'update', id: s.poll, resultsVisibility: v }));
  set('AFTER_VOTE');
  assert.equal(poll(undefined).resultsShown, false);
  assert.equal(poll(BEN).resultsShown, false);
  assert.equal(poll(ANA).resultsShown, true);
  assert.equal(poll(undefined).options[0].votes, null);
  set('ALWAYS');
  assert.equal(poll(undefined).options[0].votes, 1);
  set('AFTER_CLOSE');
  assert.equal(poll(ANA).resultsShown, false);
  ok(g.call({ action: 'managePoll', idToken: ADMIN, op: 'update', id: s.poll, status: 'CLOSED' }));
  assert.equal(poll(undefined).resultsShown, true);
  set('ADMIN');
  assert.equal(poll(ANA).resultsShown, false);
  assert.equal(poll(ADMIN).resultsShown, true);
});

test('opcija s glasovima se arhivira, a ne briše; bez glasova se briše; reset traži potvrdu', () => {
  const g = fresh();
  const s = seeded(g);
  ok(g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: s.o1 }));
  assert.equal(ok(g.call({ action: 'managePoll', idToken: ADMIN, op: 'removeOption', id: s.o1 })).archived, true);
  assert.equal(ok(g.call({ action: 'managePoll', idToken: ADMIN, op: 'removeOption', id: s.o2 })).deleted, true);
  const pub = ok(g.call({ action: 'getEvent', slug: s.ev.slug }));
  assert.equal(pub.polls[0].options.length, 0);
  err(g.call({ action: 'submitVote', idToken: BEN, pollId: s.poll, optionId: s.o1 }), 'BAD_REQUEST'); // arhivirana
  assert.equal(ok(g.call({ action: 'getEvent', slug: s.ev.slug, idToken: ADMIN, includeArchived: true })).polls[0].options.length, 1);
  err(g.call({ action: 'managePoll', idToken: ADMIN, op: 'resetVotes', id: s.poll }), 'BAD_REQUEST');
  err(g.call({ action: 'managePoll', idToken: ADMIN, op: 'delete', id: s.poll }), 'BAD_REQUEST');
  assert.equal(g.rows('Votes').length, 1);
  ok(g.call({ action: 'managePoll', idToken: ADMIN, op: 'resetVotes', id: s.poll, confirm: 'OBRIŠI' }));
  assert.equal(g.rows('Votes').length, 0);
});

test('admin vidi glasače i rezultate; statistika je tačna', () => {
  const g = fresh();
  const s = seeded(g);
  ok(g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: s.o1 }));
  ok(g.call({ action: 'submitVote', idToken: BEN, pollId: s.poll, optionId: s.o1 }));
  const st = ok(g.call({ action: 'getAdminStatistics', idToken: ADMIN, eventId: s.ev.id }));
  const o = st.polls[0].options.find((x) => x.id === s.o1);
  assert.equal(o.votes, 2);
  assert.deepEqual(o.voters.map((v) => v.email).sort(), ['ana@gmail.com', 'ben@gmail.com']);
  assert.equal(st.polls[0].total, 2);
});

test('anonimni feedback: bez prijave; u tabeli nema identiteta ni uređaja; vrijeme je zaokruženo na dan', () => {
  const g = fresh();
  const s = seeded(g);
  g.stats.fetches = 0;
  const body = { action: 'submitFeedback', formId: s.form, acknowledgedMode: 'ANONYMOUS', device: 'moj-uredjaj-123', answers: [{ questionId: s.q1, value: 5 }, { questionId: s.q2, value: 'Hrana' }, { questionId: s.q3, value: 'Super!' }] };
  ok(g.call({ ...body, submissionId: 'sub-00000001' }));
  // Čak i ako pošalje validan token, anonimna forma ga ignoriše.
  ok(g.call({ ...body, device: 'drugi-uredjaj', idToken: ANA, submissionId: 'sub-00000002' }));
  const dump = JSON.stringify(g.ss.sheets.get('FeedbackResponses').data) + JSON.stringify(g.ss.sheets.get('FeedbackAnswers').data);
  for (const leak of ['ana@gmail.com', '2001', 'Ana', 'moj-uredjaj-123', 'drugi-uredjaj']) assert.ok(!dump.includes(leak), 'procurilo: ' + leak);
  for (const r of g.rows('FeedbackResponses')) { assert.match(r[6], /T00:00:00\.000Z$/); assert.equal(r[3] + r[4] + r[5], ''); }
  assert.equal(g.stats.fetches, 0, 'anonimna forma ne smije ni provjeravati token');
  const adm = ok(g.call({ action: 'getAdminStatistics', idToken: ADMIN, eventId: s.ev.id })).forms[0];
  assert.equal(adm.responseCount, 2);
  assert.ok(adm.responses.every((r) => r.email === undefined && r.name === undefined));
  assert.equal(adm.stats[0].average, 5);
});

test('feedback: validacija, obavezna pitanja, duplikati, honeypot, mode, idempotentnost', () => {
  const g = fresh();
  const s = seeded(g);
  const base = { action: 'submitFeedback', formId: s.form, acknowledgedMode: 'ANONYMOUS' };
  err(g.call({ ...base, submissionId: 'sub-10000001', answers: [{ questionId: s.q2, value: 'Hrana' }] }), 'BAD_REQUEST'); // nedostaje obavezno
  err(g.call({ ...base, submissionId: 'sub-10000002', answers: [{ questionId: s.q1, value: 6 }] }), 'BAD_REQUEST');
  err(g.call({ ...base, submissionId: 'sub-10000003', answers: [{ questionId: s.q1, value: 3.5 }] }), 'BAD_REQUEST');
  err(g.call({ ...base, submissionId: 'sub-10000004', answers: [{ questionId: s.q1, value: 4 }, { questionId: s.q2, value: 'Nepostojeće' }] }), 'BAD_REQUEST');
  err(g.call({ ...base, submissionId: 'sub-10000005', answers: [{ questionId: s.q1, value: 4 }, { questionId: s.q1, value: 5 }] }), 'BAD_REQUEST');
  err(g.call({ ...base, submissionId: 'sub-10000006', answers: [{ questionId: 'nepoznato-pitanje', value: 4 }] }), 'BAD_REQUEST');
  err(g.call({ ...base, submissionId: 'sub-10000007', answers: [{ questionId: s.q1, value: 4 }, { questionId: s.q3, value: 'x'.repeat(2001) }] }), 'BAD_REQUEST');
  err(g.call({ ...base, submissionId: 'sub-10000008', answers: 'nije lista' }), 'BAD_REQUEST');
  err(g.call({ ...base, acknowledgedMode: 'IDENTIFIED', submissionId: 'sub-10000009', answers: [{ questionId: s.q1, value: 4 }] }), 'MODE_CHANGED');
  err(g.call({ ...base, submissionId: 'x', answers: [{ questionId: s.q1, value: 4 }] }), 'BAD_REQUEST');
  assert.equal(g.rows('FeedbackResponses').length, 0);
  assert.equal(g.rows('FeedbackAnswers').length, 0, 'neuspjeli zahtjev ne ostavlja polovične redove');
  ok(g.call({ ...base, submissionId: 'sub-10000010', hp: 'bot', answers: [{ questionId: s.q1, value: 4 }] })); // honeypot
  assert.equal(g.rows('FeedbackResponses').length, 0);
  ok(g.call({ ...base, submissionId: 'sub-10000011', answers: [{ questionId: s.q1, value: 4 }] }));
  const again = ok(g.call({ ...base, submissionId: 'sub-10000011', answers: [{ questionId: s.q1, value: 4 }] }));
  assert.equal(again.duplicate, true);
  assert.equal(g.rows('FeedbackResponses').length, 1);
});

test('anonimna zaštita od zloupotrebe: ograničenje po uređaju i po formi', () => {
  const g = fresh();
  const s = seeded(g);
  const send = (i, device) => g.call({ action: 'submitFeedback', formId: s.form, acknowledgedMode: 'ANONYMOUS', device, submissionId: 'sub-2000' + String(i).padStart(4, '0'), answers: [{ questionId: s.q1, value: 3 }] });
  for (let i = 0; i < 5; i++) ok(send(i, 'isti-uredjaj'));
  err(send(5, 'isti-uredjaj'), 'RATE_LIMITED');
  for (let i = 10; i < 125; i++) ok(send(i, 'uredjaj-' + i));
  assert.equal(send(200, 'jos-jedan').error.code, 'RATE_LIMITED'); // 120 po formi na 10 min (5 + 115 = 120)
});

test('identificirani feedback: traži prijavu, jedan odgovor po računu, admin vidi identitet', () => {
  const g = fresh();
  const s = seeded(g);
  ok(g.call({ action: 'manageFeedbackForm', idToken: ADMIN, op: 'update', id: s.form, mode: 'IDENTIFIED' }));
  const body = { action: 'submitFeedback', formId: s.form, acknowledgedMode: 'IDENTIFIED', answers: [{ questionId: s.q1, value: 4 }] };
  err(g.call({ ...body, submissionId: 'sub-30000001' }), 'UNAUTHENTICATED');
  ok(g.call({ ...body, idToken: ANA, submissionId: 'sub-30000002' }));
  err(g.call({ ...body, idToken: ANA, submissionId: 'sub-30000003' }), 'CONFLICT');
  assert.equal(ok(g.call({ action: 'getEvent', slug: s.ev.slug, idToken: ANA })).forms[0].submitted, true);
  assert.equal(ok(g.call({ action: 'getEvent', slug: s.ev.slug, idToken: BEN })).forms[0].submitted, false);
  const adm = ok(g.call({ action: 'getAdminStatistics', idToken: ADMIN, eventId: s.ev.id })).forms[0];
  assert.equal(adm.responses[0].email, 'ana@gmail.com');
  assert.match(g.rows('FeedbackResponses')[0][6], /T\d\d:\d\d:\d\d/);
});

test('način forme se ne može mijenjati nakon odgovora; zatvorena forma ne prima odgovore', () => {
  const g = fresh();
  const s = seeded(g);
  const body = { action: 'submitFeedback', formId: s.form, acknowledgedMode: 'ANONYMOUS', answers: [{ questionId: s.q1, value: 4 }] };
  ok(g.call({ ...body, submissionId: 'sub-40000001' }));
  err(g.call({ action: 'manageFeedbackForm', idToken: ADMIN, op: 'update', id: s.form, mode: 'IDENTIFIED' }), 'CONFLICT');
  ok(g.call({ action: 'manageFeedbackForm', idToken: ADMIN, op: 'update', id: s.form, status: 'CLOSED' }));
  err(g.call({ ...body, submissionId: 'sub-40000002' }), 'CLOSED');
  ok(g.call({ action: 'manageFeedbackForm', idToken: ADMIN, op: 'update', id: s.form, status: 'OPEN' }));
  ok(g.call({ action: 'updateEvent', idToken: ADMIN, id: s.ev.id, status: 'COMPLETED' }));
  ok(g.call({ ...body, submissionId: 'sub-40000003' })); // COMPLETED još prima feedback
  ok(g.call({ action: 'updateEvent', idToken: ADMIN, id: s.ev.id, status: 'ARCHIVED' }));
  err(g.call({ ...body, submissionId: 'sub-40000004' }), 'CLOSED');
});

test('historija odgovora: izmjena i arhiviranje pitanja ne mijenjaju smisao starih odgovora', () => {
  const g = fresh();
  const s = seeded(g);
  const send = (id, answers) => ok(g.call({ action: 'submitFeedback', formId: s.form, acknowledgedMode: 'ANONYMOUS', submissionId: id, answers }));
  send('sub-50000001', [{ questionId: s.q1, value: 5 }, { questionId: s.q2, value: 'Panel' }]);
  ok(g.call({ action: 'manageFeedbackForm', idToken: ADMIN, op: 'updateQuestion', id: s.q2, label: 'Šta biste mijenjali?', type: 'SINGLE', options: ['Lokaciju', 'Termin'] }));
  send('sub-50000002', [{ questionId: s.q1, value: 4 }, { questionId: s.q2, value: 'Termin' }]);
  const answers = g.rows('FeedbackAnswers').filter((r) => r[3] === s.q2);
  assert.deepEqual(answers.map((r) => r[4]).sort(), ['Šta biste mijenjali?', 'Šta vam se najviše svidjelo?']);
  assert.equal(ok(g.call({ action: 'manageFeedbackForm', idToken: ADMIN, op: 'removeQuestion', id: s.q2 })).archived, true);
  assert.equal(ok(g.call({ action: 'manageFeedbackForm', idToken: ADMIN, op: 'removeQuestion', id: s.q3 })).deleted, true); // bez odgovora
  const csv = ok(g.call({ action: 'exportResults', idToken: ADMIN, kind: 'feedback', id: s.form })).csv;
  assert.match(csv, /\(arhivirano\)/);
  assert.match(csv, /Panel/);
  assert.match(csv, /Termin/);
  // arhivirano pitanje se više ne prikazuje javno, ali stara statistika ostaje
  assert.equal(ok(g.call({ action: 'getEvent', slug: s.ev.slug })).forms[0].questions.length, 1);
  const stats = ok(g.call({ action: 'getAdminStatistics', idToken: ADMIN, eventId: s.ev.id })).forms[0].stats;
  assert.equal(stats.find((x) => x.questionId === s.q2).count, 2);
  assert.equal(stats.find((x) => x.questionId === s.q1).average, 4.5);
  ok(g.call({ action: 'manageFeedbackForm', idToken: ADMIN, op: 'restoreQuestion', id: s.q2 }));
  err(g.call({ action: 'manageFeedbackForm', idToken: ADMIN, op: 'delete', id: s.form }), 'BAD_REQUEST'); // ima odgovore
  err(g.call({ action: 'manageFeedbackForm', idToken: ADMIN, op: 'deleteResponses', id: s.form }), 'BAD_REQUEST');
  ok(g.call({ action: 'manageFeedbackForm', idToken: ADMIN, op: 'deleteResponses', id: s.form, confirm: 'OBRIŠI' }));
  assert.equal(g.rows('FeedbackResponses').length, 0);
});

test('pitanje s višestrukim izborom: statistika i CSV', () => {
  const g = fresh();
  const s = seeded(g);
  const m = ok(g.call({ action: 'manageFeedbackForm', idToken: ADMIN, op: 'addQuestion', formId: s.form, label: 'Teme', type: 'MULTI', options: ['A', 'B', 'C'] })).id;
  err(g.call({ action: 'manageFeedbackForm', idToken: ADMIN, op: 'addQuestion', formId: s.form, label: 'Loše', type: 'MULTI', options: ['A'] }), 'BAD_REQUEST');
  err(g.call({ action: 'manageFeedbackForm', idToken: ADMIN, op: 'addQuestion', formId: s.form, label: 'Loše', type: 'MULTI', options: ['A', 'A'] }), 'BAD_REQUEST');
  const send = (id, v) => g.call({ action: 'submitFeedback', formId: s.form, acknowledgedMode: 'ANONYMOUS', submissionId: id, answers: [{ questionId: s.q1, value: 5 }, { questionId: m, value: v }] });
  ok(send('sub-60000001', ['A', 'C']));
  ok(send('sub-60000002', ['C']));
  err(send('sub-60000003', ['A', 'A']), 'BAD_REQUEST');
  err(send('sub-60000004', ['Z']), 'BAD_REQUEST');
  err(send('sub-60000005', 'A'), 'BAD_REQUEST');
  const st = ok(g.call({ action: 'getAdminStatistics', idToken: ADMIN, eventId: s.ev.id })).forms[0].stats.find((x) => x.questionId === m);
  assert.deepEqual(st.counts, { A: 1, B: 0, C: 2 });
  assert.match(ok(g.call({ action: 'exportResults', idToken: ADMIN, kind: 'feedback', id: s.form })).csv, /A; C/);
});

test('CSV: zaštita od injekcije formula, navodnici i zarezi, BOM', () => {
  const g = fresh();
  const s = seeded(g);
  const evil = makeToken({ sub: '3003', email: 'evil@gmail.com', name: '=cmd|\' /C calc\'!A1' });
  ok(g.call({ action: 'submitVote', idToken: evil, pollId: s.poll, optionId: s.o1 }));
  ok(g.call({ action: 'managePoll', idToken: ADMIN, op: 'updateOption', id: s.o2, name: 'Sa "navodnicima", zarezom' }));
  ok(g.call({ action: 'submitVote', idToken: ANA, pollId: s.poll, optionId: s.o2 }));
  const { csv, filename } = ok(g.call({ action: 'exportResults', idToken: ADMIN, kind: 'poll', id: s.poll }));
  assert.ok(csv.startsWith('\ufeff'));
  assert.ok(csv.includes(",'=cmd|"), csv);
  assert.ok(csv.includes('"Sa ""navodnicima"", zarezom"'));
  assert.match(filename, /\.csv$/);
});

test('nepoznate akcije, loš JSON, preveliko tijelo, prototype ključevi', () => {
  const g = fresh();
  err(g.call({ action: 'dropEverything' }), 'BAD_REQUEST');
  err(g.call({ action: '__proto__' }), 'BAD_REQUEST');
  err(g.call({ action: 'constructor' }), 'BAD_REQUEST');
  err(g.call({}), 'BAD_REQUEST');
  err(g.call('[1,2]'), 'BAD_REQUEST');
  err(g.call('{nije json'), 'BAD_REQUEST');
  err(g.call({ action: 'whoami', pad: 'x'.repeat(250000) }), 'BAD_REQUEST');
  err(g.call({ action: 'getEvent', slug: { $ne: 1 } }), 'BAD_REQUEST');
});

test('neočekivana greška ne otkriva detalje klijentu', () => {
  const g = fresh();
  g.ss.sheets.delete('Events');
  g.ss.insertSheet('Events').getRange(1, 1, 1, 2).setValues([['pogresno', 'zaglavlje']]);
  const r = g.call({ action: 'listPublishedEvents' });
  err(r, 'CONFIG'); // pogrešno zaglavlje je jasna konfiguraciona greška, ne curenje
  assert.ok(!JSON.stringify(r).includes('stack'));
});

test('uvoz starih podataka: samo admin, preskače postojeće redove (idempotentno)', () => {
  const g = fresh();
  const data = { Events: [{ id: 'ev-hobom-0001', slug: 'hobom-2026', name: 'HOBOM', year: 2026, status: 'COMPLETED', startDate: '2026-11-07', endDate: '2026-11-08', createdAt: now(), updatedAt: now() }],
    Agendas: [{ id: 'ag-sub-00001', eventId: 'ev-hobom-0001', title: 'Subota', date: '2026-11-07', position: 0, createdAt: now() }],
    AgendaItems: [{ id: 'it-00000001', agendaId: 'ag-sub-00001', startTime: '09:00', endTime: '10:00', title: 'Otvaranje', position: 0, version: 1 }] };
  err(g.call({ action: 'importSeed', idToken: ANA, data }), 'FORBIDDEN');
  assert.equal(ok(g.call({ action: 'importSeed', idToken: ADMIN, data })).report.Events.added, 1);
  assert.equal(ok(g.call({ action: 'importSeed', idToken: ADMIN, data })).report.Events.added, 0);
  assert.equal(g.rows('Events').length, 1);
  assert.equal(ok(g.call({ action: 'getEvent', slug: 'hobom-2026' })).agendas[0].items[0].title, 'Otvaranje');
});
function now() { return new Date().toISOString(); }

test('više događaja i godina, bez ikakvih ugrađenih ID-ova', () => {
  const g = fresh();
  for (const y of [2024, 2025, 2026]) {
    const e = ok(g.call({ action: 'createEvent', idToken: ADMIN, name: 'HOBOM', year: y, startDate: `${y}-11-07` })).event;
    ok(g.call({ action: 'updateEvent', idToken: ADMIN, id: e.id, status: 'PUBLISHED' }));
  }
  const l = ok(g.call({ action: 'listPublishedEvents' })).events;
  assert.deepEqual(l.map((e) => e.slug), ['hobom-2026', 'hobom-2025', 'hobom-2024']);
});

test('izvorni kod ne sadrži ugrađene tajne ni lozinke', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  assert.ok(!/password|client_secret|private_key|apps\.googleusercontent\.com/i.test(src));
  assert.ok(CLIENT_ID.length > 0);
});

test('vrste stavki agende (pauza, ručak, kraj) i napomene se čuvaju; "Kraj" smije imati isto vrijeme', () => {
  const g = fresh();
  const { ev } = seeded(g);
  const ag = ok(g.call({ action: 'manageAgenda', idToken: ADMIN, op: 'create', eventId: ev.id, title: 'Nedjelja' })).id;
  const mk = (extra) => g.call({ action: 'manageAgendaItems', idToken: ADMIN, op: 'create', agendaId: ag, ...extra });
  ok(mk({ startTime: '10:00', endTime: '10:15', title: 'Pauza', kind: 'BREAK', notes: 'Kafa' }));
  ok(mk({ startTime: '11:15', endTime: '11:15', title: 'Kraj', kind: 'END' }));
  err(mk({ startTime: '11:15', endTime: '11:15', title: 'Sesija', kind: 'SESSION' }), 'BAD_REQUEST');
  err(mk({ startTime: '11:15', endTime: '11:30', title: 'X', kind: 'NEPOZNATO' }), 'BAD_REQUEST');
  const items = ok(g.call({ action: 'getEvent', slug: ev.slug })).agendas[0].items;
  assert.deepEqual(items.map((i) => i.kind), ['BREAK', 'END']);
  assert.equal(items[0].notes, 'Kafa');
});

test('nadogradnja šeme: setup dodaje kolone koje nedostaju u postojećem listu, bez gubitka podataka', () => {
  const g = fresh();
  const { ev } = seeded(g);
  const sh = g.ss.getSheetByName('AgendaItems');
  const ag = ok(g.call({ action: 'manageAgenda', idToken: ADMIN, op: 'create', eventId: ev.id, title: 'Dan' })).id;
  ok(g.call({ action: 'manageAgendaItems', idToken: ADMIN, op: 'create', agendaId: ag, startTime: '09:00', endTime: '10:00', title: 'Staro' }));
  // simuliraj staru verziju: ukloni zadnje dvije kolone
  sh.data = sh.data.map((r) => r.slice(0, 10));
  assert.ok(!sh.data[0].includes('kind'));
  g.setup();
  assert.ok(sh.data[0].includes('kind') && sh.data[0].includes('notes'));
  const it = ok(g.call({ action: 'getEvent', slug: ev.slug })).agendas[0].items[0];
  assert.equal(it.title, 'Staro');
  assert.equal(it.kind, 'SESSION');
});

test('uvoz: nevaljani ID-evi u redovima se odbijaju', () => {
  const g = fresh();
  err(g.call({ action: 'importSeed', idToken: ADMIN, data: { Events: [{ id: "x'; DROP", name: 'Loš' }] } }), 'BAD_REQUEST');
  err(g.call({ action: 'importSeed', idToken: ADMIN, data: { Agendas: [{ id: 'ag-valid-0001', eventId: '<script>' }] } }), 'BAD_REQUEST');
  assert.equal(g.rows('Events').length + g.rows('Agendas').length, 0);
});
