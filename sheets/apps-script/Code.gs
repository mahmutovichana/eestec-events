/**
 * EESTEC Events — Google Apps Script backend (v1.0.0)
 *
 * Jedina trajna pohrana je Google Spreadsheet u koji je skripta ugrađena (container-bound).
 * Web app se objavljuje kao: Execute as = Me, Who has access = Anyone.
 * Identitet se NIKAD ne uzima iz zahtjeva: klijent šalje Google ID token (JWT) koji server
 * provjerava kod Googlea (tokeninfo), uz provjeru `aud` (CLIENT_ID), `exp`, `iss`, `email_verified`.
 * Admin je samo token čiji je verifikovan email na listi aktivnih administratora (list Admins).
 *
 * Script Properties (Project Settings → Script properties):
 *   CLIENT_ID      (obavezno) Google OAuth Web client ID
 *   ADMIN_EMAIL_DOMAINS (opcionalno) npr. eestec-sa.ba — ako je postavljeno, administrator može biti samo email iz ovih domena
 *   ADMIN_REQUIRE_HD    (opcionalno) "true" — token mora imati `hd` claim jednak domeni admin emaila (samo Workspace računi)
 *   RESET_BINDING_EMAIL (opcionalno, jednokratno) vidi resetAdminBinding()
 *   SPREADSHEET_ID (opcionalno) ako skripta nije ugrađena u tabelu
 *   TOKEN_SALT     (opcionalno) sol za throttling ključeve; generiše se automatski
 */

var VERSION = '1.0.0';

var SCHEMA = {
  Events: ['id', 'slug', 'name', 'year', 'description', 'location', 'startDate', 'endDate', 'status', 'createdAt', 'updatedAt'],
  Agendas: ['id', 'eventId', 'title', 'date', 'position', 'createdAt'],
  AgendaItems: ['id', 'agendaId', 'startTime', 'endTime', 'title', 'description', 'speaker', 'location', 'position', 'version', 'notes', 'kind'],
  Polls: ['id', 'eventId', 'title', 'description', 'status', 'allowChange', 'resultsVisibility', 'position', 'createdAt'],
  PollOptions: ['id', 'pollId', 'name', 'description', 'allergens', 'position', 'archived'],
  Votes: ['id', 'pollId', 'optionId', 'userSub', 'userEmail', 'userName', 'createdAt', 'updatedAt'],
  FeedbackForms: ['id', 'eventId', 'title', 'description', 'mode', 'status', 'position', 'createdAt'],
  FeedbackQuestions: ['id', 'formId', 'label', 'type', 'options', 'required', 'position', 'archived'],
  FeedbackResponses: ['id', 'formId', 'submissionId', 'userSub', 'userEmail', 'userName', 'createdAt'],
  FeedbackAnswers: ['id', 'responseId', 'formId', 'questionId', 'questionLabel', 'questionType', 'questionOptions', 'value'],
  Settings: ['key', 'value'],
  Admins: ['email', 'active', 'addedAt', 'addedBy', 'sub'],
  AuditLog: ['at', 'actor', 'action', 'detail']
};
// Početni administratori. Upisuju se SAMO pri prvoj inicijalizaciji (vidi seedAdmins_), nikad ponovo.
var INITIAL_ADMINS = [
  'hr@eestec-sa.ba', 'hana.mahmutovic@eestec-sa.ba', 'chair@eestec-sa.ba', 'pr@eestec-sa.ba',
  'it@eestec-sa.ba', 'fr@eestec-sa.ba', 'cp@eestec-sa.ba', 'treasurer@eestec-sa.ba'
];
var EMAIL_RE = /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
var NUM_COLS = { year: 1, position: 1, version: 1 };
var BOOL_COLS = { allowChange: 1, required: 1, archived: 1, active: 1 };
var PUBLIC_SETTINGS = ['siteTitle', 'organization', 'contactEmail'];

var EVENT_STATUSES = ['DRAFT', 'PUBLISHED', 'COMPLETED', 'ARCHIVED'];
var TRANSITIONS = {
  DRAFT: ['PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['DRAFT', 'COMPLETED', 'ARCHIVED'],
  COMPLETED: ['PUBLISHED', 'ARCHIVED'],
  ARCHIVED: ['COMPLETED', 'DRAFT']
};
var ITEM_KINDS = ['SESSION', 'TALK', 'BREAK', 'MEAL', 'END'];
var QUESTION_TYPES = ['RATING', 'SINGLE', 'MULTI', 'SHORT', 'LONG'];
var VISIBILITY = ['ALWAYS', 'AFTER_VOTE', 'AFTER_CLOSE', 'ADMIN'];
var CONFIRM_PHRASE = 'OBRIŠI';

function newCtx_() { return { cache: {}, heads: {}, ss: null, identity: null, identityChecked: false, locked: false }; }
var ctx = newCtx_();

// ───────────────────────── greške i validacija ─────────────────────────

function ApiError(code, message) {
  this.code = code;
  this.message = message;
}
function fail_(code, message) { throw new ApiError(code, message); }

function str_(v, max, required, label) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') fail_('BAD_REQUEST', label + ' mora biti tekst.');
  v = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (required && !v) fail_('BAD_REQUEST', label + ' je obavezno polje.');
  if (v.length > max) fail_('BAD_REQUEST', label + ' je predugačko (najviše ' + max + ' znakova).');
  return v;
}
function int_(v, min, max, label) {
  var n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n || n < min || n > max) {
    fail_('BAD_REQUEST', label + ' mora biti cijeli broj od ' + min + ' do ' + max + '.');
  }
  return n;
}
function time_(v, label) {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail_('BAD_REQUEST', label + ' mora biti u formatu HH:MM.');
  return v;
}
function date_(v, label, required) {
  if (v === undefined || v === null || v === '') {
    if (required) fail_('BAD_REQUEST', label + ' je obavezno polje.');
    return '';
  }
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail_('BAD_REQUEST', label + ' mora biti datum YYYY-MM-DD.');
  var d = new Date(v + 'T00:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) fail_('BAD_REQUEST', label + ' nije valjan datum.');
  return v;
}
function enum_(v, list, label) {
  if (list.indexOf(v) < 0) fail_('BAD_REQUEST', label + ' nije valjana vrijednost.');
  return v;
}
function id_(v, label) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(v)) fail_('BAD_REQUEST', (label || 'id') + ' nije valjan.');
  return v;
}
function bool_(v, label) {
  if (typeof v !== 'boolean') fail_('BAD_REQUEST', label + ' mora biti true/false.');
  return v;
}
function has_(p, k) { return Object.prototype.hasOwnProperty.call(p, k); }
function now_() { return new Date().toISOString(); }
function day_() { return new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'; }
function slugify_(s) {
  var map = { 'č': 'c', 'ć': 'c', 'š': 's', 'ž': 'z', 'đ': 'dj', 'Č': 'c', 'Ć': 'c', 'Š': 's', 'Ž': 'z', 'Đ': 'dj' };
  var out = String(s).replace(/[čćšžđČĆŠŽĐ]/g, function (c) { return map[c]; }).toLowerCase();
  out = out.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return out || 'event';
}

// ───────────────────────── tabele (Google Sheets) ─────────────────────────

function spreadsheet_() {
  if (ctx.ss) return ctx.ss;
  var props = PropertiesService.getScriptProperties();
  var sid = props.getProperty('SPREADSHEET_ID');
  var ss = sid ? SpreadsheetApp.openById(sid) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) fail_('CONFIG', 'Skripta nije povezana s tabelom (SPREADSHEET_ID).');
  ctx.ss = ss;
  return ss;
}

function ensureSheet_(name) {
  var ss = spreadsheet_();
  var sh = ss.getSheetByName(name);
  var cols = SCHEMA[name];
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    sh.setFrozenRows(1);
  }
  var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
  var missing = cols.filter(function (c) { return have.indexOf(c) < 0; });
  if (missing.length && have.some(function (h) { return h !== ''; })) {
    sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
    ctx.heads = {};
  }
  // Sve ćelije su običan tekst: Sheets inače pretvara "09:00" i "2026-11-05" u datume, a "=x" u formule.
  sh.getRange(1, 1, sh.getMaxRows(), Math.max(sh.getLastColumn(), cols.length)).setNumberFormat('@');
  return sh;
}

function sheet_(name) {
  var sh = spreadsheet_().getSheetByName(name);
  return sh || ensureSheet_(name);
}

function head_(name) {
  if (ctx.heads[name]) return ctx.heads[name];
  var sh = sheet_(name);
  var cols = SCHEMA[name];
  var row = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), cols.length)).getValues()[0].map(String);
  var idx = {};
  cols.forEach(function (c) {
    var i = row.indexOf(c);
    if (i < 0) fail_('CONFIG', 'U listu ' + name + ' nedostaje kolona "' + c + '".');
    idx[c] = i;
  });
  ctx.heads[name] = { idx: idx, width: row.length };
  return ctx.heads[name];
}

