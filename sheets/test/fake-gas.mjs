// Lažno Google Apps Script okruženje u memoriji. Služi SAMO za testiranje logike Code.gs.
// Ne dokazuje ponašanje stvarnog Googlea (kvote, OAuth, stvarni Sheets): vidi TEST-RESULTS.
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CLIENT_ID = 'test-client.apps.googleusercontent.com';

/** Test-token: "t.<base64url(json)>.sig" — fake UrlFetchApp ga prihvata kao "Google" odgovor. Pravi backend ga odbija (tokeninfo vrati 400). */
export function makeToken(claims, opts = {}) {
  const c = {
    aud: CLIENT_ID, iss: 'https://accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 3600),
    email_verified: 'true', ...claims,
  };
  return 'tt' + 'x'.repeat(60) + '.' + Buffer.from(JSON.stringify({ ...c, ...(opts.override || {}) })).toString('base64url') + '.' + 'sig'.repeat(10);
}

class FakeSheet {
  constructor(name, maxRows = 1000) { this.name = name; this.data = []; this.maxRows = maxRows; this.formats = null; this.frozen = 0; }
  getLastRow() { let n = this.data.length; while (n > 0 && this.data[n - 1].every((v) => v === '' || v == null)) n--; return n; }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_pos, n) { this.maxRows += n; }
  setFrozenRows(n) { this.frozen = n; }
  deleteRow(n) { if (n < 1 || n > this.data.length) throw new Error('bad row'); this.data.splice(n - 1, 1); this.maxRows--; }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  getRange(r, c, nr = 1, nc = 1) {
    const sh = this;
    if (r < 1 || c < 1) throw new Error('bad range');
    return {
      getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((sh.data[r - 1 + i] || [])[c - 1 + j] ?? ''); out.push(row); } return out; },
      setValues(vals) {
        if (vals.length !== nr || vals.some((v) => v.length !== nc)) throw new Error('dimension mismatch');
        if (r - 1 + nr > sh.maxRows) throw new Error('outside sheet dimensions');
        for (let i = 0; i < nr; i++) {
          while (sh.data.length <= r - 1 + i) sh.data.push([]);
          for (let j = 0; j < nc; j++) {
            let v = vals[i][j];
            if (sh.formats === '@' && typeof v !== 'string') v = String(v); // tekstualni format
            sh.data[r - 1 + i][c - 1 + j] = v;
          }
        }
      },
      setNumberFormat(f) { sh.formats = f; return this; },
    };
  }
}

class FakeSpreadsheet {
  constructor() { this.sheets = new Map(); }
  getSheetByName(n) { return this.sheets.get(n) || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.set(n, s); return s; }
}

export function createGas({ owner = 'hana.mahmutovic@eestec-sa.ba', props = {} } = {}) {
  const ss = new FakeSpreadsheet();
  const stats = { fetches: 0, lockWaits: 0, quotaWrites: 0 };
  const scriptProps = { CLIENT_ID, ...props };
  const cacheStore = new Map();
  let locked = false;
  const sandbox = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => scriptProps[k] ?? null, setProperty: (k, v) => { scriptProps[k] = v; }, deleteProperty: (k) => { delete scriptProps[k]; } }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => owner }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => { const e = cacheStore.get(k); if (!e) return null; if (e.exp < Date.now()) { cacheStore.delete(k); return null; } return e.v; },
      put: (k, v, ttl) => { cacheStore.set(k, { v, exp: Date.now() + (ttl ?? 600) * 1000 }); },
    }) },
    LockService: { getScriptLock: () => ({
      tryLock: () => { if (locked) { stats.lockWaits++; return false; } locked = true; return true; },
      releaseLock: () => { locked = false; },
    }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      computeDigest: (_alg, s) => [...crypto.createHash('sha256').update(s).digest()].map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
    },
    UrlFetchApp: { fetch: (url) => {
      stats.fetches++;
      const tok = decodeURIComponent(url.split('id_token=')[1] || '');
      const parts = tok.split('.');
      if (parts.length !== 3 || !tok.startsWith('tt')) return { getResponseCode: () => 400, getContentText: () => '{"error":"invalid_token"}' };
      try { return { getResponseCode: () => 200, getContentText: () => Buffer.from(parts[1], 'base64url').toString() }; }
      catch { return { getResponseCode: () => 400, getContentText: () => '{}' }; }
    } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ text: s, setMimeType() { return this; }, getContent() { return s; } }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(here, '../apps-script/Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });
  return {
    ss, stats, scriptProps, cacheStore, sandbox,
    setup: () => vm.runInContext('setup()', sandbox),
    /** Poziva funkciju iz Code.gs kao iz editora (npr. recoverAccess), mimo web aplikacije. */
    editorRun: (fn) => vm.runInContext(fn + '()', sandbox),
    /** Isto što radi Apps Script: JSON string -> doPost -> JSON string. */
    call(payload) {
      const out = vm.runInContext('doPost', sandbox)({ postData: { contents: typeof payload === 'string' ? payload : JSON.stringify(payload) } });
      return JSON.parse(out.getContent());
    },
    get(params) { return JSON.parse(vm.runInContext('doGet', sandbox)({ parameter: params }).getContent()); },
    rows(name) { return ss.getSheetByName(name).data.slice(1).filter((r) => r.length); },
    /** Napomena: čak i "paralelni" pozivi u jednoj JS niti su serijski; pravi paralelizam simuliramo ručnim držanjem brave. */
    holdLock() { locked = true; }, releaseLock() { locked = false; },
  };
}
