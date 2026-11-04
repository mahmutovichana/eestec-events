# Sigurnost i privatnost

Dokument opisuje stvarno ponašanje aplikacije. Ono što nije provjereno ili nije implementirano navedeno je izričito.

## Autentikacija

- Prijava: Google preko Auth0 (`connection=google-oauth2`). Sesiju drži Auth0 SDK u šifrovanom `HttpOnly` kolačiću.
- Sesija: kliznuća, tvrda granica 7 dana, istek nakon 24 h neaktivnosti, `SameSite=Lax`, `Secure` u produkciji (`src/lib/auth0.ts`).
- Povratak nakon prijave (`returnTo`): `loginUrl()` prihvata samo putanje koje počinju s `/` (ne `//`); SDK odbija vanjske adrese (provjereno testom).
- Neuspjela prijava (odbijena saglasnost, neispravan `state`): `middleware.ts` vodi na `/?prijava=neuspjela` umjesto golog 500 odgovora.
- Odjava: `GET /auth/logout` (Auth0 SDK) briše sesiju.
- Lokalni korisnik se kreira/ažurira iz verifikovanih tvrdnji sesije (`sub`, email, `email_verified`, ime, slika). Stabilni identitet je Auth0 `sub`.
  Email nije jedinstven, da neverifikovan račun s tuđim emailom ne bi mogao blokirati prijavu pravog korisnika.

## Autorizacija

| Uloga | Kako se dobija |
|---|---|
| Guest | nema sesije |
| User | bilo koja važeća sesija |
| Admin | `email_verified = true`, `sub` počinje s `google-oauth2` i znakom `|`, email jednak `ADMIN_EMAIL` (`hr@eestec-sa.ba`) |

- Uloga se **računa na serveru** iz potpisane Auth0 sesije pri svakom zahtjevu (`computeRole`). Klijent nikad ne šalje ulogu, email ni userId.
- Provjere: `requireAdminPage()` (stranice), `guard()` → `assertAdmin()` (svaka od 27 server akcija, prije prvog upita; statički test),
  `getCurrentUser()` + `role === "ADMIN"` (CSV rute). UI vidljivost nije mehanizam autorizacije.
- IDOR: privatni upiti su filtrirani po `userId` iz sesije (profil); admin rute provjeravaju ulogu prije pristupa; nacrt događaja je 404 za sve osim admina
  na svim javnim rutama i API-ju.
- CSRF: server akcije imaju Next.js provjeru porijekla; API POST rute zahtijevaju `Origin` jednak hostu (`sameOrigin`).
- **Razvojna prijava** (`DEV_AUTH`, `/dev-login`) je ugašena kad je `NODE_ENV=production`, bez obzira na varijablu. Ako je varijabla postavljena u produkciji,
  server to glasno zapisuje u log i ignoriše je. Produkcijski build je testiran: `/dev-login` vraća 404, a dev kolačić ne daje pristup.

## Ograničenje brzine

Stanje je u PostgreSQL tabeli `RateLimit` (atomaran upsert), pa vrijedi za sve serverless instance.

| Tačka | Limit | Ključ |
|---|---|---|
| `POST /api/vote` | 30 / min | korisnik |
| `POST /api/feedback` (identificirano) | 10 / sat / forma | korisnik |
| `POST /api/feedback` (anonimno) | 10 / sat / forma | IP |
| Admin akcije | 240 / min | admin korisnik |

Ključ je HMAC (`AUTH0_SECRET`) identiteta, nikad sirova IP ni userId. Redovi se brišu nakon isteka prozora (dnevno čišćenje).
Za anonimni feedback to je jedini podatak vezan za IP i traje najviše jedan sat.

## Privatnost feedbacka

- **Anonimno:** server uopće ne čita sesiju; odgovor nema `userId`; `createdAt` je zaokružen na dan (UTC); admin ne vidi identitet; CSV nema kolone identiteta.
  Logovi aplikacije ne zapisuju sadržaj zahtjeva.