function parseCell_(col, v) {
  if (v === null || v === undefined) v = '';
  if (v instanceof Date) v = v.toISOString().slice(0, 10);
  if (BOOL_COLS[col]) return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
  if (NUM_COLS[col]) { var n = Number(v); return isFinite(n) ? n : 0; }
  return String(v);
}
function serializeCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function read_(name) {
  if (ctx.cache[name]) return ctx.cache[name];
  var sh = sheet_(name);
  var h = head_(name);
  var last = sh.getLastRow();
  var rows = [];
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, h.width).getValues();
    for (var i = 0; i < vals.length; i++) {
      var raw = vals[i];
      var first = raw[h.idx[SCHEMA[name][0]]];
      if (first === '' || first === null || first === undefined) continue;
      var o = { _row: i + 2 };
      for (var c in h.idx) o[c] = parseCell_(c, raw[h.idx[c]]);
      rows.push(o);
    }
  }
  ctx.cache[name] = rows;
  return rows;
}

function toRow_(name, obj) {
  var h = head_(name);
  var row = [];
  for (var i = 0; i < h.width; i++) row.push('');
  for (var c in h.idx) row[h.idx[c]] = serializeCell_(obj[c]);
  return row;
}

function append_(name, objs) {
  if (!objs.length) return;
  var sh = sheet_(name);
  var h = head_(name);
  var start = Math.max(sh.getLastRow(), 1) + 1;
  var need = start + objs.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 100);
  sh.getRange(start, 1, objs.length, h.width).setValues(objs.map(function (o) { return toRow_(name, o); }));
  ctx.cache = {};
}
function save_(name, obj) {
  var sh = sheet_(name);
  var h = head_(name);
  sh.getRange(obj._row, 1, 1, h.width).setValues([toRow_(name, obj)]);
  ctx.cache = {};
}
function remove_(name, rows) {
  if (!rows.length) return;
  var sh = sheet_(name);
  rows.map(function (r) { return r._row; }).sort(function (a, b) { return b - a; }).forEach(function (n) { sh.deleteRow(n); });
  ctx.cache = {};
}
function where_(name, fn) { return read_(name).filter(fn); }
function byId_(name, id) {
  var r = read_(name);
  for (var i = 0; i < r.length; i++) if (r[i].id === id) return r[i];
  return null;
}
function must_(name, id, label) {
  var r = byId_(name, id);
  if (!r) fail_('NOT_FOUND', label + ' nije pronađen.');
  return r;
}
function sorted_(rows) { return rows.slice().sort(function (a, b) { return a.position - b.position; }); }
function nextPos_(rows) { return rows.reduce(function (m, r) { return Math.max(m, r.position + 1); }, 0); }
function uuid_() { return Utilities.getUuid(); }

// ───────────────────────── autentikacija ─────────────────────────

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }

function sha_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s);
  return bytes.map(function (b) { var x = (b < 0 ? b + 256 : b).toString(16); return x.length < 2 ? '0' + x : x; }).join('');
}

/** Vraća {sub,email,emailVerified,name,hd} ili null. Nikad ne vjeruje podacima iz zahtjeva osim potpisanog tokena. */
function verifyToken_(token) {
  if (typeof token !== 'string' || token.length < 100 || token.length > 4096 || token.split('.').length !== 3) return null;
  var clientId = prop_('CLIENT_ID');
  if (!clientId) fail_('CONFIG', 'CLIENT_ID nije postavljen u Script properties.');
  var cache = CacheService.getScriptCache();
  var key = 'tok:' + sha_(token);
  var hit = cache.get(key);
  if (hit) {
    var c = JSON.parse(hit);
    if (c.exp > Math.floor(Date.now() / 1000)) return c.id;
  }
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  var t;
  try { t = JSON.parse(res.getContentText()); } catch (e) { return null; }
  var exp = Number(t.exp);
  if (t.aud !== clientId) return null;
  if (t.iss !== 'https://accounts.google.com' && t.iss !== 'accounts.google.com') return null;
  if (!isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null;
  if (!t.sub) return null;
  var id = {
    sub: String(t.sub),
    email: String(t.email || '').toLowerCase(),
    emailVerified: t.email_verified === true || t.email_verified === 'true',
    name: String(t.name || '').slice(0, 120),
    hd: String(t.hd || '').toLowerCase()
  };
  cache.put(key, JSON.stringify({ id: id, exp: exp }), Math.max(1, Math.min(300, exp - Math.floor(Date.now() / 1000))));
  return id;
}

function identity_(p) {
  if (ctx.identityChecked) return ctx.identity;
  ctx.identityChecked = true;
  ctx.identity = p && p.idToken ? verifyToken_(p.idToken) : null;
  return ctx.identity;
}
function domainOf_(email) { return String(email).split('@')[1] || ''; }
function allowedDomains_() {
  return (prop_('ADMIN_EMAIL_DOMAINS') || '').toLowerCase().split(',').map(function (d) { return d.trim(); }).filter(Boolean);
}

/**
 * Administrator = ovjeren Google identitet (token već provjeren: aud, iss, exp) + email_verified
 * + red u listu Admins s active=true. Lista se čita pri SVAKOM zahtjevu (nema keša), pa opoziv važi odmah.
 * Ako je za red vezan Google sub (vezuje se pri prvoj prijavi), mora se poklapati: štiti od ponovne upotrebe email adrese.
 * Opcionalna ograničenja (ADMIN_EMAIL_DOMAINS, ADMIN_REQUIRE_HD) su isključena dok se ne postave.
 */
function adminRow_(id) {
  if (!id || !id.emailVerified || !id.email) return null;
  var row = where_('Admins', function (r) { return r.email.toLowerCase() === id.email; })[0];
  if (!row || !row.active) return null;
  if (row.sub && row.sub !== id.sub) { console.warn('Admin sub mismatch for a listed administrator'); return null; }
  var doms = allowedDomains_();
  if (doms.length && doms.indexOf(domainOf_(id.email)) < 0) return null;
  if (prop_('ADMIN_REQUIRE_HD') === 'true' && id.hd !== domainOf_(id.email)) return null;
  return row;
}
function isAdmin_(id) { return !!adminRow_(id); }
/** Vezanje stabilnog Google sub-a pri prvoj prijavi. Samo unutar zaključane sekcije. */
function bindSub_(row, id) {
  if (row && ctx.locked && !row.sub) { row.sub = id.sub; save_('Admins', row); }
}
function requireUser_(p) {
  var id = identity_(p);
  if (!id) fail_('UNAUTHENTICATED', 'Potrebna je prijava Google računom.');
  return id;
}
function requireAdmin_(p) {
  var id = identity_(p);
  if (!id) fail_('UNAUTHENTICATED', 'Potrebna je prijava.');
  var row = adminRow_(id);
  if (!row) fail_('FORBIDDEN', 'Nemate administratorska prava.');
  bindSub_(row, id);
  return id;
}

/** Brojač u CacheService (TTL najviše 6 h). Poziva se samo unutar zaključane sekcije. */
function throttle_(key, max, ttl) {
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get(key) || 0);
  if (n >= max) fail_('RATE_LIMITED', 'Previše zahtjeva. Pokušajte kasnije.');
  cache.put(key, String(n + 1), ttl);
}
function salt_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('TOKEN_SALT');
  if (!s) { s = uuid_(); props.setProperty('TOKEN_SALT', s); }
  return s;
}

// ───────────────────────── pravila događaja ─────────────────────────

function votingAllowed_(ev) { return ev.status === 'PUBLISHED'; }
function feedbackAllowed_(ev) { return ev.status === 'PUBLISHED' || ev.status === 'COMPLETED'; }

function changeStatus_(ev, to) {
  enum_(to, EVENT_STATUSES, 'Status');
  if (to === ev.status) return;
  if ((TRANSITIONS[ev.status] || []).indexOf(to) < 0) fail_('CONFLICT', 'Prelaz ' + ev.status + ' → ' + to + ' nije dozvoljen.');
  ev.status = to;
}

function uniqueSlug_(base, exceptId) {
  var slug = base, n = 2;
  while (where_('Events', function (e) { return e.slug === slug && e.id !== exceptId; }).length) slug = base + '-' + n++;
  return slug;
}

// ───────────────────────── javni upiti ─────────────────────────

function settings_() {
  var out = {};
  read_('Settings').forEach(function (r) { if (PUBLIC_SETTINGS.indexOf(r.key) >= 0) out[r.key] = r.value; });
  return out;
}

function me_(id) {
  return id ? { loggedIn: true, isAdmin: isAdmin_(id), name: id.name, email: id.email } : { loggedIn: false, isAdmin: false };
}

function publicEvent_(e) {
  return { id: e.id, slug: e.slug, name: e.name, year: e.year, description: e.description, location: e.location,
    startDate: e.startDate, endDate: e.endDate, status: e.status };
}

