// Preslikavanje stare baze -> Sheets, provjereno SINTETIČKIM podacima u obliku stare Prisma šeme.
// Stvarni izvoz iz razvojne baze nije izvršen u ovoj sesiji (Docker nije pokrenut): vidi TEST-RESULTS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLegacy, mapSub, parseDateLabel } from '../scripts/legacy-map.mjs';
import { createGas, makeToken } from './fake-gas.mjs';

const ADMIN = makeToken({ sub: '1001', email: 'hr@eestec-sa.ba', name: 'HR' });
const d = (s) => new Date(s);

function legacy() {
  return {
    users: [{ id: 'u1', auth0Sub: 'google-oauth2|112233445566', email: 'ana@gmail.com', name: 'Ana' }, { id: 'u2', auth0Sub: 'dev|user', email: 'dev@x.ba', name: 'Dev' }],
    projects: [{ id: 'cproj0000000000000000001', slug: 'hobom-2026', name: 'HOBOM', description: 'Opis', location: 'Sarajevo', startsAt: d('2026-11-07T08:00:00Z'), endsAt: d('2026-11-08T16:00:00Z'), status: 'PUBLISHED', createdAt: d('2026-10-01'), updatedAt: d('2026-10-02') }],
    agendas: [{ id: 'cagenda000000000000000001', projectId: 'cproj0000000000000000001', title: 'Subota', dateLabel: '7. novembar 2026.', position: 0 },
      { id: 'cagenda000000000000000002', projectId: 'cproj0000000000000000001', title: 'Nedjelja', dateLabel: 'neka nedjelja', position: 1 }],
    agendaItems: [
      { id: 'citem0000000000000000001', agendaId: 'cagenda000000000000000001', startTime: '09:00', endTime: '10:00', title: 'Otvaranje', description: '', speaker: 'Predsjednik', location: '', notes: 'Dobrodošlica', kind: 'SESSION', version: 0, position: 0 },
      { id: 'citem0000000000000000002', agendaId: 'cagenda000000000000000001', startTime: '13:00', endTime: '13:00', title: 'Kraj', description: '', speaker: '', location: '', notes: '', kind: 'END', version: 3, position: 1 }],
    polls: [{ id: 'cpoll0000000000000000001', projectId: 'cproj0000000000000000001', title: 'Ručak', description: '', isOpen: false, allowChange: true, showResultsWhileOpen: true }],
    options: [{ id: 'copt00000000000000000001', pollId: 'cpoll0000000000000000001', name: 'Piletina', description: '', allergens: 'gluten', position: 0, archivedAt: null },
      { id: 'copt00000000000000000002', pollId: 'cpoll0000000000000000001', name: 'Vege', description: '', allergens: '', position: 1, archivedAt: d('2026-10-05') }],
    votes: [
      { id: 'cvote0000000000000000001', pollId: 'cpoll0000000000000000001', optionId: 'copt00000000000000000001', userId: 'u1', voterHash: null, createdAt: d('2026-11-01'), updatedAt: d('2026-11-02') },
      { id: 'cvote0000000000000000002', pollId: 'cpoll0000000000000000001', optionId: 'copt00000000000000000002', userId: null, voterHash: 'abcdef0123456789abcdef0123456789', createdAt: d('2026-11-01'), updatedAt: d('2026-11-01') },
      { id: 'cvote0000000000000000003', pollId: 'cpoll0000000000000000001', optionId: 'copt00000000000000000001', userId: null, voterHash: null, createdAt: d('2026-11-01'), updatedAt: d('2026-11-01') }],
    forms: [{ id: 'cform0000000000000000001', projectId: 'cproj0000000000000000001', title: 'Utisci', description: '', isOpen: true, mode: 'ANONYMOUS', oneResponsePerUser: true }],
    questions: [{ id: 'cq0000000000000000000001', formId: 'cform0000000000000000001', label: 'Ocjena', type: 'RATING', options: [], required: true, enabled: true, archivedAt: null, position: 0 },
      { id: 'cq0000000000000000000002', formId: 'cform0000000000000000001', label: 'Izbor', type: 'SINGLE_CHOICE', options: ['A', 'B'], required: false, enabled: true, archivedAt: null, position: 1 },
      { id: 'cq0000000000000000000003', formId: 'cform0000000000000000001', label: 'Teme', type: 'MULTIPLE_CHOICE', options: ['X', 'Y'], required: false, enabled: false, archivedAt: null, position: 2 }],
    responses: [{ id: 'cresp0000000000000000001', formId: 'cform0000000000000000001', userId: null, createdAt: d('2026-11-08T00:00:00Z') }],
    answers: [
      { id: 'cans00000000000000000001', formId: 'cform0000000000000000001', responseId: 'cresp0000000000000000001', questionId: 'cq0000000000000000000001', questionLabel: 'Ocjena', questionType: 'RATING', questionOptions: [], rating: 5, text: null, choices: [] },
      { id: 'cans00000000000000000002', formId: 'cform0000000000000000001', responseId: 'cresp0000000000000000001', questionId: 'cq0000000000000000000002', questionLabel: 'Staro pitanje', questionType: 'SINGLE_CHOICE', questionOptions: ['A', 'B'], rating: null, text: null, choices: ['B'] },
      { id: 'cans00000000000000000003', formId: 'cform0000000000000000001', responseId: 'cresp0000000000000000001', questionId: 'cq0000000000000000000003', questionLabel: 'Teme', questionType: 'MULTIPLE_CHOICE', questionOptions: ['X', 'Y'], rating: null, text: null, choices: ['X', 'Y'] }],
  };
}

