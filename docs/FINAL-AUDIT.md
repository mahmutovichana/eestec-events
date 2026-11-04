# Završni audit

Audit je rađen nad stvarnim kodom, šemom i ponašanjem aplikacije (grana `main`, commit `848fe9c`), ne nad ranijim sažecima.
Reference oblika `fajl:linija` odnose se na stanje u `main` prije ove grane, osim gdje piše drugačije.
Rezultati testova su u [TEST-RESULTS.md](TEST-RESULTS.md), neriješeno u [REMAINING-WORK.md](REMAINING-WORK.md).

Pregledano: sve stranice i rute, svi API endpointi, sve server akcije (`src/app/admin/actions.ts`, 27 akcija), sve komponente,
autentikacija i autorizacija (`src/lib/session.ts`, `src/middleware.ts`), šema i sve migracije, upiti i mutacije, validacione šeme,
testovi, CSS i responzivnost, konfiguracija, okruženje i tajne (uključujući Git historiju), dokumentacija, zavisnosti (`npm audit`),
pristupačnost (axe), performanse i obrada grešaka.

Git historija je pretražena na tajne (`AUTH0_SECRET`, `CLIENT_SECRET`, `DATABASE_URL` s vrijednošću, privatni ključevi): nema ih.
Jedini pronađeni pristupni podaci su lokalni razvojni `eestec:eestec` u `docker-compose.yml` i `.env.example`. Rotacija nije potrebna.
U repozitoriju je bio praćen build artefakt `tsconfig.tsbuildinfo` (F-M11).

## Pregled nalaza

| Težina | Ukupno | Riješeno | Otvoreno |
|---|---|---|---|
| CRITICAL | 2 | 2 | 0 |
| HIGH | 8 | 8 | 0 |
| MEDIUM | 12 | 12 | 0 |
| LOW | 5 | 3 | 2 |
| IMPROVEMENT | 5 | 5 | 0 |

## CRITICAL

### F-C01 Brisanje pitanja brisalo je historijske odgovore
- **Gdje:** `prisma/schema.prisma:211` (`FeedbackAnswer.question … onDelete: Cascade`), `src/app/admin/actions.ts:437` (`deleteQuestion`).
- **Problem:** brisanje pitanja kaskadno je brisalo sve odgovore na njega.
- **Uticaj:** nepovratan gubitak prikupljenog feedbacka i statistike jednim klikom.
- **Reprodukcija:** forma s odgovorima, admin obriše pitanje, odgovori nestaju.
- **Ispravka:** FK `NO ACTION`, odgođen do kraja transakcije (migracije `…integrity_and_history`, `…deferred_history_fks`). Pitanje s odgovorima se arhivira (`archivedAt`), a ne briše. Svaki odgovor čuva snimak pitanja (`questionLabel`, `questionType`, `questionOptions`), pa izmjena teksta ne mijenja značenje historije. Tip pitanja je nepromjenjiv. Izvoz i statistika uključuju arhivirana pitanja.
- **Testovi:** `db-integrity` (brisanje blokirano u bazi, kaskada brisanja cijele forme radi), `ui-edge` (arhiviranje, vraćanje, izmjena nakon odgovora), `migrations` (snimak se popunjava iz postojećih odgovora).
- **Status:** RIJEŠENO.

### F-C02 Glas je mogao ukazivati na opciju druge ankete
- **Gdje:** `prisma/schema.prisma:145-147` (odvojeni FK `pollId` i `optionId`).
- **Problem:** baza nije garantovala da opcija pripada anketi glasa.
- **Uticaj:** pokvarena statistika; aplikacijska provjera je bila jedina zaštita.
- **Ispravka:** složeni FK `(pollId, optionId) → LunchOption(pollId, id)`; odgovor takođe ima složene ključeve `(formId, questionId)` i `(formId, responseId)` i jedinstvenost `(responseId, questionId)`.
- **Testovi:** `db-integrity` (Prisma i sirovi SQL pokušaji, svi odbijeni).
- **Status:** RIJEŠENO.

