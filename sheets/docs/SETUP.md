# Postavljanje (za osobu bez programerskog iskustva)

Ukupno oko 30–40 minuta. Sve radite pod računom **hr@eestec-sa.ba**, tako da tabela i skripta pripadaju organizaciji, a ne ličnom računu.

Šta vam treba: Google račun `hr@eestec-sa.ba`, GitHub račun (besplatan) koji ima ovaj repozitorij.

Nikad ne šaljite nikome (ni meni u chatu) tajne ključeve. U ovom postavljanju **nema tajni za unos**: Client ID i adresa skripte su javni podaci.

---

## Korak 1: Tabela

1. Na drive.google.com napravite novu **Google tabelu** (Blank spreadsheet), nazovite je `EESTEC Events`.
2. Ne dijelite je s nikim osim osobama kojima vjerujete (svi s pristupom vide emailove glasača). **Ne objavljujte je javno.**

## Korak 2: Skripta (backend)

1. U tabeli: **Extensions → Apps Script**.
2. Obrišite sav postojeći kod, pa zalijepite cijeli sadržaj datoteke `sheets/apps-script/Code.gs`. Sačuvajte (Ctrl+S).
3. Lijevo kliknite zupčanik **Project Settings**. Uključite **Show "appsscript.json" manifest file in editor**. Vratite se na **Editor**, otvorite `appsscript.json` i zamijenite sadržaj sadržajem datoteke `sheets/apps-script/appsscript.json`. Sačuvajte.
4. U **Project Settings → Script properties → Add script property** dodajte (vrijednost za CLIENT_ID dobijate u koraku 3, pa se vratite ovdje):
   | Property | Vrijednost |
   |---|---|
   | `CLIENT_ID` | Client ID iz koraka 3 (završava na `.apps.googleusercontent.com`) |
   | `ADMIN_EMAIL` | `hr@eestec-sa.ba` (možete izostaviti, to je podrazumijevano) |
   | `ADMIN_HD` | `eestec-sa.ba` (preporučeno: dodatna provjera Workspace domene) |
5. U editoru izaberite funkciju **`setup`** u padajućem meniju pa kliknite **Run**. Prvi put traži dozvole: **Review permissions → izaberite hr@eestec-sa.ba → Advanced → Go to ... (unsafe) → Allow**. Upozorenje „unsafe“ je normalno za vlastitu skriptu koju Google nije pregledao. Skripta traži samo pristup ovoj tabeli i slanje zahtjeva prema Googleu.
6. Provjerite u tabeli: pojavila su se 11 listova (Events, Agendas, …) sa zaglavljima.

## Korak 3: Google Cloud (prijava)

1. Otvorite console.cloud.google.com pod `hr@eestec-sa.ba`. **Select a project → New Project**, naziv `EESTEC Events`.
2. Meni → **APIs & Services → OAuth consent screen** (ili „Google Auth Platform“):
   - **User type: External** (da se može prijaviti bilo koji Google račun).
   - App name: `EESTEC Events`; User support email i Developer contact: `hr@eestec-sa.ba`.
   - **Scopes:** ostaviti samo osnovne (`openid`, `email`, `profile`). Ne dodavati ništa drugo, tako verifikacija aplikacije nije potrebna.
   - **Publishing status: pritisnite „Publish app“ (In production).** Ako ostane „Testing“, mogu se prijaviti samo ručno dodani test korisnici (najviše 100).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**, naziv `EESTEC Events web`.
   - **Authorized JavaScript origins** (samo domena, bez putanje i bez kose crte na kraju):
     - `https://IMEKORISNIKA.github.io` (zamijenite svojim GitHub imenom ili imenom organizacije, malim slovima)
     - za lokalni razvoj opcionalno: `http://localhost:5173`
   - **Authorized redirect URIs:** ostaviti prazno (ne koristi se).
   - **Create**. Kopirajte **Client ID**. **Client secret vam ne treba i ne smije se nigdje unositi.**
4. Vratite se u Apps Script (korak 2.4) i upišite `CLIENT_ID`.

## Korak 4: Objava skripte kao web aplikacije

1. U Apps Script: **Deploy → New deployment → ⚙ Select type → Web app**.
2. Postavke (tačno ovako):
   - Description: `v1`
   - **Execute as: Me (hr@eestec-sa.ba)**
   - **Who has access: Anyone**
