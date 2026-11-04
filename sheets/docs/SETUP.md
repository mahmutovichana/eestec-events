# Postavljanje (za vlasnika tabele: hana.mahmutovic@eestec-sa.ba)

Ukupno oko 30–40 minuta. Sve radite pod računom **hana.mahmutovic@eestec-sa.ba**: tabela, skripta i Google Cloud projekt pripadaju tom računu.

Šta vam treba: taj Google račun i GitHub račun koji ima ovaj repozitorij.

U ovom postavljanju **nema tajni za unos** (nema lozinki ni client secreta). Client ID i adresa skripte su javni podaci. Nikome ne šaljite ključeve.

## Ko je administrator

Administratori su u listu **`Admins`** unutar tabele. Pri prvom pokretanju `setup()` upisuje osam računa:

`hr@`, `hana.mahmutovic@`, `chair@`, `pr@`, `it@`, `fr@`, `cp@`, `treasurer@` (svi `@eestec-sa.ba`).

- Ostali administratori **ne trebaju pristup tabeli** (ni Drive Editor). Prijave se Google računom na stranici; server provjerava da je njihov email na listi.
- Administratore kasnije dodajete i deaktivirate u aplikaciji: **Administracija → Administratori**.
- `setup()` upisuje početnu listu samo jednom. Ponovno pokretanje ne vraća deaktivirane administratore.
- Tabelu (list `Admins` i ostale) dijelite samo s osobama kojima potpuno vjerujete: urednik tabele može ručno promijeniti listu administratora. Ne dijelite je javno.

---

## Korak 1: Tabela

1. Prijavljeni kao `hana.mahmutovic@eestec-sa.ba`, na drive.google.com napravite novu **Google tabelu**, nazovite je `EESTEC Events`.
2. Ne dijelite je ni s kim (nije potrebno).

## Korak 2: Skripta (backend)

1. U tabeli: **Extensions → Apps Script**.
2. Obrišite postojeći kod, zalijepite cijeli sadržaj datoteke `sheets/apps-script/Code.gs`. Sačuvajte (Ctrl+S).
3. **Project Settings** (zupčanik) → uključite **Show "appsscript.json" manifest file in editor**. Vratite se u **Editor**, otvorite `appsscript.json` i zamijenite sadržaj sadržajem datoteke `sheets/apps-script/appsscript.json`. Sačuvajte.
4. **Project Settings → Script properties → Add script property**:
   | Property | Vrijednost | Obavezno |
   |---|---|---|
   | `CLIENT_ID` | Client ID iz koraka 3 (završava na `.apps.googleusercontent.com`) | **da** |
   | `ADMIN_EMAIL_DOMAINS` | npr. `eestec-sa.ba` | ne (vidi dolje) |
   | `ADMIN_REQUIRE_HD` | `true` | ne (vidi dolje) |

   `ADMIN_EMAIL` i `ADMIN_HD` iz ranije verzije **više ne postoje** i ignorišu se.
5. U editoru izaberite funkciju **`setup`** → **Run**. Prvi put traži dozvole: **Review permissions → hana.mahmutovic@eestec-sa.ba → Advanced → Go to ... (unsafe) → Allow**. Upozorenje je normalno za vlastitu skriptu. Skripta traži samo pristup ovoj tabeli i slanje zahtjeva prema Googleu.
6. Provjerite: pojavilo se 12 listova, a u `Admins` osam redova (`active` = 1). Log (View → Executions) kaže koliko je administratora upisano.

### Opcionalna ograničenja administratora (podrazumijevano isključena)

- **`ADMIN_EMAIL_DOMAINS`**: ako ga postavite (npr. `eestec-sa.ba`), administrator može biti samo email iz tih domena (više domena odvojite zarezom). Provjerava se pri dodavanju **i** pri svakoj prijavi. Ako ga ne postavite, može se dodati bilo koji valjan Google email (npr. gmail).
- **`ADMIN_REQUIRE_HD`**: samo vrijednost `true` ga uključuje. Tada token mora imati Workspace `hd` claim jednak domeni emaila. Uključujte ga samo ako su SVI administratori Google Workspace računi; račun bez `hd` claima (npr. gmail) bi bio odbijen. Bez ovoga nijedan listani administrator nije blokiran zbog domene.

