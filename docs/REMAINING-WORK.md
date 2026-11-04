# Preostalo

Poredano po važnosti. Ništa od ovoga ne blokira kod, ali stavke 1 i 2 treba završiti prije stvarne upotrebe.

## Zahtijeva ljudsku akciju ili vanjske kredencijale

1. **Stvarni Google/Auth0 tok nije testiran.** Za to trebaju Auth0 račun i Google OAuth ključevi. Testirani su: logika uloga, put bez simulacije
   (nevažeća sesija, callback greška, preusmjeravanje na prijavu, zaglavlja, odjava), i svi tokovi uz simuliranu sesiju. Prvu prijavu admina treba provjeriti ručno
   (lista u [DEPLOYMENT.md](DEPLOYMENT.md)). Posebno provjeriti: istek sesije nakon 24 h neaktivnosti, `email_verified` za `hr@eestec-sa.ba`, odjavu.
2. **Produkcijska baza i hosting.** Napraviti PostgreSQL, uključiti sigurnosne kopije, postaviti varijable, primijeniti migracije uz svježu kopiju.
3. **Pull request nije spojen.** Grana je spremna za pregled; spajanje je odluka vlasnika repozitorija.

## Poznata ograničenja

| Ograničenje | Uticaj | Prijedlog |
|---|---|---|
| Nema CSP zaglavlja | manja odbrana od XSS-a u dubinu (React već escapuje) | nonce CSP kroz middleware |
| `clientIp` iz `x-forwarded-for` | iza nepouzdanog proxyja IP se može lažirati, što slabi limit za anonimni feedback | na Vercelu je pouzdano; inače čitati zaglavlje koje postavlja vlastiti proxy |
| Anonimni feedback se može poslati više puta | ista osoba može više puta (limit 10/sat/IP) | koristiti identificiranu formu kad treba jedan odgovor po osobi |
| Statistika feedbacka čita sve odgovore | sporije za desetke hiljada odgovora | agregacija u SQL-u, straničenje |
| npm audit: 5 savjeta | nije eksploatabilno ovdje | nadogradnja `next` kad izađe zakrpa u liniji 15 |
| Ručno testiranje čitačem ekrana nije rađeno | axe pokriva samo dio WCAG kriterija | pregled NVDA/VoiceOver |
| Testiranje na stvarnim mobilnim uređajima nije rađeno | emulacija i 6 širina su testirani | pregled na iOS i Android |
| Test harness traži Docker i Chrome | CI mora ih imati | GitHub Actions s `postgres` servisom |
| Nema UI za upravljanje korisnicima i brisanje korisnika | brisanje ide SQL-om (SECURITY.md) | po potrebi |
| Drag-and-drop radi mišem; tastatura i dodir koriste dugmad gore/dolje | nije pun dodirni drag | prihvatljivo, WCAG alternativa postoji |
| Hijerarhija događaja (JobFair → HOBOM) nije modelovana | povezivanje samo kroz naziv | opcionalni `seriesId` (ARCHITECTURE.md) |

## Preporučeni sljedeći koraci

1. Auth0 i produkcijska baza, prva ručna prijava admina.
2. CI (GitHub Actions) koji pokreće `typecheck`, `lint`, `build` i `npm test`.
3. Nonce CSP.
4. Ručna provjera pristupačnosti i mobilnog izgleda.