3. **Deploy**, kopirajte **Web app URL** (završava na `/exec`).
4. Brza provjera: otvorite taj URL u pregledniku. Treba se vidjeti `{"ok":true,"data":{"service":"eestec-events",...}}`.

> Svaki put kad promijenite `Code.gs`: **Deploy → Manage deployments → ✏ (olovka) → Version: New version → Deploy**. URL ostaje isti. Bez ovoga web aplikacija i dalje vrti staru verziju.

## Korak 5: Frontend (GitHub Pages)

1. U repozitoriju otvorite `sheets/web/public/config.js` i upišite dvije javne vrijednosti:
   ```js
   window.EESTEC_CONFIG = {
     apiUrl: "https://script.google.com/macros/s/XXXXXXXX/exec",
     clientId: "1234567890-abc.apps.googleusercontent.com"
   };
   ```
2. GitHub → repozitorij → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Spojite promjene u granu `main` (ili ručno: **Actions → Objava sheets/web na GitHub Pages → Run workflow**).
4. Adresa je `https://IMEKORISNIKA.github.io/eestec-events/`. Taj origin (`https://IMEKORISNIKA.github.io`) mora biti u koraku 3.3.
   - Alternativa bez GitHuba: pokrenite `npm run sheets:build` i sadržaj `sheets/web/dist` otpremite na bilo koji statični hosting (Netlify Drop, Cloudflare Pages). Onda u korak 3.3 upišite taj origin.

## Korak 6: Provjera (obavezno, jer ovo nije automatski testirano)

Napravite ovim redom i zabilježite šta ne radi:

1. Otvorite stranicu bez prijave: vidi se naslov „Događaji“ (prazno je normalno).
2. Kliknite **Prijava**, prijavite se računom `hr@eestec-sa.ba`. Pojavljuje se dugme **Administracija**.
3. Kreirajte događaj, dodajte agendu, objavite (Detalji → Postavi: Objavljen). U tabeli se pojavljuju redovi.
4. Otvorite stranicu u anonimnom prozoru: događaj je vidljiv bez prijave.
5. Prijavite se **drugim Google računom** (npr. privatnim): Administracija se ne vidi, a ručni odlazak na `#/admin` kaže „Nemate pristup“. Glasanje radi.
6. Pošaljite anonimni feedback iz anonimnog prozora; u listu `FeedbackResponses` ne smije biti ni emaila ni imena.
7. Ako prijava javlja grešku „origin_mismatch“: origin u koraku 3.3 nije tačan. Ako stranica javlja „Nema veze sa serverom“: provjerite postavke deploymenta (korak 4.2) i da ste objavili novu verziju.

## Korak 7: Uvoz postojećeg HOBOM-a (opcionalno)

Vidi `MIGRATION.md`.

---

## Šta zahtijeva vašu ručnu akciju (sažetak)

- [ ] Napraviti tabelu i zalijepiti kod (korak 1–2)
- [ ] Odobriti dozvole skripti pod `hr@eestec-sa.ba` (2.5)
- [ ] Napraviti Google Cloud projekat, OAuth ekran (External, Published) i Web client ID (korak 3)
- [ ] Objaviti web aplikaciju: Execute as Me, Anyone (korak 4)
- [ ] Upisati `apiUrl` i `clientId` u `config.js`, uključiti GitHub Pages (korak 5)
- [ ] Odraditi provjeru iz koraka 6 s pravim Google računima
- [ ] Pokrenuti Docker i izvoz podataka ako želite prenijeti stari HOBOM (korak 7)
- [ ] Odlučiti kada ugasiti staru aplikaciju (nikad automatski; vidi `ARCHITECTURE.md`, odjeljak „Gašenje starog sistema“)

## Redovno održavanje

- Rezervna kopija: **File → Version history** u tabeli i povremeno **File → Download → .xlsx**.
- Ako se promijeni admin: u Script properties promijeniti `ADMIN_EMAIL`, pa objaviti novu verziju.
- Rotacija: ne postoji tajna koja se rotira. Ako sumnjate u zloupotrebu, u Apps Scriptu **Deploy → Manage deployments → Archive** odmah gasi API.