function listPublishedEvents(p) {
  var id = identity_(p);
  var evs = where_('Events', function (e) { return e.status !== 'DRAFT'; }).map(publicEvent_);
  evs.sort(function (a, b) { return (b.startDate || '').localeCompare(a.startDate || '') || b.year - a.year; });
  return { events: evs, settings: settings_(), me: me_(id), version: VERSION };
}

function whoami(p) {
  var id = identity_(p);
  bindSub_(adminRow_(id), id);
  return { me: me_(id), version: VERSION };
}

// ───────────────────────── admin: administratori ─────────────────────────

function normEmail_(v) {
  if (typeof v !== 'string') fail_('BAD_REQUEST', 'Email mora biti tekst.');
  var e = v.trim().toLowerCase();
  if (e.length > 254 || !EMAIL_RE.test(e)) fail_('BAD_REQUEST', 'Email adresa nije valjana.');
  var doms = allowedDomains_();
  if (doms.length && doms.indexOf(domainOf_(e)) < 0) fail_('BAD_REQUEST', 'Dozvoljeni su samo emailovi iz domena: ' + doms.join(', ') + '.');
  return e;
}
function activeAdmins_() { return where_('Admins', function (r) { return r.active; }); }

function listAdmins(p) {
  requireAdmin_(p);
  var rows = read_('Admins');
  return { admins: rows.map(function (r) { return { email: r.email, active: r.active, addedAt: r.addedAt, addedBy: r.addedBy, signedInBefore: !!r.sub }; }), activeCount: activeAdmins_().length };
}

function addAdmin(p) {
  var me = requireAdmin_(p);
  var email = normEmail_(p.email);
  if (where_('Admins', function (r) { return r.email.toLowerCase() === email; }).length) fail_('CONFLICT', 'Administrator s tom adresom već postoji (možda je deaktiviran: aktivirajte ga u listi).');
  append_('Admins', [{ email: email, active: true, addedAt: now_(), addedBy: me.email, sub: '' }]);
  audit_(me.email, 'admin.add', { email: email });
  return { email: email };
}

function setAdminActive(p) {
  var me = requireAdmin_(p);
  var email = normEmail_(p.email);
  var active = bool_(p.active, 'active');
  var row = where_('Admins', function (r) { return r.email.toLowerCase() === email; })[0];
  if (!row) fail_('NOT_FOUND', 'Administrator nije pronađen.');
  if (row.active === active) return { email: email, active: active };
  if (!active && activeAdmins_().length <= 1) fail_('CONFLICT', 'Ne možete deaktivirati posljednjeg aktivnog administratora.');
  row.active = active;
  save_('Admins', row);
  audit_(me.email, active ? 'admin.activate' : 'admin.deactivate', { email: email });
  return { email: email, active: active };
}

function canSeeResults_(poll, admin, myVote) {
  if (admin) return true;
  if (poll.resultsVisibility === 'ALWAYS') return true;
  if (poll.resultsVisibility === 'AFTER_VOTE') return !!myVote || poll.status === 'CLOSED';
  if (poll.resultsVisibility === 'AFTER_CLOSE') return poll.status === 'CLOSED';
  return false;
}

function getEvent(p) {
  var id = identity_(p);
  var admin = isAdmin_(id);
  var slug = str_(p.slug, 80, true, 'Link');
  var ev = where_('Events', function (e) { return e.slug === slug; })[0];
  if (!ev || (ev.status === 'DRAFT' && !admin)) fail_('NOT_FOUND', 'Događaj nije pronađen.');
  var full = admin && p.includeArchived === true;
  var agendas = sorted_(where_('Agendas', function (a) { return a.eventId === ev.id; })).map(function (a) {
    return { id: a.id, title: a.title, date: a.date, position: a.position,
      items: sorted_(where_('AgendaItems', function (i) { return i.agendaId === a.id; })).map(function (i) {
        return { id: i.id, startTime: i.startTime, endTime: i.endTime, title: i.title, description: i.description,
          speaker: i.speaker, location: i.location, notes: i.notes, kind: i.kind || 'SESSION', position: i.position, version: i.version };
      }) };
  });
  var allVotes = read_('Votes');
  var polls = sorted_(where_('Polls', function (x) { return x.eventId === ev.id; })).map(function (poll) {
    var myVote = id ? allVotes.filter(function (v) { return v.pollId === poll.id && v.userSub === id.sub; })[0] : null;
    var show = canSeeResults_(poll, admin, myVote);
    var votes = allVotes.filter(function (v) { return v.pollId === poll.id; });
    var opts = sorted_(where_('PollOptions', function (o) { return o.pollId === poll.id && (full || !o.archived); }));
    return { id: poll.id, title: poll.title, description: poll.description, status: poll.status, allowChange: poll.allowChange,
      resultsVisibility: poll.resultsVisibility, open: poll.status === 'OPEN' && votingAllowed_(ev),
      myOptionId: myVote ? myVote.optionId : null, resultsShown: show, total: show ? votes.length : null,
      options: opts.map(function (o) {
        return { id: o.id, name: o.name, description: o.description, allergens: o.allergens, archived: o.archived,
          votes: show ? votes.filter(function (v) { return v.optionId === o.id; }).length : null };
      }) };
  });
  var responses = read_('FeedbackResponses');
  var forms = sorted_(where_('FeedbackForms', function (f) { return f.eventId === ev.id; })).map(function (f) {
    var qs = sorted_(where_('FeedbackQuestions', function (q) { return q.formId === f.id && (full || !q.archived); }));
    var mine = id && f.mode === 'IDENTIFIED' && responses.some(function (r) { return r.formId === f.id && r.userSub === id.sub; });
    return { id: f.id, title: f.title, description: f.description, mode: f.mode, status: f.status,
      open: f.status === 'OPEN' && feedbackAllowed_(ev), submitted: !!mine,
      responseCount: admin ? responses.filter(function (r) { return r.formId === f.id; }).length : undefined,
      questions: qs.map(function (q) {
        return { id: q.id, label: q.label, type: q.type, options: parseJson_(q.options, []), required: q.required, archived: q.archived, position: q.position };
      }) };
  });
  return { event: publicEvent_(ev), agendas: agendas, polls: polls, forms: forms, me: me_(id) };
}

function parseJson_(s, fallback) { try { var v = JSON.parse(s); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; } }

// ───────────────────────── glasanje ─────────────────────────

function submitVote(p) {
  var id = requireUser_(p);
  throttle_('v:' + id.sub, 30, 60);
  var poll = must_('Polls', id_(p.pollId, 'Anketa'), 'Anketa');
  var ev = must_('Events', poll.eventId, 'Događaj');
  if (ev.status === 'DRAFT' && !isAdmin_(id)) fail_('NOT_FOUND', 'Anketa nije pronađena.');
  if (!votingAllowed_(ev) || poll.status !== 'OPEN') fail_('CLOSED', 'Glasanje je zatvoreno.');
  var opt = must_('PollOptions', id_(p.optionId, 'Opcija'), 'Opcija');
  if (opt.pollId !== poll.id || opt.archived) fail_('BAD_REQUEST', 'Opcija ne pripada ovoj anketi.');
  var existing = where_('Votes', function (v) { return v.pollId === poll.id && v.userSub === id.sub; });
  if (existing.length) {
    var v = existing[0];
    if (v.optionId === opt.id) return { optionId: opt.id, changed: false };
    if (!poll.allowChange) fail_('CONFLICT', 'Već ste glasali i izmjena glasa nije dozvoljena.');
    v.optionId = opt.id; v.updatedAt = now_(); v.userEmail = id.email; v.userName = id.name;
    save_('Votes', v);
    return { optionId: opt.id, changed: true };
  }
  append_('Votes', [{ id: uuid_(), pollId: poll.id, optionId: opt.id, userSub: id.sub, userEmail: id.email, userName: id.name, createdAt: now_(), updatedAt: now_() }]);
  return { optionId: opt.id, changed: true };
}

// ───────────────────────── feedback ─────────────────────────

function validateAnswer_(q, value) {
  var opts = parseJson_(q.options, []);
  if (q.type === 'RATING') {
    var n = Number(value);
    if (typeof value === 'boolean' || value === '' || !isFinite(n) || Math.floor(n) !== n || n < 1 || n > 5) fail_('BAD_REQUEST', 'Ocjena mora biti od 1 do 5.');
    return String(n);
  }
  if (q.type === 'SINGLE') {
    if (typeof value !== 'string' || opts.indexOf(value) < 0) fail_('BAD_REQUEST', 'Odabrana opcija nije ponuđena.');
    return value;
  }
  if (q.type === 'MULTI') {
    if (!Array.isArray(value) || value.length > opts.length) fail_('BAD_REQUEST', 'Odabir nije valjan.');
    var seen = {};
    value.forEach(function (v) {
      if (typeof v !== 'string' || opts.indexOf(v) < 0 || seen[v]) fail_('BAD_REQUEST', 'Odabrana opcija nije ponuđena.');
      seen[v] = 1;
    });
    return JSON.stringify(value);
  }
  return str_(value, q.type === 'SHORT' ? 200 : 2000, false, 'Odgovor');
}

