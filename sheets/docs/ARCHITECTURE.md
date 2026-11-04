# Arhitektura (pojednostavljena verzija)

```
Preglednik (React, statični fajlovi na GitHub Pages)
   │  Google Identity Services → ID token (JWT, ~1 h)
   │  POST text/plain {action, ...podaci, idToken}
   ▼
Google Apps Script web app  (Execute as: vlasnik, Access: Anyone)
   │  provjera tokena kod Googlea → identitet (sub, email, email_verified)
   │  autorizacija, validacija, LockService, upis
   ▼
Google Sheets (jedini izvor istine; 11 listova)
```

Bez: PostgreSQL, Prisma, Auth0, Vercela, Next.js servera, migracija baze.

## Datoteke

| Putanja | Namjena |
|---|---|
| `sheets/apps-script/Code.gs` | cijeli backend (jedna datoteka, ~1200 redova) |
| `sheets/apps-script/appsscript.json` | manifest (V8, web app, minimalni scope-ovi) |
| `sheets/web/` | React + Vite frontend (`public/config.js` = jedino podešavanje) |
| `sheets/scripts/dev-server.mjs` | lokalni server: izgrađeni frontend + lažni Apps Script nad tabelom u memoriji |
| `sheets/scripts/export-from-postgres.mjs`, `legacy-map.mjs` | izvoz iz stare baze (samo čitanje) |
| `sheets/test/` | testovi (vidi TEST-RESULTS.md) |
| `.github/workflows/sheets-pages.yml` | objava na GitHub Pages |

Lokalni razvoj: `npm run sheets:build`, pa `npm run sheets:dev` (port 8787; prijava je simulirana, podaci su u memoriji).

## Listovi (Google Sheets)

Svaki red ima stabilan `id` (UUID); veze su preko ID-ova, nikad preko broja reda. Zaglavlja se prave sama (`setup()` ili pri prvom zahtjevu). Kolone se čitaju **po imenu**, pa redoslijed kolona ne smije biti problem. Ako verzija koda traži novu kolonu, `setup()` je dodaje na kraj (podaci ostaju). Sve ćelije su formatirane kao običan tekst, da Sheets ne pretvara `09:00` u vrijeme ni `=...` u formulu.

| List | Kolone |
|---|---|
| Events | id, slug, name, year, description, location, startDate, endDate, status, createdAt, updatedAt |
| Agendas | id, eventId, title, date, position, createdAt |
| AgendaItems | id, agendaId, startTime, endTime, title, description, speaker, location, position, version, notes, kind |
| Polls | id, eventId, title, description, status (OPEN/CLOSED), allowChange, resultsVisibility, position, createdAt |
| PollOptions | id, pollId, name, description, allergens, position, archived |
| Votes | id, pollId, optionId, userSub, userEmail, userName, createdAt, updatedAt |
| FeedbackForms | id, eventId, title, description, mode (ANONYMOUS/IDENTIFIED), status, position, createdAt |
| FeedbackQuestions | id, formId, label, type, options (JSON), required, position, archived |
| FeedbackResponses | id, formId, submissionId, userSub, userEmail, userName, createdAt |
| FeedbackAnswers | id, responseId, formId, questionId, questionLabel, questionType, questionOptions, value |
| Settings | key, value (javno čitljivo samo: siteTitle, organization, contactEmail) |
| Admins | email, active, addedAt, addedBy, sub (privatno; samo admin akcije; vidi SECURITY.md) |

Administratori su namjerno odvojeni od vlasništva nad tabelom: skripta radi kao vlasnik (`Execute as: Me`), a ko je administrator određuje samo list `Admins`. Ostali administratori ne trebaju pristup Drive-u.

List `Users` nije potreban: identitet dolazi iz tokena, a ime/email se upisuju uz glas ili identificirani odgovor.

