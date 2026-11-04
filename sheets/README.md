# EESTEC Events — jednostavna verzija (React + Google Apps Script + Google Sheets)

Zamjena za složenu arhitekturu (Next.js, PostgreSQL, Prisma, Auth0, Vercel). Isti proizvod: događaji, agende, ručak, feedback, admin, rezultati, CSV, javni linkovi. Podaci su u jednoj Google tabeli.

**Zašto nije jedan Claude Artifact:** Artifact ne može sigurno provjeriti Google identitet ni čuvati podatke u Google Sheets. Objašnjenje i dokazi u [docs/FEASIBILITY.md](docs/FEASIBILITY.md). Najbliža sigurna alternativa je statična React stranica + Apps Script.

| Dokument | Sadržaj |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | **počnite ovdje**: postavljanje korak po korak, Google Cloud i Apps Script postavke, šta radite ručno |
| [docs/FEASIBILITY.md](docs/FEASIBILITY.md) | šta Artifact može/ne može, Apps Script identitet, CORS, kvote |
| [docs/SECURITY.md](docs/SECURITY.md) | administratori (list `Admins`), autorizacija, oporavak pristupa |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | listovi, API, sigurnosni model, poređenje sa starom aplikacijom |
| [docs/LEGAL.md](docs/LEGAL.md) | Politika privatnosti i Uslovi korištenja, tačni URL-ovi za Google Branding, odluke koje treba potvrditi |
| [docs/RETENTION.md](docs/RETENTION.md) | rok čuvanja 24 mjeseca, anonimizacija, zahtjevi za brisanje, dnevnik revizije |
| [docs/INTEGRATION-CHECKLIST.md](docs/INTEGRATION-CHECKLIST.md) | provjera sa stvarnim Googleom: šta je urađeno, šta traži vaš pristup |
| [docs/MIGRATION.md](docs/MIGRATION.md) | prenos HOBOM-a iz stare baze |
| [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md) | šta je testirano, šta nije (i zašto) |

## Brzi početak za programere

```
npm run sheets:build     # izgradi frontend (sheets/web/dist)
npm run sheets:dev       # lokalni server s lažnim Googleom na http://127.0.0.1:8787
npm run sheets:test      # 113 testova (backend, administratori, migracija, Chrome UI)
```

U dev serveru prijava se simulira u konzoli preglednika: `localStorage.eestecTestToken = "<ispisani token>"`. Ovo radi samo uz lažni server; pravi backend takav token odbija.

Stara aplikacija (`src/`, `prisma/`) je ostala netaknuta.
