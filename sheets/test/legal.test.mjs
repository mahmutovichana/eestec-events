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
  for (const must of ['Google tabel', 'sessionStorage', 'localStorage', 'Votes', 'FeedbackResponses', 'Admins', 'Google Fonts', 'accounts.google.com', 'GitHub', 'anonimn', 'datum', 'ručno', 'hana.mahmutovic@eestec-sa.ba', 'AuditLog', 'privatna', 'Ne koristimo analitiku']) {
    assert.ok(privacy.includes(must), 'nedostaje: ' + must);
  }
  for (const must of ['Google Sheet', 'sessionStorage', 'localStorage', 'cannot link anonymous', 'Google Fonts', 'audit log', 'no analytics']) assert.ok(privacy.includes(must), 'EN nedostaje: ' + must);
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
  assert.ok(count(privacy) >= 10, 'privatnost: ' + count(privacy));
  assert.ok(count(terms) >= 6, 'uslovi: ' + count(terms));
  assert.match(privacy, /\[POTVRDITI: koliko često se anonimizacija/);
  assert.match(privacy, /NACRT \/ DRAFT/);
  assert.match(terms, /NACRT \/ DRAFT/);
  assert.match(privacy, /\[POTVRDITI: pravni osnov/);
  assert.match(terms, /\[POTVRDITI: mjerodavno pravo/);
  // jedini potvrđeni rok je 24 mjeseca; nijedan drugi rok u danima/mjesecima/godinama nije izmišljen
  assert.ok(!/\b(?!24\b)\d+\s*(dana|mjeseci|mjeseca|godina|days|months|years)\b/i.test(privacy.replace(/<[^>]+>/g, ' ')), 'nema izmišljenih rokova');
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

const RETENTION_IN_CODE = Number(/var RETENTION_MONTHS = (\d+);/.exec(code)?.[1]);

test('potvrđene odluke organizacije su u tekstu, a pravni rukovalac je razdvojen od operativnog kontakta', () => {
  assert.ok(!/hr@eestec-sa\.ba/.test(privacy + terms), 'stara kontakt adresa je zamijenjena');
  assert.match(privacy, /Operativni kontakt za privatnost<\/b> \(osoba koja rješava svakodnevne zahtjeve; to nije isto što i pravni rukovalac\): <a href="mailto:hana\.mahmutovic@eestec-sa\.ba"/);
  assert.match(privacy, /Operational privacy contact/);
  assert.match(privacy, /Pravni rukovalac podacima<\/b>[^<]*<mark class="confirm">\[POTVRDITI: tačan pravni naziv, registrovana adresa/);
  assert.match(privacy, /Legal controller<\/b>[^<]*<mark class="confirm">\[CONFIRM: exact legal name, registered address/);
  assert.match(privacy, /najviše dvije godine \(24 mjeseca\)/);
  assert.match(privacy, /at most two years \(24 months\)/);
  assert.match(privacy, /bilo koji trenutno ovlašteni administrator/);
  assert.match(privacy, /any currently authorised administrator/);
  assert.match(privacy, /<b>privatna<\/b>: nije javno dijeljena/);
  assert.match(privacy, /ne briše podatke automatski/);
  // ništa nije izmišljeno: pravni osnov, nadležno tijelo, dob, rok odgovora i mjerodavno pravo ostaju otvoreni
  for (const m of ['pravni osnov obrade', 'nadležno tijelo za zaštitu podataka', 'ciljna publika i minimalna dob', 'rok za obradu zahtjeva']) assert.ok(privacy.includes(m), m);
  assert.match(terms, /\[POTVRDITI: mjerodavno pravo/);
});

test('rok čuvanja iz politike (24 mjeseca) odgovara kodu i ne može se zaobići sa klijenta', () => {
  assert.equal(RETENTION_IN_CODE, 24);
  assert.match(code, /function retentionCutoff_\(\)/);
  assert.ok(!/p\.months|p\.cutoff/.test(code), 'rok ne dolazi iz zahtjeva');
  assert.ok(!/ScriptApp|newTrigger/.test(code), 'nema automatskog brisanja');
});