## Korak 3: Google Cloud (postojeći projekat i postojeći OAuth klijent)

**Ne pravite novi projekat ni novi OAuth klijent.** Koristite one koji već postoje u konzoli. Prema stanju koje ste prijavili:

| Postavka | Stanje | Šta radite |
|---|---|---|
| User type | External | ostaje |
| Publishing status | Testing | promijenit ćete u „In production“ (korak 3c) |
| Authorized JavaScript origin | `https://mahmutovichana.github.io` | **provjerite da je tačno ovako**: samo domena, `https`, bez putanje i bez kose crte na kraju. Putanja `/eestec-events/` se NE upisuje u origin |
| Authorized redirect URIs | — | ostaje prazno (prijava ne koristi redirect) |
| Homepage | `https://mahmutovichana.github.io/eestec-events/` | ostaje; vidi 3b |
| Scopes | — | samo osnovni: `openid`, `email`, `profile`. Ne dodajte ništa drugo |

1. console.cloud.google.com → izaberite postojeći projekat (onaj u kojem je OAuth klijent) → **Google Auth Platform → Clients** → otvorite postojeći **Web application** klijent.
2. Provjerite origin iz tabele. Ako ste pri prvom unosu dodali i adresu s putanjom, obrišite je.
3. Kopirajte **Client ID** (završava na `.apps.googleusercontent.com`). To je javna vrijednost; **client secret vam ne treba i ne upisuje se nigdje**.
4. Upišite Client ID na dva mjesta: Script property `CLIENT_ID` (korak 2.4) i `clientId` u `sheets/web/public/config.js` (korak 5).
5. Opcionalno za lokalni razvoj: dodajte origin `http://localhost:5173`.

> Ne mogu vidjeti vašu Google Cloud konzolu: naziv/ID projekta i Client ID nisu zapisani u repozitoriju i ne smiju se izmišljati. Gornja tabela je ono što ste mi javili.

## Korak 3b: Branding (Google Auth Platform → Branding)

Poruka „Publish app je onemogućeno dok se ne završi Branding“ znači da obavezna polja nisu popunjena. Šta je šta:

| Polje | Status | Vrijednost |
|---|---|---|
| App name | **obavezno** | `EESTEC Events` |
| User support email | **obavezno** | `hana.mahmutovic@eestec-sa.ba` |
| Developer contact information | **obavezno** (isti odjeljak ili „Contact info“) | `hana.mahmutovic@eestec-sa.ba` |
| App logo | opcionalno | `sheets/web/public/eestec-logo.png` (kvadratni, ≤ 1 MB). Logo može aktivirati verifikaciju brenda; preskočite ako želite izbjeći pregled |
| **Application home page** | preporučeno; traži ga verifikacija | `https://mahmutovichana.github.io/eestec-events/` |
| **Application privacy policy link** | preporučeno; traži ga verifikacija | `https://mahmutovichana.github.io/eestec-events/privacy/` |
| **Application terms of service link** | preporučeno | `https://mahmutovichana.github.io/eestec-events/terms/` |
| Authorized domains | traži se kada su gornji linkovi uneseni | `mahmutovichana.github.io` (vidi napomenu) |

Zadnja kosa crta na `/privacy/` i `/terms/` je obavezna (GitHub Pages služi mape).

**Napomena o Authorized domains:** `github.io` je na listi javnih sufiksa, pa je „domena prvog nivoa“ vaše stranice `mahmutovichana.github.io`. Konzola traži da linkovi budu pod autorizovanom domenom; unesite `mahmutovichana.github.io`. Ako je odbije, probajte `github.io`. Nisam mogao provjeriti šta konzola prihvata (nemam pristup vašem projektu) i ne znam da li će Google pri verifikaciji brenda tražiti dokaz vlasništva koji se za github.io ne može dati. Za osnovne opsege se aplikacija može objaviti bez verifikacije; ako Google ipak traži vlasništvo, izlaz je vlastita poddomena (npr. `events.eestec-sa.ba`: DNS `CNAME events → mahmutovichana.github.io`, GitHub Pages → Custom domain, Enforce HTTPS, zatim zamijeniti sve URL-ove i origin u konzoli i u `config.js`).

