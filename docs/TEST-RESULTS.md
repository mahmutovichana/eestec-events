# Rezultati testova

Statusi: **PASS** (izvršeno i prošlo), **FAIL**, **BLOCKED** (ne može se izvršiti bez vanjskih kredencijala), **NOT RUN** (nije izvršeno).

Okruženje: Windows 11, Node 26.4, Chrome (headless, puppeteer-core), PostgreSQL 16 u Dockeru, Next.js 15.5.29, Prisma 6.19.3.
Komanda: `npm test` (`scripts/test-all.mjs`). Harness kreira jednokratnu bazu, primjenjuje **sve migracije od nule**, pokreće šest servera
(A: simulirana sesija, B: bez simulacije, C: produkcijski build, D: nedostupna baza, E i E2: dvije instance s pravim limitima) i briše bazu na kraju.

## Sažetak potpunog prolaza

| Provjera | Rezultat |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | **PASS**, 0 grešaka |
| `npm run lint` (ESLint) | **PASS**, 0 grešaka, 0 upozorenja |
| `npm run build` (produkcijski build) | **PASS**: izvršen kao `next build` s `NEXT_DIST_DIR` (isti kod, isti koraci), kroz harness i zasebno; izlaz sadrži poznato Auth0 SDK upozorenje „Critical dependency” |
| `npm test` | **PASS**: 144 testa, 144 prošla, 0 palih, 0 preskočenih; 1202 s |
| axe-core, WCAG 2.x A/AA + best-practice, 18 stranica × 2 širine | **PASS**: 0 povreda (prije ispravki: 31 ozbiljnih na 1280 px i 32 na 390 px) |
| Migracije od nule i nadogradnja stare baze | **PASS** (vidi ispod) |

## Po datotekama

| Datoteka | Testova | Šta pokriva |
|---|---|---|
| `roles.test` | 6 | `computeRole`: samo verifikovan Google identitet s tačnim emailom je ADMIN |
| `unit.test` | 6 | prelazi statusa, pravila vidljivosti, preklapanje termina, CSV, slug, trajanje |
| `actions-guard.test` | 4 | statički: svaka akcija zove `guard()` prije baze; samo jedan `use server` fajl; admin rute provjeravaju ulogu; klijent ne šalje userId/role |
| `db-integrity.test` | 16 | negativni testovi direktno nad bazom (složeni FK, unique, blokirano brisanje historije, kaskade, atomarnost rate-limita) |
| `migrations.test` | 4 | nova baza, nadogradnja sa starim podacima, migracija koja se zaustavlja bez promjena, nema destruktivnih naredbi |
| `api.test` | 29 | Guest/User/Admin, nacrt, glasanje, anonimni i identificirani feedback, CSV, privatnost |
| `concurrency.test` | 9 | glasanje naspram zatvaranja, promjena statusa, paralelno glasanje i feedback, zaključavanje forme |
| `ratelimit.test` | 5 | limiti na dvije instance s zajedničkom bazom, ključevi su HMAC |
| `auth-security.test` | 11 | put bez simulacije, produkcijski build, zaglavlja, nedostupna baza |
| `ui.test` | 20 | CRUD događaja, agende, autosave, povlačenje, ručak, feedback, profil, dupliciranje, arhiviranje |
| `ui-edge.test` | 23 | 6 širina, dodir, tastatura i fokus, konflikt, offline, arhiviranje, potvrde, prazna stanja |
| `journeys.test` | 9 | putovanja organizatora (16 koraka), učesnika i anonimnog feedbacka |
| `a11y.test` | 2 | axe na 18 stranica pri 1280 i 390 px |
| **Ukupno** | **144** | |

## Dokazi za ključne zahtjeve

**Historija feedbacka (1.1):** brisanje pitanja s odgovorom odbija baza; pitanje se arhivira, odgovor i statistika ostaju; CSV zadržava arhivirano pitanje;
izmjena teksta ostavlja snimak starog teksta u odgovoru (`db-integrity`, `ui-edge`).

**Opcija pripada anketi (1.2):** pokušaji kroz Prisma i sirovi SQL da se upiše glas s opcijom druge ankete ili odgovor s pitanjem druge forme su odbijeni (`db-integrity`).

**Utrke glasanja (1.3):** (a) dokaz zaključavanja: zatvaranje ankete čeka dok traje transakcija glasanja; (b) 60 zahtjeva oko trenutka zatvaranja:
svi zahtjevi poslani nakon zatvaranja su 403, nijedan glas nije upisan ni izmijenjen nakon zatvaranja; (c) isto za prelazak događaja u Završen;
(d) 24 istovremene promjene glasa ostavljaju tačno jedan red (`concurrency`).

**Konkurentnost feedbacka (1.4):** 20 + 10 istovremenih slanja daje tačno 2 odgovora (po jedan za svakog korisnika); s `oneResponsePerUser=false` svih 6 se upisuje;
promjena načina forme čeka kraj slanja; nema odgovora nakon zatvaranja forme (`concurrency`).

