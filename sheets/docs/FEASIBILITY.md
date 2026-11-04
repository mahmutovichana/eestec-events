# Izvodljivost: može li sve u jedan Claude Artifact?

**Kratak odgovor: ne, ne sigurno.** Najjednostavnija sigurna alternativa je statična React stranica (besplatan hosting) + Google Apps Script + Google Sheets. Ovo je implementirano u `sheets/`.

Oznake: **PROVJERENO** (vidjelo se u ovoj sesiji), **POZNATO** (opisano u Googleovoj dokumentaciji / opće znanje, nije ovdje testirano), **PROVJERITI** (mora se potvrditi pri postavljanju).

## 1. Claude Artifact

| Zahtjev | Nalaz | Status |
|---|---|---|
| Čuvanje tajni | Artifact je stranica koju vidi svako s linkom. Sve što je u njenom kodu je javno. Tajne ne mogu biti u njemu. | POZNATO |
| Google prijava za bilo koji Google račun | Artifact capabilities koje ovaj alat nudi (`artifact`, `db`, `user`, `mcp`, `sample`, `room`, `assets`, `downloads`, `comments`, `files`) ne uključuju Google OAuth. `user` identificira gledaoca u okviru claude.ai organizacije, ne Google računa. Nema načina da Artifact dobije Google ID token koji backend može provjeriti. | PROVJERENO (lista capabilities) |
| Pozivi prema Apps Scriptu | Artifacti se izvršavaju u sandboxu s ograničenim mrežnim pristupom. Da li se dozvoljava `fetch` prema `script.google.com` ovdje nije testirano. | PROVJERITI (nije testirano, nije ni potrebno za odluku) |
| Spremanje podataka | Artifact `db` capability čuva podatke u Anthropicovoj pohrani, ne u Google Sheets, pa ne zadovoljava zahtjev „tabela je izvor istine“. | PROVJERENO (opis capability) |
| Admin samo `hr@eestec-sa.ba` | Bez provjerljivog Google identiteta nije moguće provjeriti na serveru ko je admin. Svaka zamjena (lozinka u kodu, admin link) bila bi nesigurna prečica, što je izričito zabranjeno. | zaključak |

**Odluka:** Artifact se ne koristi kao produkcijska aplikacija. Ne objavljujem ni „demo“ Artifact, jer bi izgledao kao da radi s pravom prijavom, a ne bi.

## 2. Apps Script: hosting ili samo backend?

HtmlService (stranica služena sa script.google.com) je loš izbor za Google prijavu: stranica se izvršava u iframeu na dinamičkoj `*.googleusercontent.com` domeni, a Google Identity Services traži fiksne „Authorized JavaScript origins“. (POZNATO, PROVJERITI ako se ikad pokuša.)

**Izabrano:** frontend na statičnom hostu s fiksnom domenom (`https://<korisnik>.github.io`), backend na Apps Scriptu kao JSON API.

## 3. Identitet i admin provjera

| Pitanje | Odgovor | Status |
|---|---|---|
| Može li Apps Script reći ko je pozivalac? | S postavkama „Execute as: Me“ + „Anyone“, `Session.getActiveUser().getEmail()` je za vanjske račune u pravilu prazan. Ne oslanjamo se na to. | POZNATO |
| Šta se koristi umjesto toga | Frontend dobija **Google ID token** (JWT) kroz Google Identity Services. Šalje ga u svakom zahtjevu. Server ga provjerava kod Googlea (`oauth2.googleapis.com/tokeninfo`) i provjerava `aud` (naš Client ID), `iss`, `exp`, `email_verified`. Email/uloga iz tijela zahtjeva se nikad ne koriste. | implementirano; logika PROVJERENA lažnim Googleom; stvarni Google PROVJERITI |
| Admin | token mora imati `email_verified = true` i email na listi aktivnih administratora (list `Admins`, osam početnih računa; upravlja se iz aplikacije). Opcionalna ograničenja domene su u Script properties. | implementirano |
| Stabilan identitet za glasove | Google `sub` (numerički ID), ne email. | implementirano |
| `tokeninfo` endpoint | Googleova dokumentacija ga opisuje kao prikladan za debug i niskoprometne primjene. Za ovaj obim (desetine korisnika) i uz keširanje tokena 5 min, to je dovoljno. Za veliki promet bi trebalo lokalno provjeravati potpis JWT-a. | POZNATO |

## 4. CORS i redirect

Apps Script web app ne odgovara na CORS preflight (OPTIONS). Zato klijent šalje POST sa `Content-Type: text/plain`, što je „jednostavan zahtjev“ bez preflighta. Odgovor dolazi preko preusmjeravanja na `script.googleusercontent.com` s `Access-Control-Allow-Origin: *`. (POZNATO, često korišten obrazac.) Lokalni test-server namjerno odbija OPTIONS i druge Content-Type vrijednosti, pa bi svaka promjena klijenta koja traži preflight pala na testu. **PROVJERITI** na stvarnom deploymentu: korak 6 u SETUP.md.

## 5. Kvote (POZNATO, približno; provjeriti na developers.google.com/apps-script/guides/services/quotas)

| Resurs | Približna granica (besplatan Google račun) | Naš potrošak |
|---|---|---|
| UrlFetch pozivi / dan | desetine hiljada | 1 po novom tokenu na 5 min po korisniku (keširano) |
| Trajanje jedne izvedbe | 6 min | < 2 s tipično |
| Istovremene izvedbe | oko 30 | brava serijalizuje upise; ostali dobijaju `BUSY` nakon 20 s |
| Ćelije u tabeli | 10 miliona | 90–200 redova godišnje |
| CacheService vrijednost | 100 KB, TTL najviše 6 h | tokeni i brojači |

Zaključak: za 90–200 redova godišnje i desetine istovremenih korisnika nema opasnosti od kvota. Pri prekoračenju kvote Apps Script vraća HTML grešku, koju frontend prikazuje kao „Server je vratio neočekivan odgovor“ (testirano na nivou klijenta, ne na stvarnoj kvoti).

## 6. Šta ovo NE rješava (poznata ograničenja)

- Svako s linkom može slati zahtjeve na `/exec`. Zato autorizacija radi na serveru, a ne u frontendu.
- Anonimni feedback se ne može vezati za osobu, pa ga ista osoba može poslati više puta (ograničeno: 5 po uređaju po formi na 6 h, 120 po formi na 10 min). Zaobilazi se promjenom uređaja/brisanjem podataka preglednika.
- Urednici Google tabele vide sve (uključujući emailove glasača) i mogu ručno mijenjati podatke. Tabelu dijeliti samo s povjerenim osobama. Tabela NIKAD ne smije biti javna.
- GitHub Pages ne dozvoljava postavljanje HTTP zaglavlja (npr. `frame-ancestors`). CSP je zadan kroz `<meta>` oznaku, što ne pokriva zaštitu od ugrađivanja u iframe.