Redoslijed: stranice moraju biti **na mreži prije** nego što ih Google provjeri (korak 5a).

## Korak 3c: Publish app

Prije klika na **Publish app** (Audience → Publishing status → Publish app → Confirm):

1. Sva tri URL-a iz 3b se otvaraju u anonimnom prozoru (korak 5a). Trenutno ne rade (vidi korak 5).
2. U pravnim stranicama nema žutih oznaka `[POTVRDITI]`: `LEGAL.md`. Provjera: `grep -c 'class="confirm"' sheets/web/public/*/index.html` daje 0.
3. Scope-ovi su samo `openid`, `email`, `profile`.
4. Posljedica: u „Testing“ statusu mogu se prijaviti samo ručno dodani test korisnici (max 100); u „In production“ svaki Google račun. Aplikacija sa samo osnovnim opsezima ne bi trebala dobiti ekran „unverified app“, ali to nije testirano.

## Korak 4: Objava skripte kao web aplikacije (pod računom vlasnika)

1. Apps Script: **Deploy → New deployment → ⚙ → Web app**.
2. Tačno ovako:
   - **Execute as: Me (hana.mahmutovic@eestec-sa.ba)**
   - **Who has access: Anyone**
3. **Deploy**, kopirajte **Web app URL** (završava na `/exec`).
4. Otvorite taj URL u pregledniku: treba se vidjeti `{"ok":true,"data":{"service":"eestec-events",...}}`.

> Svaka promjena `Code.gs` traži: **Deploy → Manage deployments → ✏ → Version: New version → Deploy**. URL ostaje isti. Bez toga radi stara verzija.

Napomena: „Execute as: Me“ znači da skripta piše u tabelu kao vlasnik. Zato ostali administratori ne trebaju pristup tabeli. Ko je administrator odlučuje isključivo lista `Admins`, ne prava nad tabelom.

## Korak 5: Frontend (GitHub Pages)

**Trenutno stanje (provjereno HTTP zahtjevom i stvarnim Chromeom): stranica je objavljena.** `https://mahmutovichana.github.io/eestec-events/`, `/privacy/` i `/terms/` vraćaju 200, a GitHub Pages run #1 i #2 na grani `feat/sheets-simplification` su uspjeli (build i deploy). Koraci ispod su zadržani kao uputa za ponavljanje/novo okruženje.

### 5a. Pustiti stranicu na mrežu (prije Branding provjere)