function submitFeedback(p) {
  var form = must_('FeedbackForms', id_(p.formId, 'Forma'), 'Forma');
  var ev = must_('Events', form.eventId, 'Događaj');
  var admin = false;
  var id = null;
  if (form.mode === 'IDENTIFIED') { id = requireUser_(p); admin = isAdmin_(id); }
  if (ev.status === 'DRAFT' && !admin) fail_('NOT_FOUND', 'Forma nije pronađena.');
  if (p.acknowledgedMode !== form.mode) fail_('MODE_CHANGED', 'Način prikupljanja odgovora se promijenio. Osvježite stranicu.');
  if (typeof p.hp === 'string' && p.hp !== '') return { submitted: true }; // honeypot: tiho odbaci
  if (!feedbackAllowed_(ev) || form.status !== 'OPEN') fail_('CLOSED', 'Prikupljanje odgovora je zatvoreno.');
  var submissionId = id_(p.submissionId, 'submissionId');
  if (where_('FeedbackResponses', function (r) { return r.submissionId === submissionId; }).length) return { submitted: true, duplicate: true };
  if (form.mode === 'IDENTIFIED') {
    throttle_('f:' + id.sub, 20, 3600);
    if (where_('FeedbackResponses', function (r) { return r.formId === form.id && r.userSub === id.sub; }).length) {
      fail_('CONFLICT', 'Već ste poslali odgovor na ovu formu.');
    }
  } else {
    // Anonimno: ništa vezano za osobu se ne upisuje u tabelu. Zaštita od zloupotrebe je samo u privremenom kešu (do 6 h).
    var device = typeof p.device === 'string' ? p.device.slice(0, 64) : '';
    if (device) throttle_('a:' + form.id + ':' + sha_(salt_() + device), 5, 21600);
    throttle_('ag:' + form.id + ':' + Math.floor(Date.now() / 600000), 120, 900);
  }
  if (!Array.isArray(p.answers) || p.answers.length > 100) fail_('BAD_REQUEST', 'Odgovori nisu valjani.');
  var qs = where_('FeedbackQuestions', function (q) { return q.formId === form.id && !q.archived; });
  var byQ = {};
  qs.forEach(function (q) { byQ[q.id] = q; });
  var seen = {}, given = {};
  p.answers.forEach(function (a) {
    if (!a || typeof a !== 'object') fail_('BAD_REQUEST', 'Odgovori nisu valjani.');
    var q = byQ[a.questionId];
    if (!q) fail_('BAD_REQUEST', 'Nepoznato pitanje.');
    if (seen[q.id]) fail_('BAD_REQUEST', 'Dupli odgovor na isto pitanje.');
    seen[q.id] = 1;
    var empty = a.value === '' || a.value === null || a.value === undefined || (Array.isArray(a.value) && a.value.length === 0);
    if (!empty) given[q.id] = validateAnswer_(q, a.value);
  });
  qs.forEach(function (q) { if (q.required && given[q.id] === undefined) fail_('BAD_REQUEST', 'Odgovor je obavezan: ' + q.label); });
  var rid = uuid_();
  append_('FeedbackResponses', [{ id: rid, formId: form.id, submissionId: submissionId,
    userSub: id ? id.sub : '', userEmail: id ? id.email : '', userName: id ? id.name : '',
    createdAt: id ? now_() : day_() }]);
  append_('FeedbackAnswers', Object.keys(given).map(function (qid) {
    var q = byQ[qid];
    return { id: uuid_(), responseId: rid, formId: form.id, questionId: qid, questionLabel: q.label, questionType: q.type, questionOptions: q.options, value: given[qid] };
  }));
  return { submitted: true };
}

// ───────────────────────── admin: događaji ─────────────────────────

function eventSpec_() {
  return {
    name: function (v) { return str_(v, 120, true, 'Naziv'); },
    year: function (v) { return int_(v, 2000, 2100, 'Godina'); },
    description: function (v) { return str_(v, 2000, false, 'Opis'); },
    location: function (v) { return str_(v, 200, false, 'Lokacija'); },
    startDate: function (v) { return date_(v, 'Datum početka', false); },
    endDate: function (v) { return date_(v, 'Datum kraja', false); }
  };
}

function listAllEvents(p) {
  requireAdmin_(p);
  var evs = read_('Events').map(function (e) {
    var o = publicEvent_(e);
    o.agendas = where_('Agendas', function (a) { return a.eventId === e.id; }).length;
    o.polls = where_('Polls', function (a) { return a.eventId === e.id; }).length;
    o.forms = where_('FeedbackForms', function (a) { return a.eventId === e.id; }).length;
    return o;
  });
  evs.sort(function (a, b) { return b.year - a.year || (b.startDate || '').localeCompare(a.startDate || ''); });
  return { events: evs, settings: settings_(), me: me_(identity_(p)), version: VERSION };
}

function createEvent(p) {
  requireAdmin_(p);
  var ev = { id: uuid_(), status: 'DRAFT', createdAt: now_(), updatedAt: now_() };
  var spec = eventSpec_();
  for (var k in spec) ev[k] = spec[k](p[k]);
  var base = has_(p, 'slug') && p.slug ? slugify_(str_(p.slug, 80, true, 'Link')) : slugify_(ev.name + (ev.name.indexOf(String(ev.year)) >= 0 ? '' : '-' + ev.year));
  ev.slug = uniqueSlug_(base, null);
  if (ev.startDate && ev.endDate && ev.endDate < ev.startDate) fail_('BAD_REQUEST', 'Datum kraja je prije datuma početka.');
  append_('Events', [ev]);
  return { event: publicEvent_(ev) };
}

function updateEvent(p) {
  requireAdmin_(p);
  var ev = must_('Events', id_(p.id, 'Događaj'), 'Događaj');
  var spec = eventSpec_();
  for (var k in spec) if (has_(p, k)) ev[k] = spec[k](p[k]);
  if (has_(p, 'slug')) ev.slug = uniqueSlug_(slugify_(str_(p.slug, 80, true, 'Link')), ev.id);
  if (has_(p, 'status')) changeStatus_(ev, p.status);
  if (ev.startDate && ev.endDate && ev.endDate < ev.startDate) fail_('BAD_REQUEST', 'Datum kraja je prije datuma početka.');
  ev.updatedAt = now_();
  save_('Events', ev);
  return { event: publicEvent_(ev) };
}

function cascadeDeletePoll_(pollId) {
  remove_('Votes', where_('Votes', function (v) { return v.pollId === pollId; }));
  remove_('PollOptions', where_('PollOptions', function (o) { return o.pollId === pollId; }));
  remove_('Polls', where_('Polls', function (x) { return x.id === pollId; }));
}
function cascadeDeleteForm_(formId) {
  remove_('FeedbackAnswers', where_('FeedbackAnswers', function (a) { return a.formId === formId; }));
  remove_('FeedbackResponses', where_('FeedbackResponses', function (r) { return r.formId === formId; }));
  remove_('FeedbackQuestions', where_('FeedbackQuestions', function (q) { return q.formId === formId; }));
  remove_('FeedbackForms', where_('FeedbackForms', function (f) { return f.id === formId; }));
}
function cascadeDeleteAgenda_(agendaId) {
  remove_('AgendaItems', where_('AgendaItems', function (i) { return i.agendaId === agendaId; }));
  remove_('Agendas', where_('Agendas', function (a) { return a.id === agendaId; }));
}

/** Podrazumijevano arhivira. Trajno brisanje (hard=true) samo iz Nacrta/Arhive uz tačan naziv. */
function deleteOrArchiveEvent(p) {
  requireAdmin_(p);
  var ev = must_('Events', id_(p.id, 'Događaj'), 'Događaj');
  if (p.hard !== true) {
    changeStatus_(ev, 'ARCHIVED');
    ev.updatedAt = now_();
    save_('Events', ev);
    return { archived: true };
  }
  if (ev.status !== 'DRAFT' && ev.status !== 'ARCHIVED') fail_('CONFLICT', 'Trajno se mogu brisati samo događaji u Nacrtu ili Arhivi.');
  if (p.confirmName !== ev.name) fail_('BAD_REQUEST', 'Upišite tačan naziv događaja za potvrdu.');
  where_('Polls', function (x) { return x.eventId === ev.id; }).forEach(function (x) { cascadeDeletePoll_(x.id); });
  where_('FeedbackForms', function (x) { return x.eventId === ev.id; }).forEach(function (x) { cascadeDeleteForm_(x.id); });
  where_('Agendas', function (x) { return x.eventId === ev.id; }).forEach(function (x) { cascadeDeleteAgenda_(x.id); });
  remove_('Events', where_('Events', function (x) { return x.id === ev.id; }));
  return { deleted: true };
}

