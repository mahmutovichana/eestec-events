// Statične pravne stranice: sadržaj mora odgovarati stvarnom ponašanju koda (Code.gs, frontend).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rd = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const privacy = rd('../web/public/privacy/index.html');
const terms = rd('../web/public/terms/index.html');
const code = rd('../apps-script/Code.gs');
const src = ['App', 'api', 'auth', 'public', 'admin'].map((f) => rd(`../web/src/${f}.${f === 'api' ? 'ts' : 'tsx'}`)).join('\n');
const count = (html) => (html.match(/class="confirm"/g) || []).length;

test('obje stranice postoje, dvojezične su i bez JavaScripta', () => {
  for (const [name, html] of [['privacy', privacy], ['terms', terms]]) {
    assert.match(html, /<section id="bs" lang="bs">/, name);
    assert.match(html, /<section id="en" lang="en">/, name);
    assert.ok(!/<script/i.test(html), name + ' ne smije imati skripte');
    assert.match(html, /default-src 'none'/);
    assert.ok(!/script-src|unsafe-inline/.test(html));
    assert.match(html, /<title>.*(Privacy|Terms)/);
  }
});

test('politika privatnosti opisuje stvarno ponašanje implementacije', () => {
  for (const must of ['Google tabel', 'sessionStorage', 'localStorage', 'Votes', 'FeedbackResponses', 'Admins', 'Google Fonts', 'accounts.google.com', 'GitHub', 'anonimn', 'datum', 'ručno', 'hr@eestec-sa.ba', 'Ne koristimo analitiku']) {
    assert.ok(privacy.includes(must), 'nedostaje: ' + must);
  }
  for (const must of ['Google Sheet', 'sessionStorage', 'localStorage', 'cannot link anonymous', 'Google Fonts', 'manually delete', 'no analytics']) assert.ok(privacy.includes(must), 'EN nedostaje: ' + must);
});

test('tvrdnje iz politike se poklapaju s kodom', () => {
  assert.match(code, /21600/, 'anonimni brojač 6 sati');
  assert.match(code, /Math\.min\(300/, 'keš tokena najviše 5 minuta');
  assert.match(code, /function day_\(\)/, 'anonimno vrijeme zaokruženo na dan');
  assert.match(privacy, /6 sati/);
  assert.match(privacy, /5 minuta/);
  assert.ok(!/picture/i.test(code), 'kod ne koristi profilnu sliku');
  assert.ok(!/picture/i.test(src), 'frontend ne koristi profilnu sliku');
  assert.match(src, /sessionStorage/);
  assert.match(src, /localStorage\.setItem\("eestec\.device"/);
  assert.ok(!/document\.cookie/.test(src), 'aplikacija ne postavlja vlastite kolačiće');
  assert.ok(!/gtag|analytics|google-analytics|fbq\(/i.test(src + code), 'nema analitike');
  assert.ok(!/UrlFetchApp\.fetch\('https:\/\/(?!oauth2\.googleapis\.com\/tokeninfo)/.test(code), 'server kontaktira samo Google tokeninfo');
  // anonimna forma ne upisuje identitet
  assert.match(code, /createdAt: id \? now_\(\) : day_\(\)/);
});

test('ništa se ne izmišlja: rokovi čuvanja, pravni osnov i mjerodavno pravo su označeni za potvrdu', () => {
  assert.ok(count(privacy) >= 12, 'privatnost: ' + count(privacy));
  assert.ok(count(terms) >= 6, 'uslovi: ' + count(terms));
  assert.match(privacy, /još nije odredila rokove čuvanja/);
  assert.match(privacy, /\[POTVRDITI: koliko dugo/);
  assert.match(privacy, /\[POTVRDITI: pravni osnov/);
  assert.match(terms, /\[POTVRDITI: mjerodavno pravo/);
  assert.ok(!/\b\d+\s*(dana|mjeseci|godina|days|months|years)\b/i.test(privacy.replace(/<[^>]+>/g, ' ')), 'nema izmišljenih rokova u danima/mjesecima/godinama');
  console.log(`  (otvorene odluke za potvrdu: privatnost ${count(privacy)}, uslovi ${count(terms)} oznaka, BS+EN)`);
});

test('linkovi između stranica i prema aplikaciji su relativni (rade na GitHub Pages podputanji)', () => {
  for (const html of [privacy, terms]) {
    for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const u = m[1];
      if (/^(https?:|mailto:|#)/.test(u)) continue;
      assert.ok(u.startsWith('../') , 'relativan link: ' + u);
    }
  }
  assert.match(privacy, /href="\.\.\/terms\/"/);
  assert.match(terms, /href="\.\.\/privacy\/"/);
  assert.ok(fs.existsSync(new URL('../web/public/legal.css', import.meta.url)));
});

test('frontend vodi na stranice iz podnožja i prijave; hash rute preusmjeravaju', () => {
  assert.match(src, /href="\.\/privacy\/"/);
  assert.match(src, /href="\.\/terms\/"/);
  assert.match(src, /parts\[0\] === "privacy"/);
});
