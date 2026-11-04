# Čuvanje podataka: rok od dvije godine, anonimizacija i zahtjevi za brisanje

Odluka organizacije: **lični podaci se čuvaju najviše dvije godine (24 mjeseca)**. Zahtjeve za brisanje može obraditi **bilo koji trenutno ovlašteni administrator**. Ovaj dokument opisuje kako se to provodi bez automatskog, nepovratnog brisanja.

## Šta je „lični podatak“ u aplikaciji

| Podatak | Lični? | Rok se računa od |
|---|---|---|
| Glas (`Votes`: Google ID, email, ime) | da | posljednje promjene glasa (`updatedAt`) |
| Identificirani odgovor (`FeedbackResponses`: Google ID, email, ime) | da | slanja odgovora |
| Anonimni odgovor, događaji, agende, ankete | ne (nema identiteta; vrijeme je zaokruženo na dan) | — |
| Stari anonimni glasovi (`legacy:`) | ne | — |
| Lista administratora (`Admins`) | da, ali vezano za ulogu | **nije određeno** (vidi „Otvoreno“) |
| Dnevnik revizije (`AuditLog`) | emailovi administratora | **nije određeno** |

## Mehanizam (implementiran u aplikaciji, bez novih servisa)

**Administracija → Čuvanje podataka** (`#/admin/_podaci`):

1. **Provjera zapisa starijih od roka** (`previewRetention`): samo čita; pokazuje broj glasova i identificiranih odgovora starijih od 24 mjeseca. Rok računa **server** (klijent ga ne može skratiti; testirano).
2. **Anonimizacija** (`applyRetention`): uklanja ime, email i Google ID (glas dobija nasumični `anonymized:…` identifikator, odgovor gubi identitet, a vrijeme se zaokružuje na dan). **Zbirni rezultati i odgovori ostaju.** Traži:
   - administratora,
   - upisanu frazu `ANONIMIZIRAJ`,
   - tačan broj zapisa iz pregleda (ako se stanje u međuvremenu promijenilo, radnja se odbija),
   - i nikad ne radi sama od sebe.
3. **Zahtjev za brisanje** (`previewUserData` pa `eraseUserData`): admin unese email osobe, vidi samo brojeve (glasovi, odgovori, stavke), bira način i upisuje oznaku zahtjeva i frazu `OBRIŠI`.
   - **Anonimizacija:** uklanja identitet, odgovori ostaju.
   - **Potpuno brisanje:** briše glasove, identificirane odgovore i njihove stavke. Treba kad slobodan tekst može sadržavati lične podatke (anonimizacija slobodan tekst ne mijenja).
   - Zapisi se nalaze po emailu **i** po Google ID-u (starije adrese istog računa).
   - Lista `Admins` se ne dira (zaštita posljednjeg administratora); aplikacija samo javlja da je osoba administrator.
4. **Dnevnik revizije** (`AuditLog`, samo dodavanje): ko (email administratora), kada, šta (`retention.anonymize`, `erasure.anonymize|delete`, `admin.add|activate|deactivate`) i koliko zapisa. Za zahtjeve za brisanje **ne upisuje email osobe**, nego skraćeni hash (SHA-256 sa soli) i oznaku zahtjeva, da evidencija sama ne bi zadržala ono što je brisano. Administratori ga vide u istoj stranici.

### Zašto je ovo sigurno
- Ništa se ne briše automatski: nema okidača (`ScriptApp`/time-driven) u kodu (test provjerava).
- Svaka destruktivna radnja traži admina + frazu + tačne brojeve; neuspjeh ništa ne mijenja (testirano za pogrešne fraze, brojeve, ne-administratore, zauzetu bravu).
- Anonimizacija je podrazumijevana (čuva statistiku). Potpuno brisanje je izričit izbor.
- Rezervna kopija prije prve primjene: **File → Download → .xlsx** ili Version history (nepovratnost: Version history je jedini način vraćanja).
- Dnevnik se ne može uvesti niti urediti kroz aplikaciju (`importSeed` ga preskače). Urednik tabele ga može ručno mijenjati: tabelu ne dijelite široko.

## Preporučeni postupak (ostaje na EESTEC-u da potvrdi)

1. Odredite raspored (npr. jednom godišnje, poslije glavnih događaja) i odgovornu osobu. Postavite podsjetnik u kalendar. **Aplikacija ne šalje podsjetnike** (nije dodan okidač jer bi bio automatska radnja bez vašeg odobrenja; ako ga želite, to je mali okidač koji samo šalje email s brojem zapisa; ne briše ništa).
2. Napravite kopiju tabele (File → Download).
3. Administracija → Čuvanje podataka → Provjeri → pregledajte broj → Anonimiziraj.
4. Provjerite dnevnik revizije.

## Zahtjev za brisanje: postupak
1. Zahtjev stiže na `hana.mahmutovic@eestec-sa.ba` sa Google računa osobe (provjera identiteta po tom računu).
2. Organizacija ga odobri.
3. Bilo koji aktivni administrator: Čuvanje podataka → „Odobren zahtjev za brisanje“ → email → pregled → način → oznaka zahtjeva → potvrda.
4. Odgovor osobi: rok `[POTVRDITI]`.

## Otvoreno (zahtijeva odluku EESTEC-a)
- Raspored provođenja roka i odgovorna osoba.
- Rok za administratorske zapise nakon deaktivacije i za `AuditLog`.
- Da li se brojanje roka radi od posljednje promjene (kako je implementirano) ili od datuma događaja. To je moja pretpostavka; promjena je jedna funkcija (`retentionScan_`).
- Rok odgovora na zahtjeve i nadležno tijelo (ostaju u politici kao `[POTVRDITI]`).

## Ograničenja
- Anonimizacija ne mijenja slobodan tekst odgovora.
- Anonimizirani glasač može ponovo glasati u (otvorenoj) anketi jer više nije prepoznat; stari događaji su obično zatvoreni.
- Stvarno ponašanje na Google Sheets (red-po-red upis) nije mjereno za velike količine; za stotine redova je u redu.
- Nova verzija backenda mora biti objavljena (vidi `SETUP.md`, „Ažuriranje backenda“) i `setup` pokrenut jednom da nastane list `AuditLog`.
