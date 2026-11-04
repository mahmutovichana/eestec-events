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

## Korak 3: Google Cloud (prijava)

1. console.cloud.google.com pod `hana.mahmutovic@eestec-sa.ba` → **New Project**, `EESTEC Events`.
2. **APIs & Services → OAuth consent screen** (ili „Google Auth Platform“):
   - **User type: External** (da se može prijaviti bilo koji Google račun; učesnici nisu u vašem Workspaceu).
   - App name `EESTEC Events`; support i developer email: `hana.mahmutovic@eestec-sa.ba`.
   - **Scopes:** samo osnovni (`openid`, `email`, `profile`). Tako verifikacija aplikacije nije potrebna.
   - **Publishing status: „Publish app“ (In production).** U „Testing“ stanju mogu se prijaviti samo ručno dodani test korisnici (najviše 100), a vi biste morali dodati i svih osam administratora.
3. **Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins** (samo domena, bez putanje i bez kose crte na kraju): `https://IMEKORISNIKA.github.io` (vaše GitHub ime malim slovima); lokalno opcionalno `http://localhost:5173`.
   - **Authorized redirect URIs:** prazno.
   - **Create**, kopirajte **Client ID**. Client secret ne trebate i ne unosite nigdje.
4. Upišite `CLIENT_ID` u Script properties (korak 2.4).

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

1. U `sheets/web/public/config.js` upišite javne vrijednosti:
   ```js
   window.EESTEC_CONFIG = {
     apiUrl: "https://script.google.com/macros/s/XXXXXXXX/exec",
     clientId: "1234567890-abc.apps.googleusercontent.com"
   };
   ```
2. GitHub → **Settings → Pages → Source: GitHub Actions**.
3. Spojite u `main` (ili ručno **Actions → Objava sheets/web na GitHub Pages → Run workflow**). Adresa: `https://IMEKORISNIKA.github.io/eestec-events/`. Origin mora biti u koraku 3.3.
   - Alternativa: `npm run sheets:build` i otpremiti `sheets/web/dist` na bilo koji statični hosting.

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

## Šta zahtijeva vašu ručnu akciju

- [ ] Napraviti tabelu i zalijepiti kod pod `hana.mahmutovic@eestec-sa.ba` (korak 1–2)
- [ ] Odobriti dozvole skripti i pokrenuti `setup` (2.5)
- [ ] Google Cloud projekt: OAuth ekran External + Published, Web client ID (korak 3)
- [ ] Objaviti web aplikaciju: Execute as Me, Anyone (korak 4)
- [ ] Upisati `apiUrl` i `clientId` u `config.js`, uključiti GitHub Pages (korak 5)
- [ ] Odraditi provjeru iz koraka 6 sa stvarnim računima (posebno svih osam administratora i jedan običan račun)
- [ ] Odlučiti da li uključiti `ADMIN_EMAIL_DOMAINS` / `ADMIN_REQUIRE_HD`
- [ ] Opcionalno: Docker + izvoz starih podataka (`MIGRATION.md`)

## Održavanje

- Rezervna kopija: **File → Version history** u tabeli i povremeno **File → Download**.
- Hitno gašenje API-ja: **Deploy → Manage deployments → Archive**.
- Nema tajni za rotaciju.