## HIGH

### F-H01 Utrka glasanja i zatvaranja
- **Gdje:** `src/app/api/vote/route.ts:21-38`: provjera stanja pa upis u odvojenim koracima.
- **Ispravka:** jedna transakcija; `SELECT … FOR SHARE` nad anketom i događajem. Admin `UPDATE` (zatvaranje, promjena statusa) čeka kraj glasanja, a svako sljedeće glasanje vidi zatvoreno stanje. Unique `(pollId, userId)` ostaje konačna zaštita od duplikata, uz jedan ponovni pokušaj.
- **Testovi:** `concurrency` (lock dokaz, 60 zahtjeva oko zatvaranja, utrka sa statusom događaja, promjena glasa, paralelno mijenjanje glasa).
- **Status:** RIJEŠENO.

### F-H02 Brisanje opcije ručka brisalo je glasove
- **Gdje:** `src/app/admin/actions.ts:338` (`deleteOption`) i `schema.prisma:147`.
- **Ispravka:** opcija s glasovima se arhivira; naziv opcije s glasovima se ne može mijenjati; rezultati prikazuju arhivirane opcije s glasovima.
- **Status:** RIJEŠENO. Testovi: `ui-edge`, `db-integrity`.

### F-H03 Izmjena pitanja tiho mijenja značenje starih odgovora
- **Gdje:** `actions.ts:423` (`updateQuestion`).
- **Ispravka:** snimak pitanja u odgovoru (vidi F-C01); UI pokazuje ranije tekstove; CSV zaglavlje bilježi `[ranije: …]`.
- **Status:** RIJEŠENO.

### F-H04 Pad baze izgledao je kao odjava
- **Gdje:** `src/lib/session.ts:65-67`: `catch { return null }` oko cijele sinhronizacije korisnika.
- **Uticaj:** admin bi pri padu baze završio u petlji prijave, a API bi vraćao 401 umjesto greške.
- **Ispravka:** greške baze se ne gutaju; ostaje samo obrada istovremene prve prijave (`P2002`).
- **Test:** `auth-security` (server D s nedostupnom bazom: 5xx, bez curenja detalja).
- **Status:** RIJEŠENO.

### F-H05 Ograničenje brzine u memoriji
- **Gdje:** `src/lib/util.ts:58-59`: `Map` po instanci; neefikasno na serverless platformi.
- **Ispravka:** `src/lib/ratelimit.ts`: atomaran upsert u PostgreSQL-u (`RateLimit`), ključ je HMAC identiteta (nikad sirova IP ni userId).
- **Test:** `ratelimit` (dvije nezavisne instance dijele brojač), `db-integrity` (atomarnost pod 25 paralelnih poziva).
- **Status:** RIJEŠENO.

### F-H06 Feedback: dupla i tuđa pitanja, isključena pitanja, utrke
- **Gdje:** `src/app/api/feedback/route.ts:50-64`: isto `questionId` dvaput bi se upisalo dvaput; isključeno pitanje se tiho ignorisalo; nema zaključavanja forme.
- **Ispravka:** duplikati se odbijaju (400), isključeno/arhivirano pitanje daje 409, forma i pitanja su zaključana `FOR SHARE` tokom upisa, `updateForm` koristi `FOR UPDATE` pa se način ne može promijeniti usred slanja. Advisory lock za jedan odgovor po korisniku zadržan.
- **Testovi:** `api`, `concurrency` (20+10 istovremenih slanja, zatvaranje forme usred slanja, promjena načina).
- **Status:** RIJEŠENO.

### F-H07 Destruktivne radnje uz jednu potvrdu
- **Gdje:** `actions.ts:170, 296, 305, 386, 395`.
- **Ispravka:** događaj se briše samo iz Nacrta ili Arhive uz upis tačnog naziva; anketa/forma s podacima, reset glasova i brisanje odgovora traže upis `OBRIŠI`; server provjerava izraz. Politika čuvanja je u [SECURITY.md](SECURITY.md).
- **Status:** RIJEŠENO. Testovi: `ui-edge`.