// ───────────────────────── admin: agenda ─────────────────────────

function reorder_(name, siblings, ids) {
  if (!Array.isArray(ids) || ids.length !== siblings.length) fail_('BAD_REQUEST', 'Redoslijed nije potpun.');
  var map = {};
  siblings.forEach(function (s) { map[s.id] = s; });
  var seen = {};
  ids.forEach(function (i) { if (!map[i] || seen[i]) fail_('BAD_REQUEST', 'Redoslijed nije valjan.'); seen[i] = 1; });
  ids.forEach(function (i, n) { if (map[i].position !== n) { map[i].position = n; save_(name, map[i]); } });
}

function manageAgenda(p) {
  requireAdmin_(p);
  var op = enum_(p.op, ['create', 'update', 'delete', 'reorder'], 'Operacija');
  if (op === 'create') {
    var ev = must_('Events', id_(p.eventId, 'Događaj'), 'Događaj');
    var a = { id: uuid_(), eventId: ev.id, title: str_(p.title, 120, true, 'Naslov'), date: date_(p.date, 'Datum', false),
      position: nextPos_(where_('Agendas', function (x) { return x.eventId === ev.id; })), createdAt: now_() };
    append_('Agendas', [a]);
    return { id: a.id };
  }
  if (op === 'reorder') {
    var evId = id_(p.eventId, 'Događaj');
    reorder_('Agendas', where_('Agendas', function (x) { return x.eventId === evId; }), p.ids);
    return {};
  }
  var ag = must_('Agendas', id_(p.id, 'Agenda'), 'Agenda');
  if (op === 'update') {
    if (has_(p, 'title')) ag.title = str_(p.title, 120, true, 'Naslov');
    if (has_(p, 'date')) ag.date = date_(p.date, 'Datum', false);
    save_('Agendas', ag);
    return {};
  }
  cascadeDeleteAgenda_(ag.id);
  return {};
}

function itemFields_(p, base, partial) {
  var o = base;
  function f(k, fn) { if (!partial || has_(p, k)) o[k] = fn(p[k]); }
  f('startTime', function (v) { return time_(v, 'Početak'); });
  f('endTime', function (v) { return time_(v, 'Kraj'); });
  f('title', function (v) { return str_(v, 160, true, 'Naslov'); });
  f('description', function (v) { return str_(v, 1000, false, 'Opis'); });
  f('speaker', function (v) { return str_(v, 120, false, 'Govornik'); });
  f('location', function (v) { return str_(v, 120, false, 'Lokacija'); });
  f('notes', function (v) { return str_(v, 300, false, 'Napomena'); });
  f('kind', function (v) { return v === undefined || v === '' ? 'SESSION' : enum_(v, ITEM_KINDS, 'Vrsta stavke'); });
  if (o.kind === 'END' ? o.endTime < o.startTime : o.endTime <= o.startTime) fail_('BAD_REQUEST', 'Kraj mora biti poslije početka.');
  return o;
}

function manageAgendaItems(p) {
  requireAdmin_(p);
  var op = enum_(p.op, ['create', 'update', 'delete', 'reorder'], 'Operacija');
  if (op === 'create') {
    var ag = must_('Agendas', id_(p.agendaId, 'Agenda'), 'Agenda');
    var it = itemFields_(p, { id: uuid_(), agendaId: ag.id, position: nextPos_(where_('AgendaItems', function (x) { return x.agendaId === ag.id; })), version: 1 }, false);
    append_('AgendaItems', [it]);
    return { id: it.id, version: 1 };
  }
  if (op === 'reorder') {
    var aid = id_(p.agendaId, 'Agenda');
    reorder_('AgendaItems', where_('AgendaItems', function (x) { return x.agendaId === aid; }), p.ids);
    return {};
  }
  var cur = must_('AgendaItems', id_(p.id, 'Stavka'), 'Stavka');
  if (op === 'delete') { remove_('AgendaItems', [cur]); return {}; }
  if (p.version !== cur.version) fail_('CONFLICT', 'Stavka je u međuvremenu izmijenjena. Osvježite prikaz.');
  itemFields_(p, cur, true);
  cur.version += 1;
  save_('AgendaItems', cur);
  return { version: cur.version };
}

// ───────────────────────── admin: ankete ─────────────────────────

function requireConfirm_(p) {
  if (p.confirm !== CONFIRM_PHRASE) fail_('BAD_REQUEST', 'Za ovu radnju upišite ' + CONFIRM_PHRASE + '.');
}

function managePoll(p) {
  requireAdmin_(p);
  var op = enum_(p.op, ['create', 'update', 'delete', 'resetVotes', 'addOption', 'updateOption', 'removeOption', 'restoreOption', 'reorderOptions'], 'Operacija');
  if (op === 'create') {
    var ev = must_('Events', id_(p.eventId, 'Događaj'), 'Događaj');
    var poll = { id: uuid_(), eventId: ev.id, title: str_(p.title, 160, true, 'Naslov'), description: str_(p.description, 1000, false, 'Opis'),
      status: 'OPEN', allowChange: has_(p, 'allowChange') ? bool_(p.allowChange, 'Izmjena glasa') : true,
      resultsVisibility: has_(p, 'resultsVisibility') ? enum_(p.resultsVisibility, VISIBILITY, 'Vidljivost rezultata') : 'AFTER_VOTE',
      position: nextPos_(where_('Polls', function (x) { return x.eventId === ev.id; })), createdAt: now_() };
    append_('Polls', [poll]);
    return { id: poll.id };
  }
  if (op === 'addOption') {
    var pl = must_('Polls', id_(p.pollId, 'Anketa'), 'Anketa');
    var o = { id: uuid_(), pollId: pl.id, name: str_(p.name, 120, true, 'Naziv'), description: str_(p.description, 300, false, 'Opis'),
      allergens: str_(p.allergens, 200, false, 'Alergeni'), position: nextPos_(where_('PollOptions', function (x) { return x.pollId === pl.id; })), archived: false };
    append_('PollOptions', [o]);
    return { id: o.id };
  }
  if (op === 'reorderOptions') {
    var pid = id_(p.pollId, 'Anketa');
    reorder_('PollOptions', where_('PollOptions', function (x) { return x.pollId === pid && !x.archived; }), p.ids);
    return {};
  }
  if (op === 'updateOption' || op === 'removeOption' || op === 'restoreOption') {
    var opt = must_('PollOptions', id_(p.id, 'Opcija'), 'Opcija');
    if (op === 'updateOption') {
      if (has_(p, 'name')) opt.name = str_(p.name, 120, true, 'Naziv');
      if (has_(p, 'description')) opt.description = str_(p.description, 300, false, 'Opis');
      if (has_(p, 'allergens')) opt.allergens = str_(p.allergens, 200, false, 'Alergeni');
      save_('PollOptions', opt);
      return {};
    }
    if (op === 'restoreOption') { opt.archived = false; save_('PollOptions', opt); return {}; }
    if (where_('Votes', function (v) { return v.optionId === opt.id; }).length) {
      opt.archived = true; save_('PollOptions', opt);
      return { archived: true };
    }
    remove_('PollOptions', [opt]);
    return { deleted: true };
  }
  var pol = must_('Polls', id_(p.id, 'Anketa'), 'Anketa');
  if (op === 'update') {
    if (has_(p, 'title')) pol.title = str_(p.title, 160, true, 'Naslov');
    if (has_(p, 'description')) pol.description = str_(p.description, 1000, false, 'Opis');
    if (has_(p, 'status')) pol.status = enum_(p.status, ['OPEN', 'CLOSED'], 'Status');
    if (has_(p, 'allowChange')) pol.allowChange = bool_(p.allowChange, 'Izmjena glasa');
    if (has_(p, 'resultsVisibility')) pol.resultsVisibility = enum_(p.resultsVisibility, VISIBILITY, 'Vidljivost rezultata');
    save_('Polls', pol);
    return {};
  }
  var hasVotes = where_('Votes', function (v) { return v.pollId === pol.id; }).length > 0;
  if (op === 'resetVotes') {
    requireConfirm_(p);
    remove_('Votes', where_('Votes', function (v) { return v.pollId === pol.id; }));
    return {};
  }
  if (hasVotes) requireConfirm_(p);
  cascadeDeletePoll_(pol.id);
  return {};
}

// ───────────────────────── admin: feedback forme ─────────────────────────