**Autorizacija (2.2):** običan korisnik je preusmjeren na `/forbidden` na svim admin rutama i dobija 403 na CSV; „lažni admin” (isti email, neverifikovan, ne-Google) je User;
tijelo zahtjeva s `userId`/`role` se ignoriše (`api`, `roles`, `actions-guard`).

**DEV_AUTH (2.4):** na produkcijskom buildu `/dev-login` vraća 404, ne postavlja kolačić, a `dev_user` kolačić ne daje pristup ni na `/admin`, ni na API-ju (`auth-security`, server C).

**Pad baze (2.3):** sa nedostupnom bazom `/admin`, `/api/vote` i `/api/feedback` vraćaju 5xx, bez preusmjeravanja na prijavu i bez detalja baze u odgovoru (`auth-security`, server D).

**Ograničenje brzine (12):** 31. glasanje u minuti dobija 429, a isti brojač vrijedi na drugoj instanci; 11. anonimno slanje na sat dobija 429 preko dvije instance; ključevi u bazi su HMAC (`ratelimit`).

**Migracije (13):**
- nova baza: sve migracije prolaze redom, `prisma migrate diff` šema ↔ migracije je prazan, `migrate status` je „up to date”;
- nadogradnja baze iz stanja `0_init` sa podacima: `HIDDEN → DRAFT`, `TEXT → LONG_TEXT`, `showResults` sačuvan, stari anonimni glasovi (`userId NULL`, `voterHash` postavljen) sačuvani,
  snimak pitanja popunjen u odgovorima, anonimno vrijeme zaokruženo na dan, stari feedback ostaje ANONYMOUS, nova pravila (složeni FK, blokirano brisanje) aktivna;
- podaci koji krše nova pravila: `migrate deploy` pada, nove kolone ne postoje, podaci su netaknuti;
- nijedna migracija poslije `0_init` ne sadrži `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` ni `DELETE FROM`.
- Razvojna baza s postojećim HOBOM podacima je nadograđena stvarnom `migrate deploy` komandom nakon kopije (`pg_dump`); podaci su provjereni upitima.

**Pristupačnost (10):** axe: 0 povreda na 18 stranica (javne, korisničke, admin) pri 1280 i 390 px. Dodatno testirano u pregledaču: kontrole ≥ 24×24 px na 6 širina,
vidljiv fokus, fokus ne izlazi iz modalnog dijaloga, Esc vraća fokus na okidač, promjena redoslijeda stavki tastaturom, dodir (emulirani iPhone 13),
alternativa povlačenju (dugmad gore/dolje).

**Širine (9):** 320, 375, 390, 768, 1024, 1440 px: bez horizontalnog scrolla na 11 stranica po širini.

## Pronađeno i ispravljeno tokom testiranja

| Nalaz | Ispravka |
|---|---|
| Brisanje cijele forme padalo zbog redoslijeda kaskadnih FK provjera | FK provjera odgođena do kraja transakcije (migracija `deferred_history_fks`) |
| Složeni FK traži eksplicitne ključeve pri upisu odgovora (Prisma validacija) | upis odgovora kroz `createMany` |
| `next build` odbijao `run()` zbog tipa `void \| Result` | ispravljen tip |
| Neuspjela prijava vraćala goli 500 | `middleware.ts` preusmjerava na početnu s porukom |
| Brend crvena i sitni tekst ispod AA kontrasta (31 povreda) | `#E3282E` za površine s tekstom, `#D92329` za crveni tekst |
| Imena kontrola, landmarke, redoslijed naslova | ispravljeno |
| Tabela učesnika nedostupna tastaturi | `tabIndex` i `role="region"` |
| Test dijeli brojače rate-limita između servera | brojači se čiste na početku `ratelimit` testa (brojači su namjerno zajednički) |

## Nije izvršeno

| Stavka | Status | Razlog |
|---|---|---|
| Stvarni Google/Auth0 OAuth tok (prijava, callback, odjava) | **BLOCKED** | traži Auth0 račun i Google OAuth ključeve. Svi testovi prijave koriste simuliranu sesiju (`DEV_AUTH`) ili provjeravaju put bez simulacije; to NIJE dokaz da pravi OAuth radi |
| Istek i obnova stvarne Auth0 sesije | **BLOCKED** | isti razlog |
| Pregled čitačem ekrana (NVDA/VoiceOver) | **NOT RUN** | ručna provjera; axe pokriva samo dio WCAG kriterija |
| Stvarni mobilni uređaji (iOS/Android) | **NOT RUN** | testirana emulacija i 6 širina |
| Test opterećenja | **NOT RUN** | nije tražen; vidi performanse u ARCHITECTURE.md |
| `npm audit fix` | **NOT RUN** | traži major nadogradnju Next-a (vidi SECURITY.md) |
| Produkcijska baza | **NOT RUN** | ne postoji; migracije provjerene na jednokratnim bazama i razvojnoj bazi |
