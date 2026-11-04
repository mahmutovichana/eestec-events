# Pravne stranice i Google OAuth objava

Stranice su **statični HTML** u `sheets/web/public/` (nema JavaScripta, nema novih servisa ni zavisnosti), pa ih Google i svaki posjetilac mogu otvoriti bez prijave i bez izvršavanja aplikacije:

| Stranica | Putanja u projektu | Adresa na GitHub Pages |
|---|---|---|
| Politika privatnosti (BS + EN) | `sheets/web/public/privacy/index.html` | `https://IMEKORISNIKA.github.io/eestec-events/privacy/` |
| Uslovi korištenja (BS + EN) | `sheets/web/public/terms/index.html` | `https://IMEKORISNIKA.github.io/eestec-events/terms/` |
| Početna (home page) | aplikacija | `https://IMEKORISNIKA.github.io/eestec-events/` |

Zadnji `/` je obavezan (GitHub Pages ih služi kao mape). `#/privacy` i `#/terms` unutar aplikacije preusmjeravaju na iste stranice. Podnožje aplikacije i prozor za prijavu imaju linkove na obje. Stil: `legal.css`, ista paleta kao aplikacija.

Stranice su dvojezične (bosanski + engleski) jer Google pregled traži da politika bude razumljiva recenzentu. Kad mijenjate jedan jezik, uskladite drugi.

## Šta politika tvrdi i kako je to provjereno

Svaka tvrdnja o ponašanju aplikacije ima automatsku provjeru u `sheets/test/legal.test.mjs` (poredi tekst s kodom): 6 sati za brojač anonimnog slanja, 5 minuta za keš tokena, anonimno vrijeme se zaokružuje na dan, profilna slika se ne koristi, nema kolačića ni analitike, server kontaktira samo Google `tokeninfo`, `sessionStorage`/`localStorage` upotreba. Ako promijenite kod, promijenite i stranice, inače test pada.

## Odluke koje organizacija MORA potvrditi prije objave

Stranice **ne izmišljaju** rokove, pravni osnov ni organizacijske politike. Na svakom mjestu gdje je potrebna odluka stoji žuta oznaka `[POTVRDITI: …]` (BS) / `[CONFIRM: …]` (EN). Trenutno: 16 oznaka u privatnosti, 10 u uslovima (svaka odluka je ponovljena u oba jezika).

| # | Odluka | Gdje |
|---|---|---|
| 1 | Tačan pravni naziv i adresa rukovaoca podacima; da li je to EESTEC LC Sarajevo ili druga EESTEC jedinica | Privatnost §1, Uslovi §1 |
| 2 | Adresa za zahtjeve o privatnosti (sada `hr@eestec-sa.ba`, što je i javni kontakt iz `Settings`) | Privatnost §1, §8, Uslovi §8 |
| 3 | Pravni osnov obrade i primjenjivi propis (npr. saglasnost korisnika; da li se primjenjuje GDPR i/ili zakon BiH o zaštiti ličnih podataka) | Privatnost §3 |
| 4 | **Rokovi čuvanja** za: glasove s imenima/emailovima, identificirane odgovore, anonimne odgovore, događaje i agende, neaktivne administratore; ko i kada briše | Privatnost §6 |
| 5 | Rok i odgovorna osoba za zahtjeve o brisanju/pristupu | Privatnost §8 |
| 6 | Nadležno tijelo za žalbe (zaštita podataka) | Privatnost §8 |
| 7 | Ciljna publika i minimalna dob | Privatnost §10 |
| 8 | Tekst ograničenja odgovornosti (preporuka: pravni savjet) | Uslovi §6 |
| 9 | Mjerodavno pravo i nadležni sud | Uslovi §7 |

Kad odluke donesete, zamijenite oznake konačnim tekstom (`<mark class="confirm">…</mark>` obrišite zajedno sa zagradama) obrišite i žutu „Napomenu za organizaciju / Note for the organisation“ na vrhu obje stranice (`<div class="notice" role="note">…</div>`) i ažurirajte datum „Zadnje ažuriranje“. Test `legal.test.mjs` namjerno **ne** pada zbog oznaka (da ne blokira razvoj); ispisuje njihov broj. Prije slanja Googleu provjerite da ih nema: `grep -c 'class="confirm"' sheets/web/public/*/index.html` mora dati 0.

## Poznata ograničenja trenutnog stanja (zapisana u politici)

- Aplikacija **nema samoposlužno brisanje**; zahtjeve rješava administrator ručno u tabeli (politika to kaže).
- Anonimni odgovori se ne mogu povezati s osobom, pa se ne mogu ni obrisati na zahtjev (politika to kaže).
- Aplikacija ne briše ništa automatski (osim keša). Dok rokove ne odredite, politika kaže da rokovi nisu određeni.
- Prosljeđivanje IP adrese Googleu (učitavanje prijave i fontova) i GitHubu (hosting) je navedeno u politici (§7).
- Ovo nije pravni savjet: pregled politike i uslova preporučujemo prije objave.