function questionFields_(p, q, partial) {
  function f(k, fn) { if (!partial || has_(p, k)) q[k] = fn(p[k]); }
  f('label', function (v) { return str_(v, 300, true, 'Pitanje'); });
  f('type', function (v) { return enum_(v, QUESTION_TYPES, 'Tip pitanja'); });
  f('required', function (v) { return v === undefined ? false : bool_(v, 'Obavezno'); });
  var type = q.type;
  if (type === 'SINGLE' || type === 'MULTI') {
    var raw = has_(p, 'options') ? p.options : (typeof q.options === 'string' ? parseJson_(q.options, []) : q.options);
    if (!Array.isArray(raw)) fail_('BAD_REQUEST', 'Opcije moraju biti lista.');
    var opts = raw.map(function (o) { return str_(o, 120, true, 'Opcija'); });
    var uniq = {};
    opts.forEach(function (o) { if (uniq[o]) fail_('BAD_REQUEST', 'Opcije moraju biti različite.'); uniq[o] = 1; });
    if (opts.length < 2 || opts.length > 20) fail_('BAD_REQUEST', 'Potrebno je 2 do 20 opcija.');
    q.options = JSON.stringify(opts);
  } else {
    q.options = '[]';
  }
  return q;
}

function manageFeedbackForm(p) {
  requireAdmin_(p);
  var op = enum_(p.op, ['create', 'update', 'delete', 'deleteResponses', 'addQuestion', 'updateQuestion', 'removeQuestion', 'restoreQuestion', 'reorderQuestions'], 'Operacija');
  if (op === 'create') {
    var ev = must_('Events', id_(p.eventId, 'Događaj'), 'Događaj');
    var f = { id: uuid_(), eventId: ev.id, title: str_(p.title, 160, true, 'Naslov'), description: str_(p.description, 1000, false, 'Opis'),
      mode: has_(p, 'mode') ? enum_(p.mode, ['ANONYMOUS', 'IDENTIFIED'], 'Način') : 'ANONYMOUS', status: 'OPEN',
      position: nextPos_(where_('FeedbackForms', function (x) { return x.eventId === ev.id; })), createdAt: now_() };
    append_('FeedbackForms', [f]);
    return { id: f.id };
  }
  if (op === 'addQuestion') {
    var fm = must_('FeedbackForms', id_(p.formId, 'Forma'), 'Forma');
    var q = questionFields_(p, { id: uuid_(), formId: fm.id, position: nextPos_(where_('FeedbackQuestions', function (x) { return x.formId === fm.id; })), archived: false }, false);
    append_('FeedbackQuestions', [q]);
    return { id: q.id };
  }
  if (op === 'reorderQuestions') {
    var fid = id_(p.formId, 'Forma');
    reorder_('FeedbackQuestions', where_('FeedbackQuestions', function (x) { return x.formId === fid && !x.archived; }), p.ids);
    return {};
  }
  if (op === 'updateQuestion' || op === 'removeQuestion' || op === 'restoreQuestion') {
    var qq = must_('FeedbackQuestions', id_(p.id, 'Pitanje'), 'Pitanje');
    if (op === 'updateQuestion') { questionFields_(p, qq, true); save_('FeedbackQuestions', qq); return {}; }
    if (op === 'restoreQuestion') { qq.archived = false; save_('FeedbackQuestions', qq); return {}; }
    if (where_('FeedbackAnswers', function (a) { return a.questionId === qq.id; }).length) {
      qq.archived = true; save_('FeedbackQuestions', qq);
      return { archived: true };
    }
    remove_('FeedbackQuestions', [qq]);
    return { deleted: true };
  }
  var form = must_('FeedbackForms', id_(p.id || p.formId, 'Forma'), 'Forma');
  var count = where_('FeedbackResponses', function (r) { return r.formId === form.id; }).length;
  if (op === 'update') {
    if (has_(p, 'title')) form.title = str_(p.title, 160, true, 'Naslov');
    if (has_(p, 'description')) form.description = str_(p.description, 1000, false, 'Opis');
    if (has_(p, 'status')) form.status = enum_(p.status, ['OPEN', 'CLOSED'], 'Status');
    if (has_(p, 'mode')) {
      enum_(p.mode, ['ANONYMOUS', 'IDENTIFIED'], 'Način');
      if (p.mode !== form.mode && count > 0) fail_('CONFLICT', 'Način se ne može mijenjati nakon što postoje odgovori.');
      form.mode = p.mode;
    }
    save_('FeedbackForms', form);
    return {};
  }
  if (op === 'deleteResponses') {
    requireConfirm_(p);
    remove_('FeedbackAnswers', where_('FeedbackAnswers', function (a) { return a.formId === form.id; }));
    remove_('FeedbackResponses', where_('FeedbackResponses', function (r) { return r.formId === form.id; }));
    return {};
  }
  if (count > 0) requireConfirm_(p);
  cascadeDeleteForm_(form.id);
  return {};
}

// ───────────────────────── admin: statistika i izvoz ─────────────────────────

function questionStats_(q, answers) {
  var s = { questionId: q.id, label: q.label, type: q.type, archived: !!q.archived, count: answers.length };
  if (q.type === 'RATING') {
    var dist = [0, 0, 0, 0, 0], sum = 0;
    answers.forEach(function (a) { var n = Number(a.value); dist[n - 1]++; sum += n; });
    s.average = answers.length ? Math.round(sum / answers.length * 100) / 100 : null;
    s.distribution = dist;
  } else if (q.type === 'SINGLE' || q.type === 'MULTI') {
    var counts = {};
    parseJson_(q.options, []).forEach(function (o) { counts[o] = 0; });
    answers.forEach(function (a) {
      var vals = q.type === 'MULTI' ? parseJson_(a.value, []) : [a.value];
      vals.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
    });
    s.counts = counts;
  } else {
    s.texts = answers.map(function (a) { return a.value; }).slice(0, 300);
  }
  return s;
}

function getAdminStatistics(p) {
  requireAdmin_(p);
  var ev = must_('Events', id_(p.eventId, 'Događaj'), 'Događaj');
  var votes = read_('Votes'), answers = read_('FeedbackAnswers'), responses = read_('FeedbackResponses');
  var polls = sorted_(where_('Polls', function (x) { return x.eventId === ev.id; })).map(function (poll) {
    var vs = votes.filter(function (v) { return v.pollId === poll.id; });
    var opts = sorted_(where_('PollOptions', function (o) { return o.pollId === poll.id; }));
    return { id: poll.id, title: poll.title, status: poll.status, total: vs.length,
      options: opts.map(function (o) {
        var ov = vs.filter(function (v) { return v.optionId === o.id; });
        return { id: o.id, name: o.name, archived: o.archived, votes: ov.length,
          voters: ov.map(function (v) { return { name: v.userName, email: v.userEmail, at: v.updatedAt || v.createdAt }; }) };
      }) };
  });
  var forms = sorted_(where_('FeedbackForms', function (x) { return x.eventId === ev.id; })).map(function (f) {
    var rs = responses.filter(function (r) { return r.formId === f.id; });
    var as = answers.filter(function (a) { return a.formId === f.id; });
    var qs = sorted_(where_('FeedbackQuestions', function (q) { return q.formId === f.id; }));
    var stats = qs.map(function (q) { return questionStats_(q, as.filter(function (a) { return a.questionId === q.id; })); });
    var list = rs.map(function (r) {
      return { id: r.id, at: r.createdAt, name: r.userName, email: r.userEmail,
        answers: as.filter(function (a) { return a.responseId === r.id; }).map(function (a) {
          return { label: a.questionLabel, type: a.questionType, value: a.questionType === 'MULTI' ? parseJson_(a.value, []) : a.value };
        }) };
    });
    return { id: f.id, title: f.title, mode: f.mode, status: f.status, responseCount: rs.length, stats: stats,
      responses: f.mode === 'IDENTIFIED' ? list : list.map(function (r) { return { id: r.id, at: r.at, answers: r.answers }; }) };
  });
  return { event: publicEvent_(ev), polls: polls, forms: forms };
}

