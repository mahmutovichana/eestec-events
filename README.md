# EESTEC Events

Platforma za događaje EESTEC LC Sarajevo (HOBOM, JobFAIR, radionice, General Assembly): agende, anketa za ručak i feedback. Isti kod se koristi iz godine u godinu, bez izmjene izvornog koda za nove događaje.

Stack: Next.js 15 (App Router), React 19, Prisma 6, PostgreSQL, Auth0 (`@auth0/nextjs-auth0` v4).

## Arhitektura

```
prisma/schema.prisma        model podataka
prisma/migrations/          verzionirane migracije (0_init = baseline, zatim platform_v2 ...)
src/lib/roles.ts            čista funkcija computeRole (testirana)
src/lib/session.ts          getCurrentUser, requireUser, requireAdminPage, assertAdmin, sameOrigin
src/app/e/[project]/        javni portal: Agenda, Lunch Poll, Feedback
src/app/profile/            profil korisnika
src/app/admin/              admin aplikacija + server akcije (actions.ts)
src/app/api/vote            glasanje (samo prijavljeni)
src/app/api/feedback        slanje feedbacka (anonimno ili identificirano)
src/app/api/admin/.../csv   CSV izvozi (samo ADMIN)
```

Model: `User`, `Project` (događaj) → `Agenda` → `AgendaItem`; `LunchPoll` → `LunchOption`, `LunchVote`; `FeedbackForm` → `FeedbackQuestion`, `FeedbackResponse` → `FeedbackAnswer`.

Statusi događaja: **Nacrt** (vidi samo admin, pregled prije objave), **Objavljen** (sve otvoreno), **Završen** (glasanje zatvoreno, feedback otvoren), **Arhiviran** (samo čitanje preko linka).

## Autentikacija i autorizacija

- Bilo koji Google račun se može prijaviti preko Auth0. Javne stranice se čitaju bez prijave.
- Nakon prijave `getCurrentUser()` kreira ili ažurira lokalnog korisnika (Auth0 `sub`, email, verifikovanost, ime, slika, vremena).
- Uloge: Guest (bez sesije), User, Admin. Admin je **isključivo** verifikovan Google identitet (`sub` počinje s `google-oauth2|`, `email_verified = true`) čiji je email jednak `ADMIN_EMAIL` (`hr@eestec-sa.ba`). Uloga se računa na serveru iz potpisane Auth0 sesije pri svakom zahtjevu. Klijent nikad ne šalje ulogu, email ni userId.
- Svaka admin stranica poziva `requireAdminPage()`, svaka server akcija `guard()` (→ `assertAdmin()` + ograničenje brzine) kao prvu naredbu, svaka admin API ruta provjerava `role === "ADMIN"`. Statički test provjerava da nijedna akcija nema pristup bazi prije `guard()`.
- API POST rute provjeravaju da `Origin` odgovara hostu (zaštita od cross-site zahtjeva).
- `email` na korisniku nije unique. Samo `auth0Sub` je. Tako neverifikovan račun s tuđim emailom ne može blokirati prijavu pravog korisnika.

## Glasanje za ručak

Samo prijavljeni korisnici. Jedan glas po korisniku po anketi je zaštićen unique ključem `(pollId, userId)` u bazi. Promjena glasa je moguća dok je anketa otvorena i ako je admin uključio `allowChange`. Rezultati se prikazuju kad se anketa zatvori, a prije toga samo ako je uključeno "prikaži rezultate i prije zatvaranja". Admin vidi ko je glasao za šta i može izvesti CSV. Stari anonimni glasovi iz prethodne verzije su sačuvani (`userId = NULL`) i u adminu su označeni kao "stari anonimni".

## Feedback

Način se bira po formi:

- **Anonimno**: sesija se ne čita, `userId` je uvijek NULL, vrijeme se zaokružuje na dan, admin ne vidi identitet, CSV nema kolone identiteta.
- **Identificirano**: traži Google prijavu, odgovor je vezan za korisnika, admin vidi odgovore i identitete, opcionalno jedan odgovor po korisniku (provjera unutar transakcije s advisory lockom).

Učesnik vidi način prikupljanja prije slanja, a server odbija slanje ako se način u međuvremenu promijenio. Način se ne može promijeniti kad forma već ima odgovore. Tipovi pitanja: ocjena 1–5, jedan izbor, više izbora, kratak tekst, dug tekst. Pitanja se mogu dodavati, mijenjati, preraspoređivati, činiti obaveznim, isključiti i brisati. Admin vidi prosjeke, raspodjele, grafikone, odgovore i CSV (s neutralizacijom formula).

