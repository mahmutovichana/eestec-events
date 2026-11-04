# Rezultati testova (sheets/)

Statusi: **PASS** (izvršeno i prošlo), **FAIL**, **BLOCKED** (ne može bez vanjskog pristupa), **NOT RUN**.

Okruženje: Windows 11, Node 26.4, Chrome (headless, puppeteer-core), axe-core, Vite 6, React 19.
Komanda: `npm run sheets:build` pa `npm run sheets:test`.

## Važno: šta ovi testovi dokazuju, a šta ne

Backend (`Code.gs`) je izvršen **u Nodeu, u `vm` kontekstu, nad lažnim Apps Script okruženjem** (`sheets/test/fake-gas.mjs`: Sheets u memoriji, LockService, CacheService, UrlFetchApp koji glumi Googleov `tokeninfo`). To dokazuje **logiku** (autorizacija, validacija, pravila, redoslijed upisa), ali **ne dokazuje**:

- da pravi Google prijava i ID token rade sa vašim Client ID-em i domenom (**BLOCKED**, traži stvarne račune),
- da stvarni `tokeninfo` odgovara kako lažni (format polja je preuzet iz dokumentacije, nije viđen uživo),
- ponašanje stvarnog `LockService` pod pravim paralelizmom (JS u testu je jednonitan; testirano je da se brava poštuje i da se uvijek oslobađa, ne pravi paralelizam),
- stvarne kvote i greške Googlea, CORS ponašanje stvarnog `/exec` URL-a, stvarno ponašanje Sheets (npr. tekstualni format ćelija: simuliran, ne viđen uživo).

Prijava u UI testovima je **simulirana** (osam administratorskih računa je također simulirano) (test-token u `localStorage`, prihvaćen samo od lažnog Googlea). To nije dokaz da Google OAuth radi.

## Sažetak

| Provjera | Rezultat |
|---|---|
| `tsc --noEmit` (frontend) | **PASS**, 0 grešaka |
| `vite build` | **PASS** (JS 272 kB, 83 kB gzip; CSS 15 kB) |
| `npm run sheets:test` | **PASS**: 113 testova, 113 prošlo, 0 palo, 0 preskočeno |
| Backend (`backend.test.mjs`) | **PASS** 36/36 |
| Autorizacija i administratori (`admins.test.mjs`) | **PASS** 25/25 |
| Mapiranje migracije (`migration.test.mjs`) | **PASS** 5/5 |
| Čuvanje podataka, brisanje, revizija (`retention.test.mjs`) | **PASS** 13/13 |
| Pravne stranice, statički (`legal.test.mjs`) | **PASS** 8/8 |
| Browser (`e2e.test.mjs`, Chrome) | **PASS** 26/26 (uključuje artefakt pod /eestec-events/, stvarni config.js, stranicu Čuvanje podataka) |
| axe-core WCAG 2.0/2.1/2.2 A/AA + best-practice, 10 stranica × 2 širine (javne + admin) | **PASS**, 0 povreda (jedna povreda `target-size` je uhvaćena i ispravljena tokom rada) |
| Bez horizontalnog scrolla, 8 stranica × 6 širina (320/375/390/768/1024/1440) | **PASS** |
| `eslint` za `sheets/web` | **NOT RUN** (nije konfigurisan za ovaj podprojekt) |
| npm audit za `sheets/web` | **NOT RUN** |
| Lint/sintaksa `Code.gs` u pravom Apps Script editoru | **NOT RUN** (izvršava se u Node V8; Apps Script V8 podržava korišteni jezik, ali nije potvrđeno uživo) |

## Pokriveno testovima

**Backend (36):** inicijalizacija listova (zaglavlja, tekstualni format, idempotentno, samo-pravljenje pri prvom zahtjevu), nadogradnja šeme (dodavanje kolona bez gubitka podataka), javni pristup bez prijave i skrivanje nacrta, nepostojanje emailova/identiteta u javnim odgovorima, admin samo za ovjerene administratore iz liste `Admins` (11 admin akcija × 8 vrsta nevažećih/lažnih tokena: bez tokena, običan korisnik, neverifikovan email, tuđi `aud`, istekao, pogrešan `iss`, smeće, ne-JWT), ignorisanje `email/role/isAdmin/userSub` iz tijela, keširanje tokena (1 poziv Googleu), nepostavljen `CLIENT_ID` (greška, ne prihvata sve), CRUD događaja (slug, validacija datuma, prelazi statusa), trajno brisanje (samo Nacrt/Arhiva, tačan naziv, kaskada), agenda (redoslijed, validacija vremena, optimistički konflikt, vrste stavki), formula/datum kao običan tekst, glasanje (prijava obavezna, jedan glas, izmjena samo ako je dozvoljena, opcija druge ankete, nepostojeća/maliciozna opcija, zatvorena anketa/događaj, nacrt), brava (zauzeto → `BUSY` bez upisa; brava se oslobađa i nakon greške), 50 uzastopnih glasova → 1 red, 4 načina vidljivosti rezultata, arhiviranje opcije s glasovima, reset i brisanje uz potvrdu, statistika i glasači za admina, anonimni feedback (nema identiteta/uređaja u tabeli, vrijeme na dan, token se ni ne provjerava), validacija odgovora (ocjena 1–5, izbori, obavezna pitanja, duplikati, dužine, nepoznato pitanje, polovični upis se ne dešava), honeypot, idempotentnost po `submissionId`, ograničenja zloupotrebe, identificirani feedback, zaključavanje načina forme, zatvorene forme/događaji, historija odgovora nakon izmjene/arhiviranja pitanja, višestruki izbor, CSV (injekcija formula, navodnici, BOM), nepoznate akcije/prototype ključevi/loš JSON/preveliko tijelo, greška ne otkriva detalje, uvoz (admin, idempotentan, validacija ID-eva), više događaja i godina, nema ugrađenih tajni u izvornom kodu.

