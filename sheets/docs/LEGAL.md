# Pravne stranice i Google OAuth objava

Stranice su **statični HTML** u `sheets/web/public/` (nema JavaScripta, nema novih servisa ni zavisnosti), pa ih Google i svaki posjetilac mogu otvoriti bez prijave i bez izvršavanja aplikacije:

| Stranica | Putanja u projektu | Adresa na GitHub Pages |
|---|---|---|
| Politika privatnosti (BS + EN) | `sheets/web/public/privacy/index.html` | `https://mahmutovichana.github.io/eestec-events/privacy/` |
| Uslovi korištenja (BS + EN) | `sheets/web/public/terms/index.html` | `https://mahmutovichana.github.io/eestec-events/terms/` |
| Početna (home page) | aplikacija | `https://mahmutovichana.github.io/eestec-events/` |

Zadnji `/` je obavezan (GitHub Pages ih služi kao mape). `#/privacy` i `#/terms` unutar aplikacije preusmjeravaju na iste stranice. Podnožje aplikacije i prozor za prijavu imaju linkove na obje. Stil: `legal.css`, ista paleta kao aplikacija.

Stranice su dvojezične (bosanski + engleski) jer Google pregled traži da politika bude razumljiva recenzentu. Kad mijenjate jedan jezik, uskladite drugi.

## Šta politika tvrdi i kako je to provjereno

Svaka tvrdnja o ponašanju aplikacije ima automatsku provjeru u `sheets/test/legal.test.mjs` (poredi tekst s kodom): 6 sati za brojač anonimnog slanja, 5 minuta za keš tokena, anonimno vrijeme se zaokružuje na dan, profilna slika se ne koristi, nema kolačića ni analitike, server kontaktira samo Google `tokeninfo`, `sessionStorage`/`localStorage` upotreba. Ako promijenite kod, promijenite i stranice, inače test pada.

## Potvrđene odluke (već u tekstu)

| Odluka | Gdje u tekstu |
|---|---|
| Operativni kontakt za privatnost: `hana.mahmutovic@eestec-sa.ba` (odgovorna osoba; **nije** pravni rukovalac) | Privatnost §1, §8; Uslovi §8 |
| Lični podaci se čuvaju najviše **dvije godine (24 mjeseca)**; poslije toga anonimizacija (`RETENTION.md`) | Privatnost §6 |
| Zahtjeve za brisanje obrađuje bilo koji trenutno ovlašteni administrator | Privatnost §8 |
| Google tabela je privatna i u vlasništvu organizacijskog računa | Privatnost §4 |

## Odluke koje organizacija MORA još donijeti

Stranice **ne izmišljaju** pravni naziv, adresu, pravni osnov, nadležnost ni druge rokove. Ostaje žuta oznaka `[POTVRDITI: …]` (BS) / `[CONFIRM: …]` (EN) i upozorenje **NACRT / DRAFT** na vrhu obje stranice, sve dok se ne riješe. Trenutno: 14 oznaka u privatnosti (uključujući 2 u upozorenju) i 10 u uslovima; svaka odluka je ponovljena u oba jezika.

| # | Odluka | Gdje |
|---|---|---|
| 1 | **Pravni rukovalac podacima**: tačan pravni naziv, registrovana adresa, i da li je to EESTEC LC Sarajevo ili druga EESTEC jedinica. (Odvojeno od operativnog kontakta iz tabele iznad.) | Privatnost §1, Uslovi §1 |
| 2 | Da li je `hana.mahmutovic@eestec-sa.ba` i opća adresa za pitanja o uslovima | Uslovi §8 |
| 3 | **Pravni osnov** obrade i primjenjivi propis (npr. saglasnost; GDPR i/ili zakon BiH) | Privatnost §3 |
| 4 | Raspored provođenja roka čuvanja i odgovorna osoba; rokovi za administratorske zapise nakon deaktivacije i za dnevnik revizije | Privatnost §6 |
| 5 | Rok obrade zahtjeva (pristup/brisanje) | Privatnost §8 |
| 6 | Nadležno tijelo za žalbe | Privatnost §8 |
| 7 | Ciljna publika i minimalna dob | Privatnost §10 |
| 8 | Tekst ograničenja odgovornosti (preporuka: pravni savjet) | Uslovi §6 |
| 9 | **Mjerodavno pravo i nadležni sud** | Uslovi §7 |

Kad odluke donesete, zamijenite oznake konačnim tekstom (`<mark class="confirm">…</mark>` obrišite zajedno sa zagradama), obrišite žuti okvir „NACRT / DRAFT“ na vrhu obje stranice (`<div class="notice" role="note">…</div>`) i ažurirajte datum „Zadnje ažuriranje“. Test `legal.test.mjs` namjerno **ne** pada zbog oznaka; ispisuje njihov broj, a workflow daje upozorenje dok ih ima. Provjera da ih nema: `grep -c 'class="confirm"' sheets/web/public/*/index.html` mora dati 0.

> **Pažnja:** Google aplikacija je već „In production“ i pokazuje na ove stranice koje su trenutno označene kao NACRT. To je poštena, ali privremena situacija: što prije donesite odluke 1, 3, 9 i uklonite oznake.

## Poznata ograničenja trenutnog stanja (zapisana u politici)

- Aplikacija **nema samoposlužno brisanje**; odobrene zahtjeve obrađuje administrator kroz aplikaciju (anonimizacija ili potpuno brisanje, uz dnevnik revizije; politika to kaže).
- Anonimni odgovori se ne mogu povezati s osobom, pa se ne mogu ni obrisati na zahtjev (politika to kaže).
- Aplikacija ne briše ništa automatski (osim keša). Rok od 24 mjeseca provodi se ručno (Čuvanje podataka); raspored je otvorena odluka.
- Prosljeđivanje IP adrese Googleu (učitavanje prijave i fontova) i GitHubu (hosting) je navedeno u politici (§7).
- Ovo nije pravni savjet: pregled politike i uslova preporučujemo prije objave.