**Rezultat prvog pokretanja (run #1 na grani feat/sheets-simplification):** posao *build* je **uspio** na GitHubu (`npm ci`, build, provjera artefakta, upload). Posao *deploy* je **odbijen** porukom: *Branch "feat/sheets-simplification" is not allowed to deploy to github-pages due to environment protection rules.* Okruženje `github-pages` već postoji, pa je preostao samo korak 2 ispod (traži administratorska prava nad repozitorijem; ne mogu ga uraditi umjesto vas). Nakon toga: Actions → run → **Re-run failed jobs**.

1. GitHub → repozitorij → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Settings → Environments → github-pages → Deployment branches**: dodajte `feat/sheets-simplification` (po zadanom je dozvoljen samo `main`; bez ovoga deploy posao pada s porukom o „environment protection rules“). Ovaj korak nije potreban nakon spajanja u `main`.
3. Radni tok `.github/workflows/sheets-pages.yml` se pokreće pri svakom push-u na `main` ili `feat/sheets-simplification` koji mijenja `sheets/web/**`. Nakon uključenja Pages-a: **Actions** → zadnji run → **Re-run all jobs** (ili novi push).
   - Posao „build“ radi `npm ci`, `npm run build` i provjerava da artefakt ima `privacy/`, `terms/` i `legal.css`. Daje **upozorenja** (ne greške) dok u pravnim stranicama ima oznaka `[POTVRDITI]` i dok `config.js` nema `apiUrl/clientId`. To je namjerno: stranice moraju biti na mreži da bi se uopće mogla riješiti Branding provjera.
4. Provjerite u anonimnom prozoru (bez prijave):
   - `https://mahmutovichana.github.io/eestec-events/`: naslov „Događaji“, opis i linkovi na Privatnost i Uslove (poruka „nije povezana sa serverom“ je normalna dok se ne završi 5b),
   - `https://mahmutovichana.github.io/eestec-events/privacy/`,
   - `https://mahmutovichana.github.io/eestec-events/terms/`.

### 5b. Povezivanje aplikacije sa serverom (urađeno)

`sheets/web/public/config.js` već sadrži stvarne **javne** vrijednosti (nisu tajne):
```js
window.EESTEC_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbwpYF8pnhqES7ximj08kqoL5KKbmD-lo6R4v18oE5eSxqhM1s8ufmvoPly3lW7EPQhU/exec",
  clientId: "406203316711-fn9te97d8n67ff5gelc2e6cssnacvml2.apps.googleusercontent.com"
};
```
- Promjena bilo čega u `sheets/web/**` na `feat/sheets-simplification` ili `main` pokreće novu objavu.
- Alternativa bez GitHub Pages-a: `npm run sheets:build` i `sheets/web/dist` na drugi statični hosting (onda se mijenja origin u konzoli).
- Spajanje u `main` je vaša odluka; `main` još sadrži staru Next.js aplikaciju, a ovaj workflow ne dira ništa osim `sheets/web`.

### Ažuriranje backenda (obavezno nakon svake promjene `Code.gs`)

Stvarni deployment trenutno vrti verziju sa više administratora, **bez** čuvanja podataka/dnevnika revizije. Za nove funkcije (Administracija → Čuvanje podataka):
1. Apps Script → zamijenite sadržaj `Code.gs` novim.
2. Izaberite funkciju `setup` → Run (pravi list `AuditLog`; ne dira administratore ni postavke; dozvole se ne traže ponovo).
3. **Deploy → Manage deployments → ✏ → Version: New version → Deploy.** URL se ne mijenja; bez ovoga web aplikacija vrti staru verziju.
4. Provjera: `node sheets/scripts/real-smoke.mjs` (12 provjera) i lista u `INTEGRATION-CHECKLIST.md`.

### Šta je provjereno lokalno, a šta nije
- **PASS:** čist `npm ci` + `npm run build` iz commitovanih datoteka; YAML workflow-a je valjan; artefakt pod putanjom `/eestec-events/` (simulacija github.io, sve van putanje je 404) učitava skripte, stilove, logo, pravne stranice i preusmjerenja bez pokvarenih resursa.
- **NOT RUN:** stvarno izvršavanje workflow-a na GitHubu, ograničenja okruženja `github-pages`, HTTPS i keširanje na github.io, Googleova provjera linkova.

## Korak 6: Provjera (obavezno, nije automatski testirano s pravim računima)

1. Stranica bez prijave: vidi se „Događaji“.
2. Prijavite se kao `hana.mahmutovic@eestec-sa.ba`: pojavljuje se **Administracija**. Otvorite **Administratori** i provjerite listu od osam.
3. Neka se **svaki** od ostalih sedam administratora prijavi barem jednom (hr, chair, pr, it, fr, cp, treasurer): trebaju vidjeti **Administracija**. Prva prijava veže njihov Google ID za red u `Admins` (kolona `sub`); u listi pišu kao „već se prijavljivao“.
4. Prijavite se **običnim Google računom** (npr. privatnim): Administracija se ne vidi, a `#/admin` kaže „Nemate pristup“. Glasanje radi.
5. Kreirajte događaj, objavite ga, otvorite u anonimnom prozoru: vidljiv je bez prijave.
6. Anonimni feedback iz anonimnog prozora: u `FeedbackResponses` ne smije biti emaila ni imena.
7. Deaktivirajte test administratora u aplikaciji: taj račun odmah gubi pristup (osvježite stranicu).
8. Greške: „origin_mismatch“ = pogrešan origin u koraku 3.3; „Nema veze sa serverom“ = provjerite korak 4.2 i novu verziju deploymenta.

## Oporavak pristupa

**Posljednjeg aktivnog administratora aplikacija ne dozvoljava deaktivirati.** Ako se pristup ipak izgubi (npr. ručna izmjena lista `Admins`, račun koji se promijenio):

1. Otvorite Apps Script projekt kao vlasnik (hana.mahmutovic@eestec-sa.ba).
2. Izaberite funkciju **`recoverAccess`** → **Run**. Vraća aktivnim račun vlasnika (dodaje ga ako fali) i briše njegovu vezu sa Google ID-em. Ostale administratore ne dira.
3. Prijavite se kao vlasnik i u **Administratori** vratite ostale.

Ne postoji web adresa, tajna ni parametar kojim se ovo može pokrenuti izvana: zahtijeva pristup editoru skripte, tj. isto povjerenje kao vlasništvo nad skriptom.

**Administrator ne može ući iako je na listi, a prije je mogao** (npr. račun je obrisan i ponovo napravljen s istom adresom, pa ima drugi Google ID): u Script properties dodajte `RESET_BINDING_EMAIL` = njegova adresa, pokrenite **`resetAdminBinding`**. Veza se briše i svojstvo se samo uklanja; sljedeća prijava veže novi ID.

## Šta zahtijeva vaš Google/GitHub pristup (ne mogu ga uraditi umjesto vas)

| Radnja | Račun |
|---|---|
| Dozvoliti granu u okruženju `github-pages`, ponovo pokrenuti deploy (5a) | admin GitHub repozitorija |
| Objaviti novi `Code.gs` kao novu verziju deploymenta i pokrenuti `setup` | hana.mahmutovic@eestec-sa.ba |
| Prijava sa svih 8 administratorskih računa i jednog običnog računa (`INTEGRATION-CHECKLIST.md`, C) | svaki administrator + test račun |
| Donijeti preostale pravne odluke (`LEGAL.md`) i ukloniti oznake `[POTVRDITI]` | EESTEC |
| Odrediti raspored provođenja roka čuvanja (`RETENTION.md`) | EESTEC |

## Šta zahtijeva vašu ručnu akciju

- [ ] Napraviti tabelu i zalijepiti kod pod `hana.mahmutovic@eestec-sa.ba` (korak 1–2)
- [ ] Odobriti dozvole skripti i pokrenuti `setup` (2.5)
- [ ] Google Cloud projekt: OAuth ekran External + Published, Web client ID (korak 3)
- [ ] Uključiti Pages (izvor GitHub Actions) i dozvoliti granu u okruženju `github-pages` (korak 5a)
- [ ] Popuniti Branding sa adresama iz 3b, donijeti odluke iz `LEGAL.md`, tek onda „Publish app“ (3c)
- [ ] Objaviti web aplikaciju: Execute as Me, Anyone (korak 4)
- [ ] Upisati `apiUrl` i `clientId` u `config.js`, uključiti GitHub Pages (korak 5)
- [ ] Odraditi provjeru iz koraka 6 sa stvarnim računima (posebno svih osam administratora i jedan običan račun)
- [ ] Odlučiti da li uključiti `ADMIN_EMAIL_DOMAINS` / `ADMIN_REQUIRE_HD`
- [ ] Opcionalno: Docker + izvoz starih podataka (`MIGRATION.md`)

## Održavanje

- Rezervna kopija: **File → Version history** u tabeli i povremeno **File → Download**.
- Hitno gašenje API-ja: **Deploy → Manage deployments → Archive**.
- Nema tajni za rotaciju.