Slojevi pravila (u kodu, jer Sheets nema ograničenja):
- jedan glas po (pollId, userSub): provjera unutar `LockService` brave;
- opcija mora imati `pollId` jednak anketi glasa i ne smije biti arhivirana;
- glasanje samo kad je događaj `PUBLISHED` i anketa `OPEN`; feedback kad je događaj `PUBLISHED` ili `COMPLETED` i forma `OPEN`;
- prelazi statusa događaja: Nacrt→Objavljen/Arhiviran, Objavljen→Nacrt/Završen/Arhiviran, Završen→Objavljen/Arhiviran, Arhiviran→Završen/Nacrt;
- **historija odgovora:** svaki odgovor čuva `questionLabel/Type/Options` iz trenutka slanja; pitanje s odgovorima se arhivira umjesto brisanja; opcija s glasovima isto;
- način forme (anonimno/identificirano) se ne mijenja kad postoje odgovori;
- brisanje s podacima traži upis `OBRIŠI`; trajno brisanje događaja samo iz Nacrta/Arhive uz tačan naziv.

## API (jedna adresa, `POST` JSON)

Javno (bez prijave): `listPublishedEvents`, `getEvent` (nacrt je 404; rezultati po pravilima vidljivosti), `submitFeedback` (anonimne forme).
Prijavljen korisnik: `whoami`, `submitVote`, `submitFeedback` (identificirane forme).
Samo admin: `listAdmins`, `addAdmin`, `setAdminActive`, `listAllEvents`, `createEvent`, `updateEvent`, `deleteOrArchiveEvent`, `manageAgenda`, `manageAgendaItems`, `managePoll`, `manageFeedbackForm`, `getAdminStatistics`, `exportResults`, `importSeed`.

Odgovor je uvijek `{ok:true,data}` ili `{ok:false,error:{code,message}}` (HTTP 200, to je ograničenje Apps Scripta). Kodovi: `BAD_REQUEST, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, CLOSED, MODE_CHANGED, RATE_LIMITED, BUSY, CONFIG, INTERNAL`.

## Sigurnosni model

- **Identitet:** samo iz Google ID tokena provjerenog kod Googlea (`aud` = naš Client ID, `iss`, `exp`). Email, uloga, `userSub`, lozinke iz tijela zahtjeva se ne čitaju (test: „klijent ne može nametnuti identitet“).
- **Admin:** ovjeren Google identitet čiji je email na listi aktivnih u listu `Admins` (+ vezani Google `sub`; opcionalno `ADMIN_EMAIL_DOMAINS`, `ADMIN_REQUIRE_HD`). Lista se čita pri svakom zahtjevu, pa je opoziv trenutan. Isti kod ide na svaku admin akciju prije čitanja podataka (testovi: 14 admin akcija × 13 vrsta lažnih/nevažećih identiteta, 8 pravih administratora, opozvani i dodani administratori). Detalji: `SECURITY.md`.
- **Nema tajni u kodu/frontendu:** Client ID je javan; nema client secreta. Test provjerava da `Code.gs` ne sadrži lozinke ni ključeve.
- **Pisanje:** sve mutacije pod `LockService.getScriptLock()`; ako se brava ne dobije za 20 s, odgovor je `BUSY` i ništa se ne upisuje.
- **Anonimni feedback:** token se uopće ne provjerava; u listu se ne upisuje identitet, uređaj ni IP (Apps Script IP ne vidi); vrijeme je zaokruženo na dan. Zaštita od zloupotrebe: honeypot polje, ograničenje po nasumičnoj oznaci uređaja (hash sa soli, samo u kešu do 6 h) i po formi. Oznaka uređaja se **ne** upisuje u tabelu.
- **Javni odgovori:** nikad ne sadrže emailove, `userSub` ni redove drugih korisnika; to je pokriveno testom.
- **CSV:** ćelije koje počinju s `= + - @ TAB CR` dobijaju prefiks `'`.
- **Ulaz:** tijelo ≤ 200 KB; sva polja validirana (dužine, enumi, `HH:MM`, datumi); ID-evi `[A-Za-z0-9-]{8,64}`; nepoznate akcije se odbijaju (uključujući `__proto__`, `constructor`).
- **Greške:** korisnik dobija opću poruku; stack trace ide samo u Apps Script log.
- **Frontend:** CSP kroz `<meta>` (script samo vlastiti + GIS; konekcije samo na Google), `strict-origin-when-cross-origin`. Token je u `sessionStorage` (briše se zatvaranjem taba), nikad u URL-u.