function csvCell_(v) {
  var s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csv_(rows) { return '﻿' + rows.map(function (r) { return r.map(csvCell_).join(','); }).join('\r\n') + '\r\n'; }

function exportResults(p) {
  requireAdmin_(p);
  var kind = enum_(p.kind, ['poll', 'feedback'], 'Vrsta');
  if (kind === 'poll') {
    var poll = must_('Polls', id_(p.id, 'Anketa'), 'Anketa');
    var opts = {};
    where_('PollOptions', function (o) { return o.pollId === poll.id; }).forEach(function (o) { opts[o.id] = o.name; });
    var rows = [['Anketa', 'Opcija', 'Ime', 'Email', 'Vrijeme']];
    where_('Votes', function (v) { return v.pollId === poll.id; }).forEach(function (v) {
      rows.push([poll.title, opts[v.optionId] || '(nepoznata opcija)', v.userName, v.userEmail, v.updatedAt || v.createdAt]);
    });
    return { filename: slugify_(poll.title) + '-glasovi.csv', csv: csv_(rows) };
  }
  var form = must_('FeedbackForms', id_(p.id, 'Forma'), 'Forma');
  var qs = sorted_(where_('FeedbackQuestions', function (q) { return q.formId === form.id; }));
  var as = where_('FeedbackAnswers', function (a) { return a.formId === form.id; });
  var labels = {};
  qs.forEach(function (q) { labels[q.id] = q.label + (q.archived ? ' (arhivirano)' : ''); });
  as.forEach(function (a) { if (!labels[a.questionId]) labels[a.questionId] = a.questionLabel + ' (obrisano)'; });
  var order = qs.map(function (q) { return q.id; });
  Object.keys(labels).forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });
  var identified = form.mode === 'IDENTIFIED';
  var head = ['Vrijeme'].concat(identified ? ['Ime', 'Email'] : []).concat(order.map(function (k) { return labels[k]; }));
  var out = [head];
  where_('FeedbackResponses', function (r) { return r.formId === form.id; }).forEach(function (r) {
    var mine = {};
    as.filter(function (a) { return a.responseId === r.id; }).forEach(function (a) {
      mine[a.questionId] = a.questionType === 'MULTI' ? parseJson_(a.value, []).join('; ') : a.value;
    });
    out.push([r.createdAt].concat(identified ? [r.userName, r.userEmail] : []).concat(order.map(function (k) { return mine[k] === undefined ? '' : mine[k]; })));
  });
  return { filename: slugify_(form.title) + '-odgovori.csv', csv: csv_(out) };
}

// ───────────────────────── uvoz postojećih podataka ─────────────────────────

/** Admin-only: upisuje redove iz izvoza (npr. HOBOM iz stare baze). Preskače redove čiji id već postoji. */
function importSeed(p) {
  requireAdmin_(p);
  var data = p.data;
  if (!data || typeof data !== 'object') fail_('BAD_REQUEST', 'Nedostaju podaci.');
  var report = {};
  Object.keys(SCHEMA).forEach(function (name) {
    var rows = data[name];
    if (!Array.isArray(rows) || name === 'Settings' || name === 'Admins' || name === 'AuditLog') return;
    if (rows.length > 2000) fail_('BAD_REQUEST', 'Previše redova u ' + name + '.');
    var have = {};
    read_(name).forEach(function (r) { have[r.id] = 1; });
    var add = rows.filter(function (r) { return r && typeof r.id === 'string' && !have[r.id]; }).map(function (r) {
      id_(r.id, name + '.id');
      Object.keys(r).forEach(function (k) { if (/Id$/.test(k) && r[k] !== '' && r[k] !== null && r[k] !== undefined) id_(r[k], name + '.' + k); });
      var o = {};
      SCHEMA[name].forEach(function (c) { o[c] = r[c]; });
      return o;
    });
    append_(name, add);
    report[name] = { added: add.length, skipped: rows.length - add.length };
  });
  return { report: report };
}

// ───────────────────────── čuvanje podataka, zahtjevi za brisanje, revizija ─────────────────────────

var RETENTION_MONTHS = 24;
var ANON_PREFIX = 'anonymized:';
var CONFIRM_ANON = 'ANONIMIZIRAJ';

/** Dnevnik revizije (list AuditLog): samo dodavanje redova. Ne sadrži emailove osoba čiji se podaci brišu (samo hash). */
function audit_(actor, action, detail) {
  append_('AuditLog', [{ at: now_(), actor: actor || '', action: action, detail: JSON.stringify(detail || {}) }]);
}

function listAudit(p) {
  requireAdmin_(p);
  var rows = read_('AuditLog');
  return { entries: rows.slice(-100).reverse().map(function (r) { return { at: r.at, actor: r.actor, action: r.action, detail: parseJson_(r.detail, {}) }; }), total: rows.length };
}

function retentionCutoff_() {
  var d = new Date();
  d.setUTCMonth(d.getUTCMonth() - RETENTION_MONTHS);
  return d.toISOString();
}
function votePersonal_(v) {
  if (v.userEmail || v.userName && v.userName !== 'Anonimni (stari glas)') return true;
  return !!v.userSub && v.userSub.indexOf(ANON_PREFIX) !== 0 && v.userSub.indexOf('legacy:') !== 0;
}
function responsePersonal_(r) { return !!(r.userSub || r.userEmail || r.userName); }

/** Redovi sa ličnim podacima starije od roka čuvanja. Rok računa SERVER (klijent ga ne može skratiti). */
function retentionScan_() {
  var cut = retentionCutoff_();
  var votes = where_('Votes', function (v) { return votePersonal_(v) && (v.updatedAt || v.createdAt) < cut; });
  var resps = where_('FeedbackResponses', function (r) { return responsePersonal_(r) && r.createdAt < cut; });
  return { cut: cut, votes: votes, responses: resps };
}
function anonymizeVote_(v) { v.userSub = ANON_PREFIX + uuid_(); v.userEmail = ''; v.userName = ''; save_('Votes', v); }
function anonymizeResponse_(r) { r.userSub = ''; r.userEmail = ''; r.userName = ''; r.createdAt = String(r.createdAt).slice(0, 10) + 'T00:00:00.000Z'; save_('FeedbackResponses', r); }

/** Pregled bez ikakve izmjene: koliko redova je starije od roka čuvanja. */
function previewRetention(p) {
  requireAdmin_(p);
  var s = retentionScan_();
  var oldest = s.votes.map(function (v) { return v.updatedAt || v.createdAt; }).concat(s.responses.map(function (r) { return r.createdAt; })).sort()[0] || null;
  return { months: RETENTION_MONTHS, cutoff: s.cut, votes: s.votes.length, responses: s.responses.length, oldest: oldest,
    inactiveAdmins: where_('Admins', function (r) { return !r.active; }).length };
}

/**
 * Uklanja identitet (anonimizacija) iz zapisa starijih od roka. NIKAD se ne pokreće samo: traži admina, tačan broj iz pregleda i frazu.
 * Zbirni rezultati ostaju; brišu se samo ime, email i Google ID. Slobodan tekst odgovora se ne mijenja (može sadržavati lične podatke: vidi zahtjev za brisanje).
 */
function applyRetention(p) {
  var me = requireAdmin_(p);
  if (p.confirm !== CONFIRM_ANON) fail_('BAD_REQUEST', 'Za potvrdu upišite ' + CONFIRM_ANON + '.');
  var s = retentionScan_();
  if (p.expectedVotes !== s.votes.length || p.expectedResponses !== s.responses.length) fail_('CONFLICT', 'Stanje se promijenilo od pregleda. Ponovite pregled.');
  if (!s.votes.length && !s.responses.length) fail_('CONFLICT', 'Nema zapisa starijih od roka čuvanja.');
  s.votes.forEach(anonymizeVote_);
  s.responses.forEach(anonymizeResponse_);
  audit_(me.email, 'retention.anonymize', { months: RETENTION_MONTHS, cutoff: s.cut, votes: s.votes.length, responses: s.responses.length });
  return { votes: s.votes.length, responses: s.responses.length, cutoff: s.cut };
}

function userRows_(email) {
  var votes = where_('Votes', function (v) { return v.userEmail.toLowerCase() === email; });
  var subs = {};
  votes.forEach(function (v) { subs[v.userSub] = 1; });
  var resps = where_('FeedbackResponses', function (r) { return r.userEmail.toLowerCase() === email; });
  resps.forEach(function (r) { subs[r.userSub] = 1; });
  // isti Google račun može imati drugi email u starijim zapisima: poveži po sub-u
  votes = where_('Votes', function (v) { return subs[v.userSub] === 1 && v.userSub.indexOf(ANON_PREFIX) !== 0 && v.userSub.indexOf('legacy:') !== 0; });
  resps = where_('FeedbackResponses', function (r) { return r.userSub && subs[r.userSub] === 1; });
  return { votes: votes, responses: resps };
}

/** Pregled podataka jedne osobe (za zahtjev za pristup/brisanje): samo brojevi, bez sadržaja. */
function previewUserData(p) {
  requireAdmin_(p);
  var email = normEmail_(p.email);
  var u = userRows_(email);
  return { votes: u.votes.length, responses: u.responses.length,
    answers: where_('FeedbackAnswers', function (a) { return u.responses.some(function (r) { return r.id === a.responseId; }); }).length,
    isAdmin: where_('Admins', function (r) { return r.email.toLowerCase() === email; }).length > 0 };
}

/**
 * Obrada ODOBRENOG zahtjeva za brisanje. ANONYMIZE: uklanja identitet, zadržava zbirne rezultate i odgovore.
 * DELETE: briše glasove i identificirane odgovore te osobe zajedno s odgovorima (potrebno kad slobodan tekst može sadržavati lične podatke).
 * Lista Admins se ne dira (deaktivirajte administratora u aplikaciji, pa obrišite red ručno ako je potrebno).
 * U dnevnik ide samo hash osobe i broj zapisa, nikad email.
 */