- **Identificirano:** traži prijavu; odgovor je vezan za korisnika; admin vidi ime i email; opcionalno jedan odgovor po korisniku (advisory lock u transakciji).
- Učesnik vidi način prikupljanja **prije** slanja, a klijent šalje `acknowledgedMode`: ako se način u međuvremenu promijenio, server odbija slanje (409).
- Način se **ne može promijeniti** kad forma ima odgovore (provjera pod `FOR UPDATE`, nema utrke s upisom odgovora).
- Poslani odgovori se ne mijenjaju: ni korisnik ni admin ne uređuju odgovore. Korisnik svoje identificirane odgovore može pregledati u profilu.
- Ograničenje: anonimni feedback se ne vezuje za osobu, pa ga ista osoba može poslati više puta (ograničeno brzinom po IP-u). Za tačno jedan odgovor po osobi koristi identificiranu formu.

## Pravila čuvanja podataka

| Podatak | Pravilo |
|---|---|
| Pitanje s odgovorima | arhivira se, ne briše; odgovori ostaju u statistici i CSV-u |
| Opcija ručka s glasovima | arhivira se, ne briše; naziv se ne mijenja |
| Događaj | briše se samo iz Nacrta ili Arhive, uz upis tačnog naziva |
| Anketa / forma s podacima | brisanje traži upis `OBRIŠI` |
| Reset glasova, brisanje svih odgovora | traži upis `OBRIŠI`; preporučen prethodni CSV izvoz |
| Korisnik (`User`) | nema UI za brisanje; brisanje reda postavlja `userId` na NULL u glasovima i odgovorima (podaci ostaju, identitet nestaje) |
| `RateLimit` | brišu se redovi stariji od jednog dana |
| Anonimni odgovori | trajno, bez identiteta, do ručnog brisanja |

Zahtjev za brisanje korisnika (GDPR): `DELETE FROM "User" WHERE "auth0Sub" = '…'`. Glasovi i identificirani odgovori ostaju bez identiteta.
Ako treba obrisati i njih, obrisati prvo `LunchVote`/`FeedbackResponse` s tim `userId`.

## Ulaz i izlaz

- Svi API ulazi se validiraju Zod šemama; server akcije validiraju polja (vrijeme `HH:MM`, dužine, enumi).
- SQL: Prisma parametrizovani upiti; sirovi SQL (`$queryRaw`) koristi isključivo tagged template s parametrima.
- XSS: React escape; nigdje se ne koristi `dangerouslySetInnerHTML`.
- CSV: ćelije koje počinju s `= + - @ TAB CR` dobijaju prefiks `'`; navodnici i zarezi se pravilno escapuju (test).
- Greške: korisnik dobija opću poruku; detalji baze se ne vraćaju (test s nedostupnom bazom).
- Zaglavlja: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`;
  `Cache-Control: no-store` na `/admin`, `/profile`, `/api`. **CSP nije uključen** (Next.js koristi inline skripte; nonce CSP je zasebna ispravka, vidi REMAINING-WORK).

## Tajne

- Tajne su samo u okruženju (`.env` je u `.gitignore`). `.env.example` sadrži samo prazna mjesta.
- Git historija je pretražena: nema tajni. Ako se tajna ikad objavi, obavezno je rotirati je (Auth0 client secret, `AUTH0_SECRET`, lozinka baze).
- `AUTH0_SECRET` se koristi i za HMAC ključeva ograničenja brzine; rotacija poništava samo brojače.

## Zavisnosti

`npm audit` (produkcija): 5 savjeta (postcss preko `next`, `deepmerge-ts`). Procjena: aplikacija ne obrađuje CSS iz nepouzdanog izvora, pa nije
eksploatabilno; ispravka traži major nadogradnju. Pratiti `next@15` zakrpe.
