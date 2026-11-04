# Sigurnost: model administratora i autorizacije

Dokument opisuje stvarno ponašanje `Code.gs`. Šta nije potvrđeno pravim Googleom, označeno je.

## Ko je administrator

Administrator je osoba čiji je **ovjereni Google identitet** na listi **aktivnih** u listu `Admins`. Svi uslovi moraju vrijediti istovremeno:

1. Token (Google ID token) je provjeren kod Googlea: potpis/izdavač (`iss` = accounts.google.com), **`aud` = naš `CLIENT_ID`**, **`exp` u budućnosti**.
2. `email_verified = true` i token sadrži email.
3. Email (malim slovima) postoji u `Admins` s `active = 1`.
4. Ako je za red vezan Google `sub` (vezuje se pri prvoj admin prijavi), token mora imati **isti `sub`**.
5. Ako su postavljena opcionalna ograničenja: domena emaila je u `ADMIN_EMAIL_DOMAINS`; `ADMIN_REQUIRE_HD=true` ⇒ `hd` claim jednak domeni emaila.

Ništa iz tijela zahtjeva (email, role, isAdmin, userSub, adminEmail...) se ne čita. Test to provjerava.

### Opoziv je trenutan
Lista `Admins` se čita pri **svakom** zahtjevu (nema keširanja uloge). Provjera tokena se kešira do 5 minuta, ali ne i status administratora, pa deaktivirani račun gubi pristup odmah, čak i sa još važećim tokenom (testirano).

### Stabilan identitet (`sub`)
Email se može ponovo dodijeliti (obrisan pa napravljen račun). Zato se pri prvoj admin prijavi upisuje Google `sub`; kasnije prijava s istim emailom a drugim `sub` je **odbijena**. Posljedica: ako se račun legitimno ponovo napravi, treba `resetAdminBinding` (SETUP.md). Vezanje se dešava samo unutar zaključane sekcije (admin akcije i `whoami`); čitanja ne pišu.

### Zaštita od zaključavanja
- Posljednji aktivni administrator se ne može deaktivirati (server provjerava, `CONFLICT`).
- **Oporavak:** `recoverAccess()` iz Apps Script editora, pod računom vlasnika. Nije u tabeli akcija web aplikacije (testirano: `BAD_REQUEST` za `recoverAccess`, `resetAdminBinding`, `setup`, `seedAdmins_`), pa nema javnog zaobilaznog puta. Zahtijeva pristup editoru skripte.

### Početna lista
`setup()` upisuje osam adresa **samo ako Script property `ADMINS_SEEDED` ne postoji** (prva inicijalizacija) i uvijek dodaje račun pod kojim je skripta objavljena (vlasnik). Poslije toga je lista pod kontrolom aplikacije. Ukinuti administrator se ne vraća pri ponovnom `setup()` (testirano, uključujući obrisan red). Adrese u kodu su organizacijske uloge, ne tajne.

## Privatnost liste
- `listAdmins` je admin-only; klijentu se vraća email, aktivnost, `addedAt`, `addedBy` i oznaka „već se prijavljivao“. Google `sub` se ne vraća.
- Javni odgovori (`listPublishedEvents`, `getEvent`, `whoami`, GET) ne sadrže listu; test provjerava odsustvo svih adresa osim `hr@` koja je odvojeno i javna kontakt adresa (`Settings.contactEmail`).
- `importSeed` ne može upisivati `Admins` (ni `Settings`).
- **Ograničenje:** tabela nije skrivena od svojih urednika. Urednik tabele vidi `Admins`, `Votes` (emailove) i može ih mijenjati. Zato tabelu dijelite samo s povjerenim osobama; ostali administratori ne trebaju pristup tabeli.

## Čuvanje podataka, brisanje i revizija
Detalji u `RETENTION.md`. Sigurnosna svojstva:
- `previewRetention`, `applyRetention`, `previewUserData`, `eraseUserData`, `listAudit` su **admin-only** (provjera prije čitanja podataka; testirano za gosta, običnog korisnika, opozvanog administratora i neverifikovan email).
- Rok (24 mjeseca) računa server; klijent ga ne može skratiti. Nema okidača: ništa se ne briše samo.
- Destruktivne radnje traže frazu (`ANONIMIZIRAJ` / `OBRIŠI`) i **tačan broj zapisa iz pregleda** (zaštita od zastarjelog pregleda), izvršavaju se pod bravom i bilježe u `AuditLog`.
- `AuditLog` ne sadrži email osobe čiji se podaci brišu (samo skraćeni salted hash i oznaka zahtjeva); `importSeed` ga ne može pisati.
- Ograničenje: urednik Google tabele može ručno mijenjati `AuditLog`, `Admins` i podatke; dnevnik nije kriptografski nepromjenjiv.

## Domen i `hd`
- Podrazumijevano **nema ograničenja po domeni**: listani administrator nikad nije odbijen zbog domene ili `hd` claima. Ranije `ADMIN_HD` (koji je tražio `hd` claim) je uklonjen jer bi odbijao račune bez `hd` claima.
- `ADMIN_EMAIL_DOMAINS` (opcionalno) ograničava ko se može dodati i ko se može prijaviti kao administrator.
- `ADMIN_REQUIRE_HD=true` (opcionalno) dodatno traži Workspace `hd`. Treba ga uključiti samo ako su svi administratori Workspace računi.
- Napomena: `email_verified` znači da je Google potvrdio vlasništvo nad adresom. Za Workspace domene to znači da adresu kontroliše organizacija.

## Ostalo (nepromijenjeno)
Provjera `aud`/`iss`/`exp` pri svakom (nekeširanom) tokenu; brava za sve upise; validacija ulaza; opća poruka greške; anonimni feedback ne provjerava token i ne čuva identitet; CSV zaštita od formula; CSP u frontendu. Vidi `ARCHITECTURE.md`.

## Šta nije provjereno
Pravi Google token i `tokeninfo` odgovor (polja `email_verified` kao string/bool, `hd`) provjereni su samo lažnim Googleom oblikovanim po dokumentaciji. Prije upotrebe odradite korak 6 iz `SETUP.md` sa svih osam računa. Stvarno ponašanje `LockService` pod paralelnim opterećenjem nije mjereno.
