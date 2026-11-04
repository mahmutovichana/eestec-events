# Isporuka

## Provjerna lista okruženja

| Varijabla | Obavezno | Opis |
|---|---|---|
| `DATABASE_URL` | da | PostgreSQL 14+ connection string |
| `AUTH0_DOMAIN` | da | npr. `eestec.eu.auth0.com` |
| `AUTH0_CLIENT_ID` | da | Regular Web Application |
| `AUTH0_CLIENT_SECRET` | da | tajna |
| `AUTH0_SECRET` | da | `openssl rand -hex 32`; šifruje sesiju i služi za HMAC ključeva |
| `APP_BASE_URL` | da | javni URL (`https://…`), bez završne kose crte |
| `ADMIN_EMAIL` | ne | zadano `hr@eestec-sa.ba` |
| `DEV_AUTH` | **nikad u produkciji** | samo lokalno; u produkciji se ignoriše uz upozorenje u logu |
| `RATE_LIMIT_SCALE` | **nikad u produkciji** | samo testovi |

## Auth0 lista

1. Applications → Create Application → **Regular Web Applications**.
2. Allowed Callback URLs: `https://DOMEN/auth/callback` (+ `http://localhost:3000/auth/callback` za razvoj).
3. Allowed Logout URLs: `https://DOMEN` (+ lokalni).
4. Authentication → Social → **Google**: koristi vlastite Google OAuth ključeve (ne Auth0 razvojne). Uključi samo za ovu aplikaciju.
5. Ugasi Username-Password konekciju za ovu aplikaciju (admin identitet mora biti Google).
6. Provjeri da Google vraća `email` i `email_verified`.
7. Prva prijava `hr@eestec-sa.ba` ručno: nakon nje `/admin` mora raditi, a drugi Google račun mora dobiti stranicu „Nema pristupa”.

## PostgreSQL

- Verzija 14 ili novija (koristi se `FOR SHARE`, advisory lockovi, `make_interval`).
- Uloga aplikacije treba `SELECT/INSERT/UPDATE/DELETE` na tabele i `USAGE` na sekvence; migracije pokreće uloga s pravom `CREATE/ALTER`.
- Neon/Supabase: za migracije koristi **direktnu** konekciju, za aplikaciju može i pooled. Pri `pgbouncer` modu transakcija dodaj `?pgbouncer=true`
  u `DATABASE_URL` aplikacije. Korišćeni lockovi su transakcijski (`FOR SHARE`, `pg_advisory_xact_lock`) i rade kroz pooler.
- Uključi automatske sigurnosne kopije i point-in-time recovery kod pružaoca.

## Vercel

1. Importuj repozitorij; framework Next.js; Node 20+.
2. Postavi varijable iz tabele iznad (bez `DEV_AUTH` i `RATE_LIMIT_SCALE`).
3. Prije prvog deploya primijeni migracije (vidi ispod), pa deploy. `postinstall` generiše Prisma klijent, a `binaryTargets` uključuje Linux.
4. Provjeri nakon deploya: `/` (200), `/admin` bez prijave (preusmjerava na prijavu), `/dev-login` (404), zaglavlja (`curl -I`).

## Migracije

Uvijek `prisma migrate deploy`, nikad `db push`.

```bash
# 1. Sigurnosna kopija PRIJE migracije
pg_dump "$DATABASE_URL" -Fc -f backup-$(date +%Y%m%d-%H%M).dump

# 2. Primjena
DATABASE_URL="…" npx prisma migrate deploy

# 3. Provjera
DATABASE_URL="…" npx prisma migrate status
```

- **Nova prazna baza:** `migrate deploy` primjenjuje sve migracije redom.
- **Baza napravljena ranije s `db push`:** jednom `npx prisma migrate resolve --applied 0_init`, pa `migrate deploy`. Provjereno na bazi sa starim glasovima i feedbackom
  (HIDDEN → DRAFT, TEXT → LONG_TEXT, snimak pitanja popunjen, stari anonimni glasovi sačuvani).
- Migracije su samo dodatne: nema `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` ni `DELETE` nad korisničkim podacima (testirano). `integrity_and_history` se
  **zaustavlja bez promjena** ako podaci krše nova pravila (poruka objašnjava šta ispraviti).
- Ne primjenjuj migracije na produkcijsku bazu bez izričitog odobrenja i svježe kopije.

## Oporavak

Prisma migracije nemaju automatski „down”. Postupak vraćanja:

1. Zaustavi aplikaciju (ili stavi u održavanje).
2. Vrati kopiju: `pg_restore --clean --if-exists -d "$DATABASE_URL" backup-….dump`.
3. Vrati prethodnu verziju aplikacije (prethodni deployment na Vercelu).
4. Provjeri `prisma migrate status`: vraćena baza treba pokazati samo migracije koje su postojale u kopiji.

Vježbaj ovaj postupak na kopiji prije prvog produkcijskog upgrade-a.

## Lokalni razvoj

```bash
npm install
docker compose up -d
cp .env.example .env       # popuni; za razvoj bez Auth0 postavi DEV_AUTH="true"
npx prisma migrate deploy
npm run db:seed
npm run dev
```

## Provjere prije izdanja

```bash
npm run typecheck && npm run lint && npm run build
npm test                    # cijeli skup, jednokratna baza (traži Docker i Chrome)
npm run test:unit           # samo brzi testovi bez baze
```