**Browser (17):** gost: početna, javna agenda, 404 za nacrt, poziv na prijavu i onemogućene opcije; prijavljen korisnik: glasanje, izmjena, zatvorena anketa; anonimni feedback (obavezno pitanje, slanje, bez identiteta); admin: gost i običan korisnik nemaju pristup, cijeli tok (događaj → agenda → stavka → anketa → forma → objava), rezultati, brisanje s potvrdom naziva, Escape zatvara dijalog; mrežna greška s ponovnim pokušajem; bez horizontalnog scrolla na 6 širina; axe; CSP ne blokira aplikaciju.

## Regresioni testovi autorizacije (`admins.test.mjs`, 25)

Svih 8 administratora (sa i bez `hd` claima) izvršava sve admin akcije; 13 vrsta lažnih identiteta (gost, običan Gmail, `hr@eestec-sa.ba.evil.com`, `xhr@`, drugi domen, neverifikovan email kao string i bool, tuđi `aud`, istekao, pogrešan `iss`, bez emaila, smeće, ne-JWT) odbijeno na svih 14 admin akcija uključujući `listAdmins/addAdmin/setAdminActive`; opozvani administrator gubi pristup odmah i sa keširanim tokenom; dodavanje; validacija emaila i duplikati (velika/mala slova); `ADMIN_EMAIL_DOMAINS`; `ADMIN_REQUIRE_HD` (isključen podrazumijevano); posljednji administrator; lista ne curi u javnim odgovorima; `importSeed` ne dira `Admins`; vezanje `sub` i odbijanje drugog `sub`; `resetAdminBinding`; `recoverAccess` i nepostojanje web puta do oporavka; idempotentan `setup` koji ne vraća ukinute administratore; ručno uneseni redovi; zauzeta brava. Mutacijska provjera: namjerno uklanjanje provjere `active` obara 4 testa, uklanjanje zaštite posljednjeg administratora obara 1.

## Stabilnost testova

Jedan UI test (cijeli admin tok) je bio nestabilan (1 od 3 pokretanja) zbog utrke u samom testu (čekao je element koji postoji i na prethodnom tabu). Ispravljen čekanjem tačnog sadržaja; potom 6/6 uzastopnih prolaza.

## Stvarna integracija (`node sheets/scripts/real-smoke.mjs`): 12/12 PASS

Stvarni Chrome + stvarni Apps Script deployment (samo čitanje, bez prijave). Dokazuje: POST kao `text/plain`, bez preflighta, redirect na `script.googleusercontent.com`, `Access-Control-Allow-Origin: *`, odgovor servera prikazan u stranici, admin akcije bez prijave odbijene, deploy je verzija sa više administratora, lažni token stiže do Googlea i biva odbijen bez `INTERNAL` greške, tabela anonimno vraća 401. **Ne dokazuje** Google prijavu ni admin funkcije (traže ručni klik pravog korisnika; `INTEGRATION-CHECKLIST.md`), niti origin `github.io` (stranica još nije objavljena).

## Šta nije izvršeno

| Stavka | Status | Razlog |
|---|---|---|
| Pravi Google login (8 administratora i običan korisnik) | **BLOCKED** | traži klik pravih korisnika; Google projekt i klijent postoje (INTEGRATION-CHECKLIST.md, C) |
| Pokušaj admin pristupa pravim drugim Google računom | **BLOCKED** | isto |
| Stvarno čitanje/pisanje u Google Sheets, CORS, redirect `/exec` | **BLOCKED** | traži vašu tabelu i deployment |
| Paralelni zahtjevi na pravom Apps Scriptu | **NOT RUN** | traži deployment; logika brave testirana lažno |
| Ponašanje pri prekoračenju Google kvote | **NOT RUN** | ne može se bezbjedno izazvati; frontend prikazuje poruku za neočekivan odgovor |
| Izvoz iz stvarne razvojne baze | **BLOCKED** | Docker nije bio pokrenut |
| Čitač ekrana, stvarni mobilni uređaji | **NOT RUN** | ručna provjera; testirana emulacija i 6 širina |
| GitHub Pages workflow na GitHubu | **NOT RUN** | izvršava se tek na GitHubu; lokalno provjereno: valjan YAML, čist `npm ci` + build, artefakt pod `/eestec-events/` |
| Javni URL-ovi na github.io | **FAIL u trenutku provjere** | `/`, `/privacy/`, `/terms/` vraćaju 404 dok se Pages ne uključi i workflow ne izvrši (SETUP.md korak 5a) |

Prije stvarne upotrebe odradite „Korak 6: Provjera“ iz `SETUP.md`: to je zamjena za sve BLOCKED stavke.