test('Auth0 sub -> Google sub; ostali identiteti ostaju označeni kao legacy', () => {
  assert.equal(mapSub('google-oauth2|112233445566'), '112233445566');
  assert.equal(mapSub('dev|user'), 'legacy:dev|user');
  assert.equal(mapSub(undefined), 'legacy:');
});

test('prepoznavanje datuma iz starih oznaka', () => {
  assert.equal(parseDateLabel('10. 3. 2027.'), '2027-03-10');
  assert.equal(parseDateLabel('7. novembar 2026.'), '2026-11-07');
  assert.equal(parseDateLabel('10.03.2027'), '2027-03-10');
  assert.equal(parseDateLabel('31. 2. 2027.'), '');
  assert.equal(parseDateLabel('subota'), '');
});

test('preslikavanje čuva sve redove, statuse, vidljivost i snimke odgovora; prijavljuje šta nije prenijeto', () => {
  const { data, report } = mapLegacy(legacy());
  assert.deepEqual(report.counts, { Events: 1, Agendas: 2, AgendaItems: 2, Polls: 1, PollOptions: 2, Votes: 2, FeedbackForms: 1, FeedbackQuestions: 3, FeedbackResponses: 1, FeedbackAnswers: 3 });
  assert.equal(Object.values(report.skipped)[0], 1);
  assert.ok(report.warnings.some((w) => w.includes('neka nedjelja')));
  assert.equal(data.Events[0].year, 2026);
  assert.equal(data.Polls[0].status, 'CLOSED');
  assert.equal(data.Polls[0].resultsVisibility, 'ALWAYS');
  assert.equal(data.PollOptions[1].archived, true);
  assert.equal(data.Votes[0].userSub, '112233445566');
  assert.match(data.Votes[1].userSub, /^legacy:abcdef/);
  assert.equal(data.FeedbackQuestions[2].archived, true); // enabled=false -> arhivirano
  assert.equal(data.FeedbackQuestions[1].type, 'SINGLE');
  assert.deepEqual(data.FeedbackAnswers.map((a) => a.value), ['5', 'B', '["X","Y"]']);
  assert.equal(data.FeedbackAnswers[1].questionLabel, 'Staro pitanje');
  assert.equal(data.AgendaItems[0].version, 1);
  assert.equal(data.FeedbackResponses[0].userSub, '');
});

test('anonimni odgovor ne preuzima identitet ni kad ga stara baza ima', () => {
  const db = legacy();
  db.responses[0].userId = 'u1';
  const { data, report } = mapLegacy(db);
  assert.equal(data.FeedbackResponses[0].userEmail, '');
  assert.ok(report.warnings.some((w) => w.includes('identitet NIJE preuzet')));
});

test('uvoz u Sheets (preko importSeed): sve se vidi javno, glas se veže za Google identitet, ponovni uvoz je siguran', () => {
  const g = createGas(); g.setup();
  const { data } = mapLegacy(legacy());
  const first = g.call({ action: 'importSeed', idToken: ADMIN, data });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.data.report.Events.added, 1);
  const second = g.call({ action: 'importSeed', idToken: ADMIN, data });
  assert.equal(second.data.report.Events.added, 0);
  assert.equal(g.rows('Votes').length, 2);

  const ev = g.call({ action: 'getEvent', slug: 'hobom-2026' }).data;
  assert.equal(ev.agendas[0].items[0].title, 'Otvaranje');
  assert.equal(ev.agendas[0].items[1].kind, 'END');
  assert.equal(ev.polls[0].open, false);
  assert.equal(ev.polls[0].options.length, 1); // arhivirana opcija nije javna
  assert.equal(ev.polls[0].total, 2);

  // Ana se kasnije prijavi pravim Google tokenom (sub=112233445566) i sistem prepoznaje njen stari glas.
  const ana = makeToken({ sub: '112233445566', email: 'ana@gmail.com', name: 'Ana' });
  assert.equal(g.call({ action: 'getEvent', slug: 'hobom-2026', idToken: ana }).data.polls[0].myOptionId, 'copt00000000000000000001');

  const stats = g.call({ action: 'getAdminStatistics', idToken: ADMIN, eventId: 'cproj0000000000000000001' }).data;
  assert.equal(stats.forms[0].stats.find((s) => s.questionId === 'cq0000000000000000000002').counts.B, 1);
  const csv = g.call({ action: 'exportResults', idToken: ADMIN, kind: 'feedback', id: 'cform0000000000000000001' }).data.csv;
  assert.match(csv, /Staro pitanje|Izbor/);
});
