# Arhitektura

Next.js 15 (App Router), React 19, TypeScript, Prisma 6, PostgreSQL, Auth0 (`@auth0/nextjs-auth0` v4), Zod.

## Struktura

```
prisma/schema.prisma            model podataka
prisma/migrations/              verzionirane migracije
src/lib/roles.ts                computeRole (čista funkcija)
src/lib/session.ts              getCurrentUser, requireUser, requireAdminPage, assertAdmin, sameOrigin
src/lib/status.ts               prelazi i pravila vidljivosti statusa događaja
src/lib/ratelimit.ts            distribuirano ograničenje brzine (PostgreSQL)
src/lib/overlaps.ts             preklapanje termina agende
src/middleware.ts               Auth0 rute, obrada neuspjele prijave
src/app/e/[project]/            javni portal (Agenda, Lunch Poll, Feedback)
src/app/profile/                profil korisnika
src/app/admin/                  admin aplikacija + server akcije (actions.ts)
src/app/api/vote|feedback       javni mutacioni endpointi
src/app/api/admin/*/csv         CSV izvozi (samo ADMIN)
scripts/test-all.mjs            harness za testove (jednokratna baza + serveri)
```

## Model podataka

```
User ──< LunchVote >── LunchOption >── LunchPoll >── Project ──< Agenda ──< AgendaItem
User ──< FeedbackResponse ──< FeedbackAnswer >── FeedbackQuestion >── FeedbackForm >── Project
RateLimit (samostalna tabela)
```

Ključna pravila (u bazi, ne samo u kodu):

| Pravilo | Mehanizam |
|---|---|
| Jedan glas po korisniku po anketi | `UNIQUE (pollId, userId)` |
| Opcija pripada anketi glasa | složeni FK `(pollId, optionId) → LunchOption(pollId, id)` |
| Pitanje i odgovor su iz iste forme | složeni FK-ovi `(formId, questionId)`, `(formId, responseId)` |
| Jedan odgovor po pitanju u odgovoru | `UNIQUE (responseId, questionId)` |
| Brisanje pitanja/opcije s podacima je blokirano | FK `NO ACTION`, `DEFERRABLE INITIALLY DEFERRED` (kaskadno brisanje forme/ankete/događaja i dalje radi) |
| Slug događaja je jedinstven, slug agende jedinstven po događaju | `UNIQUE` |
| Identitet je `auth0Sub`, ne email | `UNIQUE (auth0Sub)`, email nije jedinstven |

### Kodiranje stanja glasova
`userId` postavljen → glas računa. `userId NULL` i `voterHash` postavljen → stari anonimni glas (prije prelaska na račune).
Oba `NULL` → glas korisnika koji je naknadno obrisan. Admin ih prikazuje odvojeno.

### Odgovori i snimak pitanja
Odgovor čuva `questionLabel`, `questionType`, `questionOptions` iz trenutka slanja. Izmjena pitanja ne mijenja značenje historije.
Anonimni odgovori imaju `userId NULL` i `createdAt` zaokružen na dan.

## Project ili Event?

**Odluka: zadržan je jedan model `Project`.** Razlozi:

- Svi traženi slučajevi (HOBOM, JobFair, General Assembly, radionice, više godina) su događaji s istim sadržajem: više agendi, više anketa, više formi.
  Godina je dio naziva i linka (`jobfair-2027`), a duplikat događaja je šablon za sljedeću godinu.
- Slučaj „JobFair 2027 sadrži HOBOM i radionice” se rješava kao zasebni događaji s povezanim nazivima. Posebna veza roditelj/dijete
  ne bi omogućila nijednu radnju koju trenutno ne možemo izvesti, a svaka od njih bi dobila dodatnu stranicu, status i pravila prava.
- Razdvajanje `Project`/`Event` bi tražilo migraciju svih URL-ova (`/e/<slug>`), svih relacija i testova bez mjerljive koristi.

Kad bude potrebno (npr. zajednički izvještaj za cijeli JobFair), moguće je dodati opcionalno polje `seriesId` bez promjene postojećih ruta.

## Životni ciklus događaja

```
DRAFT ──► PUBLISHED ──► COMPLETED ──► ARCHIVED
  ▲  ◄──────┘  ▲  ◄───────┘              │
  └────────────┴── vraćanje (restore) ◄───┘   (ARCHIVED → COMPLETED ili DRAFT)
```

| Status | Javno vidljiv | Glasanje | Feedback |
|---|---|---|---|
| DRAFT | samo admin (pregled) | ne | ne |
| PUBLISHED | da | da | da |
| COMPLETED | da | ne | da |
| ARCHIVED | da, samo čitanje | ne | ne |

Prelazi se provjeravaju na serveru (`status.ts`), pod `FOR UPDATE` zaključavanjem reda događaja.

## Tok zahtjeva

- **Javna stranica:** server komponenta čita iz baze. Nacrt se za sve osim admina ponaša kao nepostojeći (404).
- **Glasanje i feedback:** `POST /api/vote|feedback`: provjera `Origin`, sesija, distribuirani limit, Zod validacija, jedna transakcija sa zaključavanjem.
- **Admin:** svaka stranica poziva `requireAdminPage()`, svaka akcija `guard()` (`assertAdmin()` + limit), svaka admin API ruta provjerava `role === "ADMIN"`.
- **Greške:** akcije vraćaju `{ ok: false, error }` (poruka za korisnika, bez detalja baze); nepredviđene greške se bilježe bez podataka iz zahtjeva.

## Klijentske komponente (jedine koje šalju JavaScript)

`ItemEditor` (autosave, povlačenje, tastatura), `AForm`/`ConfirmButton`/`Toast`, `PollClient`, `FeedbackClient`, `Tabs`/`AdminNav`,
`CopyLink`, `SignInButton`, `StatusSelect`, `QuestionMove`. Sve ostalo je server komponenta.

## Performanse

- Javne stranice rade jedan do tri upita (događaj + relacije, glasovi korisnika). Brojevi glasova se računaju `_count`, bez učitavanja redova.
- `getCurrentUser()` je keširan po zahtjevu (`React.cache`); upis u `User` se dešava samo pri promjeni podataka ili nakon 15 minuta.
- Indeksi: `(pollId, optionId)`, `userId`, `(formId, position)`, `questionId`, `(agendaId, position)`, `status`.
- Prva isporuka JavaScripta po stranici je 103 do 110 kB (vidi izlaz `next build`).
- Poznato: statistika feedbacka čita sve odgovore forme (vidi REMAINING-WORK).