## Poređenje sa starom aplikacijom (parnost)

| Funkcija | Stara (Next.js) | Nova | Napomena |
|---|---|---|---|
| EESTEC izgled (crvena, tamno siva, Montserrat), responsivno | da | da | isti tokeni boja; AA kontrast (`#E3282E` za površine s tekstom) |
| Kartice događaja, više događaja i godina | da | da | |
| Kreiranje/uređivanje događaja, statusi, arhiva, trajno brisanje | da | da | |
| Više agendi, stavke, redoslijed | da | da | redoslijed gore/dolje; **povlačenje mišem nije preneseno** (pojednostavljenje, tastatura/dodir su ionako koristili dugmad) |
| Vrste stavki (sesija, pauza, obrok, kraj) i napomene | da | da | |
| Upozorenje o preklapanju termina | da | da | |
| Autosave i optimistički konflikt stavki | da (autosave) | konflikt da, autosave ne | eksplicitno „Sačuvaj“ po stavci |
| Ankete za ručak, alergeni, otvori/zatvori, izmjena glasa | da | da | |
| Vidljivost rezultata | 2 načina | 4 načina | Uvijek / nakon glasanja / nakon zatvaranja / samo admin |
| Glasači vidljivi adminu, reset glasova | da | da | |
| Feedback: ocjena, jedan/više izbora, kratki/dugi tekst, obavezno | da | da | |
| Anonimni i identificirani, privatnost, historija odgovora | da | da | |
| Statistika | prosjek, raspodjela, brojevi, tekstovi, % završenosti | prosjek, raspodjela, brojevi, tekstovi | **procenat završenosti nije preneseno** |
| CSV izvoz | da | da | |
| Javni linkovi | `/e/slug` | `#/e/slug` | hash rute zbog statičnog hostinga |
| Profil korisnika („moji odgovori“) | da | **ne** | nije preneseno; identificirane odgovore vidi admin |
| Dupliciranje događaja kao šablona | da | **ne** | nije preneseno |
| Stranica „Učesnici“ | da | **ne** (glasači u Rezultatima) | |
| Simulirana prijava za razvoj (`DEV_AUTH`) | da | **uklonjeno** | u produkciji ne postoji nikakav zaobilazni put; test-token radi samo u lažnom Google okruženju |
| Trajanje prijave | 24 h neaktivnosti / 7 dana | ~1 h (život Google ID tokena) | nakon isteka korisnik mora ponovo kliknuti „Prijava“; poruka to jasno kaže |
| Distribuirano ograničenje brzine u bazi | da | keš + brava | slabije (nema IP-a); dovoljno za obim |

## Gašenje starog sistema (preporuka, ne akcija)

Ništa se ne briše. Preporučeni redoslijed: (1) postaviti novu aplikaciju i odraditi korak 6 iz SETUP.md s pravim računima; (2) uvesti HOBOM (MIGRATION.md) i uporediti brojeve; (3) neko vrijeme držati obje; (4) tek tada, uz vaše izričito odobrenje, arhivirati staru bazu (`pg_dump`) i ugasiti Vercel/Auth0. Grana `feat/production-readiness-finalization` i cijeli stari kod ostaju u repozitoriju.

## Poznata ograničenja

Vidi `FEASIBILITY.md` §6 te: ID token traje ~1 h bez automatskog obnavljanja; `tokeninfo` poziv je mrežna ovisnost (kešira se 5 min); jedna aplikacija = jedna tabela; nema transakcija nad više listova (greška usred višekoračnog upisa može ostaviti djelimične redove, npr. kod trajnog brisanja događaja; zato je potvrda obavezna i Version history tabele je rezervna kopija); veće količine (hiljade redova) bi zahtijevale drugačiji pristup čitanju.