function eraseUserData(p) {
  var me = requireAdmin_(p);
  var email = normEmail_(p.email);
  var mode = enum_(p.mode, ['ANONYMIZE', 'DELETE'], 'Način');
  var ref = str_(p.requestRef, 100, true, 'Oznaka zahtjeva');
  if (p.confirm !== CONFIRM_PHRASE) fail_('BAD_REQUEST', 'Za potvrdu upišite ' + CONFIRM_PHRASE + '.');
  var u = userRows_(email);
  if (p.expectedVotes !== u.votes.length || p.expectedResponses !== u.responses.length) fail_('CONFLICT', 'Stanje se promijenilo od pregleda. Ponovite pregled.');
  if (!u.votes.length && !u.responses.length) fail_('NOT_FOUND', 'Nema zapisa za tu adresu.');
  var answers = 0;
  if (mode === 'ANONYMIZE') {
    u.votes.forEach(anonymizeVote_);
    u.responses.forEach(anonymizeResponse_);
  } else {
    var ids = {};
    u.responses.forEach(function (r) { ids[r.id] = 1; });
    var ans = where_('FeedbackAnswers', function (a) { return ids[a.responseId] === 1; });
    answers = ans.length;
    remove_('FeedbackAnswers', ans);
    remove_('FeedbackResponses', where_('FeedbackResponses', function (r) { return ids[r.id] === 1; }));
    var vids = {};
    u.votes.forEach(function (v) { vids[v.id] = 1; });
    remove_('Votes', where_('Votes', function (v) { return vids[v.id] === 1; }));
  }
  audit_(me.email, 'erasure.' + mode.toLowerCase(), { subject: sha_(salt_() + email).slice(0, 16), requestRef: ref, votes: u.votes.length, responses: u.responses.length, answers: answers });
  return { votes: u.votes.length, responses: u.responses.length, mode: mode };
}

// ───────────────────────── web app ulazne tačke ─────────────────────────

var ACTIONS = {
  listPublishedEvents: { fn: listPublishedEvents, write: false },
  getEvent: { fn: getEvent, write: false },
  whoami: { fn: whoami, write: true },
  listAdmins: { fn: listAdmins, write: false },
  addAdmin: { fn: addAdmin, write: true },
  setAdminActive: { fn: setAdminActive, write: true },
  submitVote: { fn: submitVote, write: true },
  submitFeedback: { fn: submitFeedback, write: true },
  listAllEvents: { fn: listAllEvents, write: false },
  createEvent: { fn: createEvent, write: true },
  updateEvent: { fn: updateEvent, write: true },
  deleteOrArchiveEvent: { fn: deleteOrArchiveEvent, write: true },
  manageAgenda: { fn: manageAgenda, write: true },
  manageAgendaItems: { fn: manageAgendaItems, write: true },
  managePoll: { fn: managePoll, write: true },
  manageFeedbackForm: { fn: manageFeedbackForm, write: true },
  getAdminStatistics: { fn: getAdminStatistics, write: false },
  exportResults: { fn: exportResults, write: false },
  importSeed: { fn: importSeed, write: true },
  previewRetention: { fn: previewRetention, write: false },
  applyRetention: { fn: applyRetention, write: true },
  previewUserData: { fn: previewUserData, write: false },
  eraseUserData: { fn: eraseUserData, write: true },
  listAudit: { fn: listAudit, write: false }
};

function handle_(p) {
  ctx = newCtx_();
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail_('BAD_REQUEST', 'Neispravan zahtjev.');
  if (typeof p.action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS, p.action)) fail_('BAD_REQUEST', 'Nepoznata akcija.');
  var a = ACTIONS[p.action];
  if (!a.write) return a.fn(p);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('BUSY', 'Sistem je zauzet. Pokušajte ponovo za nekoliko sekundi.');
  ctx.locked = true;
  try { return a.fn(p); } finally { ctx.locked = false; lock.releaseLock(); }
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function run_(p) {
  try {
    return respond_({ ok: true, data: handle_(p) });
  } catch (e) {
    if (e instanceof ApiError) return respond_({ ok: false, error: { code: e.code, message: e.message } });
    console.error('INTERNAL', e && e.stack ? e.stack : String(e));
    return respond_({ ok: false, error: { code: 'INTERNAL', message: 'Došlo je do greške na serveru.' } });
  }
}

function doPost(e) {
  var raw = e && e.postData && e.postData.contents;
  if (typeof raw !== 'string' || raw.length > 200000) return respond_({ ok: false, error: { code: 'BAD_REQUEST', message: 'Neispravan zahtjev.' } });
  var p;
  try { p = JSON.parse(raw); } catch (err) { return respond_({ ok: false, error: { code: 'BAD_REQUEST', message: 'Neispravan JSON.' } }); }
  return run_(p);
}

/** GET služi samo za provjeru da servis radi i za javni popis događaja (bez prijave). */
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'listPublishedEvents') return run_({ action: 'listPublishedEvents' });
  return respond_({ ok: true, data: { service: 'eestec-events', version: VERSION } });
}

/** Pokrenuti jednom iz editora (Run → setup): pravi sve listove sa zaglavljima i početne postavke. */
function setup() {
  ctx = newCtx_();
  Object.keys(SCHEMA).forEach(function (n) { ensureSheet_(n); });
  var s = read_('Settings');
  if (!s.length) {
    append_('Settings', [
      { key: 'siteTitle', value: 'EESTEC LC Sarajevo — Events' },
      { key: 'organization', value: 'EESTEC LC Sarajevo' },
      { key: 'contactEmail', value: 'hr@eestec-sa.ba' }
    ]);
  }
  salt_();
  var seeded = seedAdmins_();
  var missing = [];
  if (!prop_('CLIENT_ID')) missing.push('CLIENT_ID');
  return 'Listovi su spremni.' + (seeded ? ' Početni administratori upisani: ' + seeded + '.' : ' Administratori nisu mijenjani.') + (missing.length ? ' Još postavite u Script properties: ' + missing.join(', ') : '');
}

/**
 * Upisuje početne administratore SAMO pri prvoj inicijalizaciji (Script property ADMINS_SEEDED još ne postoji).
 * Kasnije pokretanje setup() ne dira listu, pa se ukinuti administratori ne vraćaju.
 * Uvijek se uključuje i račun pod kojim je skripta objavljena (vlasnik).
 */
function seedAdmins_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('ADMINS_SEEDED')) return 0;
  var have = {};
  read_('Admins').forEach(function (r) { have[r.email.toLowerCase()] = 1; });
  var list = INITIAL_ADMINS.slice();
  var owner = ownerEmail_();
  if (owner && list.indexOf(owner) < 0) list.push(owner);
  var add = list.filter(function (e) { return !have[e]; }).map(function (e) { return { email: e, active: true, addedAt: now_(), addedBy: 'setup', sub: '' }; });
  append_('Admins', add);
  props.setProperty('ADMINS_SEEDED', now_());
  return add.length;
}
function ownerEmail_() {
  try { return String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e) { return ''; }
}

/**
 * OPORAVAK PRISTUPA. Pokreće se ručno iz Apps Script editora (Run → recoverAccess) pod računom vlasnika skripte.
 * NIJE dostupno preko web aplikacije (nije u ACTIONS, nema URL-a): zahtijeva pristup editoru skripte, što je isto povjerenje kao vlasništvo nad njom.
 * Vraća aktivnim račun vlasnika (dodaje ga ako fali) i briše njegovu vezu sa Google sub-om. Ostale administratore ne dira.
 */
function recoverAccess() {
  ctx = newCtx_();
  var owner = ownerEmail_();
  if (!owner) return 'Nije moguće odrediti račun vlasnika.';
  ensureSheet_('Admins');
  var row = where_('Admins', function (r) { return r.email.toLowerCase() === owner; })[0];
  if (row) { row.active = true; row.sub = ''; save_('Admins', row); }
  else append_('Admins', [{ email: owner, active: true, addedAt: now_(), addedBy: 'recoverAccess', sub: '' }]);
  return 'Pristup vraćen za ' + owner + '.';
}

/**
 * Ako je administrator zaključan zbog promjene Google računa (isti email, drugi sub): u Script properties postavite
 * RESET_BINDING_EMAIL na tu adresu, pa pokrenite resetAdminBinding(). Svojstvo se nakon toga briše.
 */
function resetAdminBinding() {
  ctx = newCtx_();
  var props = PropertiesService.getScriptProperties();
  var email = String(props.getProperty('RESET_BINDING_EMAIL') || '').trim().toLowerCase();
  if (!email) return 'Postavite RESET_BINDING_EMAIL u Script properties.';
  var row = where_('Admins', function (r) { return r.email.toLowerCase() === email; })[0];
  if (!row) return 'Administrator nije pronađen: ' + email;
  row.sub = '';
  save_('Admins', row);
  props.deleteProperty('RESET_BINDING_EMAIL');
  return 'Veza resetovana za ' + email + '.';
}