### F-H08 Auth0 SDK sesija bez eksplicitne konfiguracije
- **Gdje:** `src/lib/auth0.ts`.
- **Ispravka:** eksplicitno: kliznuća sesija, tvrda granica 7 dana, istek nakon 24 h neaktivnosti, `SameSite=Lax`, `Secure` u produkciji.
- **Status:** RIJEŠENO. Napomena: stvarna sesija nije testirana s pravim Auth0 (vidi REMAINING-WORK).

## MEDIUM

| ID | Nalaz | Gdje | Ispravka / status |
|---|---|---|---|
| F-M01 | Utrka pri kreiranju slug-a (provjera pa upis) | `actions.ts:73-84, 140` | Upis s ponavljanjem na `P2002`; test istovremenog kreiranja. RIJEŠENO |
| F-M02 | Proizvoljni prelazi statusa | `actions.ts:109` | Matrica prelaza `src/lib/status.ts`, provjera pod `FOR UPDATE`; vraćanje iz arhive. RIJEŠENO |
| F-M03 | Pozicija = `count()`: duplikati pod paralelnim dodavanjem | `actions.ts:187, 236, 321, 416` | `max+1` pod advisory lockom. RIJEŠENO |
| F-M04 | Nema zaštite od istovremenog uređivanja stavki; `reorderItems` prihvata nepotpune liste | `actions.ts:244, 262` | `version` kolona (optimistično zaključavanje), validacija liste. RIJEŠENO |
| F-M05 | Urednik agende: nema upozorenja pri napuštanju, neuspjeli upis visi, nema upozorenja o preklapanju | `ItemEditor.tsx:43` | `beforeunload`, greška + „Pokušaj ponovo”, `findOverlaps`. RIJEŠENO |
| F-M06 | Istovremena prva prijava može pasti na unique | `session.ts` | Obrada `P2002`. RIJEŠENO |
| F-M07 | Neuspjeli OAuth callback vraća goli 500 tekst | Auth0 SDK | `middleware.ts` preusmjerava na `/?prijava=neuspjela`. RIJEŠENO |
| F-M08 | Nema sigurnosnih zaglavlja | `next.config.ts` | nosniff, frame DENY, referrer, permissions, HSTS, `no-store` na privatnim rutama. CSP nije uključen (REMAINING-WORK). RIJEŠENO |
| F-M09 | Kontrast: 31 axe povreda; brend crvena `#E52A30` daje 4,46:1 s bijelom (AA traži 4,5) | `globals.css`, `v2.css` | Površine s tekstom koriste `#E3282E` (4,56:1), crveni tekst `#D92329`; tačan `#E52A30` ostaje za dekorativne elemente. RIJEŠENO |
| F-M10 | Landmarke, redoslijed naslova, imena kontrola, tabela bez fokusa | `Brand.tsx`, `UserMenu.tsx`, pcard naslovi | Ispravljeno. RIJEŠENO |
| F-M11 | `tsconfig.tsbuildinfo` u Gitu | repozitorij | Uklonjen i ignorisan. RIJEŠENO |
| F-M12 | Mrežni upis bez veze nije se oporavljao | `ItemEditor.tsx` | Vidi F-M05. RIJEŠENO |

## LOW