## Lokalno pokretanje

```bash
npm install
docker compose up -d              # Postgres na portu 5433
cp .env.example .env              # popuni vrijednosti
npx prisma migrate deploy         # primijeni migracije
npm run db:seed                   # HOBOM primjer
npm run dev
```

Bez Auth0 računa postavi `DEV_AUTH="true"` u `.env`. Tada `/dev-login?as=admin|user|user2|fake` simulira prijavu. To je isključeno kad je `NODE_ENV=production`, bez obzira na vrijednost.

Prisma klijent se generiše u `src/generated/prisma` (`npm install` to radi automatski).

## Migracije

Koristi se `prisma migrate deploy`, ne `db push`.

- `0_init`: baseline prethodne šeme. Na bazi koja je već napravljena s `db push` jednom pokreni `npx prisma migrate resolve --applied 0_init`, pa `npx prisma migrate deploy`. Na praznoj bazi samo `migrate deploy`.
- `20261104000000_platform_v2`: User, Role, FeedbackMode, novi statusi i tipovi pitanja, `LunchVote.userId`. Podatke čuva: `HIDDEN → DRAFT`, `TEXT → LONG_TEXT`, `showResults → showResultsWhileOpen`, stari glasovi ostaju s `userId = NULL`, stari feedback ostaje anoniman (vrijeme zaokruženo na dan).
- `20261104000100_user_email_not_unique`: uklanja unique na emailu.

Nova promjena šeme: izmijeni `schema.prisma`, pa `npx prisma migrate dev --name opis`.

## Auth0 podešavanje

1. Auth0 Dashboard → Applications → Create Application → **Regular Web Applications**.
2. Allowed Callback URLs: `http://localhost:3000/auth/callback` i `https://TVOJ-DOMEN/auth/callback`.
3. Allowed Logout URLs: `http://localhost:3000` i `https://TVOJ-DOMEN`.
4. Authentication → Social → uključi **Google** (preporučeno s vlastitim Google OAuth ključevima, ne Auth0 dev ključevima) i ugasi Username-Password konekciju za ovu aplikaciju.
5. U `.env` upiši `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` (`openssl rand -hex 32`) i `APP_BASE_URL`.

## Objava (Vercel + Neon ili Supabase)

1. Napravi Postgres bazu, stavi connection string u `DATABASE_URL`.
2. Postavi varijable iz `.env.example` u Vercel (bez `DEV_AUTH`). `APP_BASE_URL` je javni URL.
3. Prije prvog deploya: `DATABASE_URL=... npx prisma migrate deploy`. Zatim po želji `npm run db:seed`. Isto ponovi pri svakoj novoj migraciji.
4. Deploy. `binaryTargets` u šemi već uključuje Linux za Vercel.

## Testovi

```bash
# server s uključenim DEV_AUTH mora raditi
NEXT_DIST_DIR=.next-test npx next dev -p 3111
BASE_URL=http://localhost:3111 npm test
```

59 testova: uloge, statička provjera autorizacije akcija, API (glasanje, feedback, CSV, izvori identiteta, trke), i UI u Chrome-u (puppeteer-core: CRUD događaja i agendi, autosave, drag-and-drop, dijalozi potvrde, dupliranje, glasanje, feedback, profil, responzivnost na 390 px, osnovna pristupačnost). UI testovi traže Chrome (`CHROME_PATH`).

Ostale provjere: `npm run typecheck`, `npm run lint`, `npm run build`.

## Poznata ograničenja

- Prava Google prijava preko Auth0 nije testirana, jer traži Auth0 račun i ključeve. Testirani su logika uloga i svi tokovi uz simuliranu sesiju (`DEV_AUTH`). Prvu stvarnu prijavu admina provjeri ručno.
- Ograničenje brzine je u memoriji jedne instance (na Vercelu djelomična zaštita). Za jače ograničenje dodaj Redis (npr. Upstash). Prave zaštite su autorizacija i unique ključevi u bazi.
- Anonimni feedback nije vezan za račun, pa ga isti korisnik može poslati više puta (ograničeno brzinom po IP-u u memoriji). Ako je potreban tačno jedan odgovor po osobi, koristi identificiranu formu.
- Drag-and-drop radi s mišem. Za tastaturu i dodir postoje dugmad gore/dolje.
- Auth0 SDK ispisuje upozorenje "Critical dependency" pri buildu. Poznato je i bezopasno.
- Nije rađen potpuni automatski pregled pristupačnosti (npr. axe) ni testiranje na stvarnim mobilnim uređajima.
