# Migracija iz stare aplikacije (HOBOM i ostalo)

Princip: **samo čitanje iz stare baze, ništa se ne briše, ništa se ne prepisuje.** Stari kod i baza ostaju dok vi ne odlučite drugačije.

## Šta se prenosi

| Staro | Novo | Napomena |
|---|---|---|
| Project | Events | `year` iz datuma početka (ili datuma kreiranja); status se prenosi |
| Agenda | Agendas | `dateLabel` se pokuša pretvoriti u datum ("7. novembar 2026.", "10. 3. 2027."); ako ne uspije, izvještaj to navodi |
| AgendaItem | AgendaItems | `kind`, `notes`, `version` preneseni |
| LunchPoll / LunchOption | Polls / PollOptions | `isOpen`→status; `showResultsWhileOpen` → `ALWAYS`, inače `AFTER_CLOSE`; arhivirane opcije ostaju arhivirane |
| LunchVote | Votes | `google-oauth2|<broj>` → `userSub = <broj>`, što je isti identitet koji nosi Google ID token, pa se stari glas prepoznaje kad se korisnik ponovo prijavi |
| FeedbackForm / Question | FeedbackForms / FeedbackQuestions | `enabled=false` → arhivirano; tipovi preimenovani |
| FeedbackResponse / Answer | FeedbackResponses / FeedbackAnswers | snimak teksta pitanja se zadržava; anonimni odgovori ne dobijaju identitet |

## Šta se NE prenosi (i zašto)

- Tabela `User` kao zasebna: nije potrebna; ime i email idu uz glas/identificirani odgovor.
- `RateLimit`, `voterHash/netHash` otisci (osim što stari anonimni glasovi dobijaju `legacy:<otisak>` da ostanu u zbiru).
- Glasovi bez korisnika i bez otiska (obrisan korisnik): preskočeni, broj je u izvještaju.
- Prijave koje nisu Google (`dev|user` i sl.): dobijaju `legacy:` identitet, tj. ne mogu se poklopiti s budućom Google prijavom. Provjerite u izvještaju da nema pravih podataka u toj grupi.
- `oneResponsePerUser=false`: nova verzija dopušta jedan odgovor po računu za identificirane forme (upozorenje u izvještaju).

## Koraci

1. Pokrenite staru bazu (Docker Desktop, pa `docker compose up -d` u korijenu repozitorija).
2. Iz korijena: `node sheets/scripts/export-from-postgres.mjs`. Rezultat: `sheets/migration/out/import-payload.json` i `report.json` (folder je u `.gitignore` jer sadrži emailove; **ne objavljujte ga**).
3. Pročitajte `report.json` (upozorenja i preskočeno).
4. U novoj aplikaciji, kao admin: **Administracija → Uvoz podataka iz stare aplikacije** → izaberite `import-payload.json`. Prikazuje se broj dodanih i preskočenih redova po listu. Redovi čiji `id` već postoji se preskaču, pa je ponovni uvoz siguran. Uvoz validira ID-eve.
5. Uporedite brojeve (događaji, stavke, glasovi, odgovori) s izvještajem i pregledajte događaj u novoj aplikaciji. Datume agendi koje skripta nije prepoznala upišite ručno.
6. Tek nakon provjere razmislite o gašenju starog sistema (ARCHITECTURE.md, „Gašenje starog sistema“).

## Rollback

Nova tabela je samostalna. Ako uvoz nije dobar: u Google tabeli **File → Version history → Restore** na verziju prije uvoza, ili obrišite uvezene redove. Stara baza nije dirana.

## Status verifikacije

- Preslikavanje (`legacy-map.mjs`): **PASS**, 5 testova sa sintetičkim podacima u obliku stare šeme, uključujući uvoz kroz `importSeed` i prepoznavanje starog glasa pod novim Google tokenom (lažni Google).
- Stvarni izvoz iz razvojne baze: **BLOCKED** (u ovoj sesiji Docker nije bio pokrenut: `Can't reach database server at localhost:5433`). Nije dirnuto ništa. Pokrenite korak 1–2 i pogledajte izvještaj.
- Uvoz u stvarnu Google tabelu: **NOT RUN** (traži vašu tabelu i prijavu).
