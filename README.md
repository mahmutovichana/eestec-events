# EESTEC Events

Platforma za događaje EESTEC LC Sarajevo (HOBOM, JobFAIR, General Assembly, radionice): agende, anketa za ručak i feedback.
Isti kod se koristi iz godine u godinu: novi događaji, agende, ankete i forme se prave u admin panelu, bez izmjene koda.

Next.js 15 · React 19 · TypeScript · Prisma 6 · PostgreSQL · Auth0 (Google) · Zod

## Šta radi

- **Javni portal** `/e/<link>`: tabovi Agenda, Lunch Poll i Feedback. Agenda se čita bez prijave. Svaka agenda ima svoj link `/e/<link>/agenda/<agenda>`.
- **Prijava:** bilo koji Google račun preko Auth0. **Admin** je samo verifikovan Google identitet `hr@eestec-sa.ba`; uloga se računa na serveru.
- **Ručak:** glasaju prijavljeni, jedan glas po osobi (jedinstven ključ u bazi), promjena glasa dok je anketa otvorena, rezultati po postavci, CSV.
- **Feedback:** način po formi, **anonimno** ili **identificirano**, prikazan učesniku prije slanja i zaključan nakon prvog odgovora. Pet tipova pitanja, statistika, CSV.
- **Admin:** pregled, događaji (kreiranje, uređivanje, dupliciranje kao šablon, objava, završavanje, arhiviranje, vraćanje, brisanje), urednik agende s autosaveom i
  povlačenjem, ankete, forme, učesnici.
- **Historija se čuva:** pitanja s odgovorima i opcije s glasovima se arhiviraju, ne brišu; odgovori čuvaju snimak pitanja.

## Pokretanje

```bash
npm install
docker compose up -d              # PostgreSQL na portu 5433
cp .env.example .env              # popuni; za razvoj bez Auth0: DEV_AUTH="true"
npx prisma migrate deploy
npm run db:seed                   # primjer HOBOM
npm run dev
```

Bez Auth0 računa `DEV_AUTH="true"` uključuje `/dev-login?as=admin|user|user2|fake` (simulirana sesija). Ugašeno je u produkciji.

## Provjere

```bash
npm run typecheck && npm run lint && npm run build
npm test            # cijeli skup nad jednokratnom bazom (traži Docker i Chrome)
npm run test:unit   # brzi testovi bez baze
```

## Dokumentacija

| Dokument | Sadržaj |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | struktura, model podataka, životni ciklus događaja, odluka Project vs Event |
| [docs/SECURITY.md](docs/SECURITY.md) | autentikacija, autorizacija, privatnost, čuvanje podataka, ograničenja |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | okruženje, Auth0, PostgreSQL, Vercel, migracije, backup, oporavak |
| [docs/FINAL-AUDIT.md](docs/FINAL-AUDIT.md) | nalazi audita i matrica zahtjeva |
| [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md) | tačni rezultati testova |
| [docs/REMAINING-WORK.md](docs/REMAINING-WORK.md) | preostalo i poznata ograničenja |

## Brend

Crvena `#E52A30` (dekorativno), `#E3282E` za površine s tekstom (AA kontrast 4,56:1; tačan `#E52A30` daje 4,46:1 s bijelom), tamno siva `#333333`, Montserrat.