| ID | Nalaz | Status |
|---|---|---|
| F-L01 | Nema indeksa na `LunchVote.userId` (profil) | RIJEŠENO (migracija `…vote_user_index`) |
| F-L02 | `DEV_AUTH=true` u produkciji se tiho ignorisao | RIJEŠENO: glasan upis u log; test na produkcijskom buildu potvrđuje da je ruta ugašena |
| F-L03 | `clientIp` čita `x-forwarded-for`; iza nepouzdanog proxyja klijent može lažirati | OTVORENO: na Vercelu je zaglavlje pouzdano; vidi REMAINING-WORK |
| F-L04 | `npm audit`: 5 savjeta (postcss preko `next` ≤15.5.x, `deepmerge-ts` u Prisma lancu) | OTVORENO: nije eksploatabilno u ovoj aplikaciji (ne obrađuje se tuđi CSS); ispravka traži major nadogradnju Next-a |
| F-L05 | Admin stranica feedbacka učitava sve odgovore bez straničenja | RIJEŠENO djelimično: lista odgovora ograničena na 50, ali statistika čita sve odgovore; prihvatljivo za desetke do nekoliko hiljada odgovora |

## IMPROVEMENT

| ID | Poboljšanje | Status |
|---|---|---|
| F-I01 | Korisnik u profilu vidi svoje odgovore (samo čitanje) | URAĐENO |
| F-I02 | Popunjenost forme i postotak odgovora po pitanju, samo iz stvarnih podataka | URAĐENO |
| F-I03 | Vraćanje događaja, pitanja i opcije iz arhive | URAĐENO |
| F-I04 | Jednokratna baza, migracije od nule i testovi nadogradnje u harnessu | URAĐENO |
| F-I05 | Glasan zapis konfiguracijskih grešaka | URAĐENO |

## Matrica pokrivenosti zahtjeva

| Faza | Zahtjev | Stanje | Dokaz |
|---|---|---|---|
| 0 | Audit | Urađeno | ovaj dokument |
| 1.1 | Čuvanje historije odgovora | Urađeno | F-C01 |
| 1.2 | Opcija pripada anketi | Urađeno | F-C02 |
| 1.3 | Utrke glasanja | Urađeno | F-H01 |
| 1.4 | Konkurentnost feedbacka | Urađeno | F-H06 |
| 1.5 | Brisanje, retencija, backup | Urađeno | SECURITY.md, DEPLOYMENT.md |
| 2.1 | Google prijava za sve | Kod gotov, stvarni OAuth NIJE testiran | REMAINING-WORK |
| 2.2 | Admin samo `hr@eestec-sa.ba` | Urađeno (uloga iz sesije) | `roles.test`, `api.test`, `auth-security` |
| 2.3 | Životni ciklus sesije | Djelimično: nevažeća sesija, callback greška, logout, return-to testirani; istek i refresh stvarne sesije nisu | TEST-RESULTS |
| 2.4 | DEV_AUTH | Urađeno | `auth-security` (produkcijski build) |
| 2.5 | Životni ciklus korisnika | Urađeno | F-M06, F-H04 |
| 3 | Privatnost feedbacka | Urađeno | SECURITY.md, `api`, `journeys` |
| 4 | Project vs Event | Zadržan `Project` | ARCHITECTURE.md |
| 5 | Životni ciklus događaja | Urađeno | F-M01, F-M02, `journeys` |
| 6 | Urednik agende | Urađeno | F-M04, F-M05 |
| 7 | Ankete za ručak | Urađeno | F-H01, F-H02 |
| 8 | Feedback builder i analitika | Urađeno | F-C01, F-I02 |
| 9 | Dizajn i UX | Urađeno uz mjerenje na 6 širina | `ui-edge` |
| 10 | Pristupačnost | axe čist; ručni pregled čitačem NIJE rađen | TEST-RESULTS |
| 11 | Performanse i kvalitet | Pregledano, indeks dodan | F-L01, F-L05 |
| 12 | Sigurnost | Urađeno; CSP nije | F-H05, F-M08 |
| 13 | Migracije i isporuka | Urađeno | DEPLOYMENT.md, `migrations` |
| 14 | Testovi | Urađeno | TEST-RESULTS.md |
| 15 | Putovanja | Urađena u pregledaču sa simuliranom prijavom | `journeys` |
| 16 | Dokumentacija | Urađeno | `docs/` |
| 17 | Git | Vidi TEST-RESULTS.md i isporuku | |
