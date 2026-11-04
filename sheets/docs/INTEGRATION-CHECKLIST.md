# Provjera sa stvarnim Googleom (checklist)

Šta je već provjereno automatski, a šta traži vaš Google račun. **Lažni testovi (86+ testova) ne dokazuju ništa od ovoga.**

## A. Provjereno bez prijave, protiv stvarnog deploymenta (`node sheets/scripts/real-smoke.mjs`, 12/12)

Stvarni Chrome, izgrađeni frontend sa stvarnim `config.js`, stvarni Apps Script `/exec`, samo čitanje (ništa se ne upisuje u tabelu):

| Provjera | Rezultat |
|---|---|
| Frontend šalje `POST` (`Content-Type: text/plain`) na `script.google.com/macros/s/…/exec` | PASS |
| Nema CORS preflighta (nijedan `OPTIONS`) | PASS |
| Redirect na `script.googleusercontent.com` se slijedi, završni odgovor 200 sa `Access-Control-Allow-Origin: *` | PASS |
| Nema CORS/mrežnih grešaka u konzoli; stranica prikazuje odgovor servera (trenutno „nema objavljenih događaja“) | PASS |
| Backend je nova verzija (admin akcija `listAdmins` bez prijave → `UNAUTHENTICATED`, ne „Nepoznata akcija“) | PASS |
| Nepoznata akcija → `BAD_REQUEST`; tijelo > 200 KB → `BAD_REQUEST` | PASS |
| Lažni ID token: server zove Google `tokeninfo` (UrlFetch odobren), odbija ga i tretira zahtjev kao gosta, bez `INTERNAL` greške | PASS |
| Google Identity Services biblioteka se učitava | PASS |
| `config.js` ima stvarni Client ID | PASS |
| Google tabela anonimno: HTTP 401 (nije javna) | PASS (provjereno posebno) |

Pokrenuto s `http://127.0.0.1` origina. **Nije** provjereno s origina `https://mahmutovichana.github.io` jer stranica još nije objavljena (deploy čeka dozvolu grane, `SETUP.md` 5a). CORS odgovor je `*`, pa se za taj origin ne očekuje razlika, ali potvrdite u C.

## B. Zahtijeva vaš ručni pristup (ne mogu ih uraditi)

| # | Radnja | Ko |
|---|---|---|
| B1 | GitHub: Settings → Environments → github-pages → dozvoliti granu `feat/sheets-simplification`; Actions → Re-run failed jobs | admin repozitorija |
| B2 | Apps Script: zalijepiti **novi** `Code.gs`, **Deploy → Manage deployments → ✏ → New version → Deploy** (URL ostaje isti) | hana.mahmutovic@ |
| B3 | Apps Script: pokrenuti `setup` jednom (pravi list `AuditLog`, ne dira administratore) | hana.mahmutovic@ |
| B4 | Script properties: `CLIENT_ID` = `406203316711-fn9te97d8n67ff5gelc2e6cssnacvml2.apps.googleusercontent.com` (već postavljeno prema smoke testu, jer server odbija tokene umjesto `CONFIG` greške) | hana.mahmutovic@ |
| B5 | Google Cloud: origin `https://mahmutovichana.github.io` na postojećem klijentu (već ste ga unijeli) | hana.mahmutovic@ |
| B6 | Žuta mjesta `[POTVRDITI]` u pravnim stranicama | EESTEC |

## C. Test sa stvarnim računima (nakon B1–B3)

Anonimni (inkognito) prozor, `https://mahmutovichana.github.io/eestec-events/`:

1. [ ] Stranica se učitava, vidi se „Događaji“, nema crvenih grešaka u konzoli (F12).
2. [ ] `…/privacy/` i `…/terms/` se otvaraju bez prijave.
3. [ ] Klik **Prijava** → Google dugme se prikazuje (ako piše `origin_mismatch`: origin u konzoli nije tačan).
4. [ ] Prijava kao **svaki** od 8 administratora (hr, hana.mahmutovic, chair, pr, it, fr, cp, treasurer @eestec-sa.ba): pojavljuje se **Administracija**. Administracija → Administratori: „već se prijavljivao“ za one koji su se prijavili.
5. [ ] Prijava **običnim Google računom** (npr. privatni gmail): nema **Administracija**; `#/admin` → „Nemate pristup“; `#/admin/_admini` isto.
6. [ ] Administrator kreira događaj → agenda sa stavkom → ručak (2 opcije) → forma (ocjena + tekst) → **Objavi**. U tabeli se pojavljuju redovi; javni prozor (bez prijave) vidi događaj.
7. [ ] Običan račun: glasa; promijeni glas; admin vidi glasača u Rezultatima. Drugi običan račun glasa; zbir je 2.
8. [ ] Zatvorite anketu: običan račun više ne može glasati.
9. [ ] Anonimni feedback iz inkognita: u `FeedbackResponses` nema emaila/imena; vrijeme je `…T00:00:00.000Z`.
10. [ ] Identificirani feedback običnim računom: admin vidi ime i email; drugi pokušaj istog računa je odbijen.
11. [ ] Deaktivirajte jednog administratora u aplikaciji, pa ga prijavite: gubi pristup odmah (osvježite stranicu). Ponovo aktivirajte.
12. [ ] Pokušaj deaktivacije posljednjeg aktivnog administratora (privremeno deaktivirajte ostale na probnom okruženju): odbijen.
13. [ ] Tabela: `Admins` list ima 8 redova; list se ne pokazuje javno (inkognito otvaranje linka tabele traži prijavu).
14. [ ] Administracija → Čuvanje podataka → „Provjeri“: radi (na novim podacima daje 0).
15. [ ] CORS sa github.io origina: u F12 → Network, `exec` zahtjev je `POST`, bez `OPTIONS`, odgovor 200.
16. [ ] Sesija: nakon oko sat vremena prijava istekne; poruka „Sesija je istekla“ je razumljiva; ponovna prijava radi.
17. [ ] Mobilni telefon (iOS i Android): prijava Googleom, glasanje, feedback.

## D. Poznate nepoznanice (nisu provjerene nigdje)
- Da li Google Identity Services na `github.io` originu prikazuje dugme bez dodatnih postavki (FedCM/third-party cookies u nekim preglednicima).
- Stvarni oblik `email_verified` i `hd` u tokenu za vaše račune (kod prihvata `true` i `"true"`).
- Ponašanje `LockService` pod istovremenim glasanjem (testirano samo lažno).
- Google kvote (UrlFetch za provjeru tokena je keširan 5 minuta po tokenu).
