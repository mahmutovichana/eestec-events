import { requireAdminPage, ADMIN_EMAIL, devAuthEnabled } from "@/lib/session";

export const metadata = { title: "Postavke" };

export default async function Settings() {
  const me = await requireAdminPage("/admin/settings");
  return (
    <>
      <div className="page-h"><div><h1>Postavke</h1><p>Pristup i sigurnost. Vrijednosti se mijenjaju u okruženju aplikacije, ne ovdje.</p></div></div>
      <section className="panel" style={{ marginTop: 0 }}>
        <h2>Administrator</h2>
        <p className="hint">Admin ulogu dobija samo verifikovan Google račun s ovom adresom. Uloga se računa na serveru iz Auth0 sesije pri svakom zahtjevu.</p>
        <dl className="kv">
          <dt>Admin email</dt><dd>{ADMIN_EMAIL}</dd>
          <dt>Prijavljen kao</dt><dd>{me.email}</dd>
          <dt>Način prijave</dt><dd>{devAuthEnabled() ? "Razvojni (DEV_AUTH), nikad u produkciji" : "Google preko Auth0"}</dd>
        </dl>
      </section>
      <section className="panel">
        <h2>Privatnost</h2>
        <ul className="plain">
          <li><div><b>Anonimni feedback</b><small>Odgovor nema userId, a vrijeme je zaokruženo na dan. Admin ne vidi identitet.</small></div></li>
          <li><div><b>Identificirani feedback</b><small>Odgovor je vezan za račun. Učesnik to vidi prije slanja.</small></div></li>
          <li><div><b>Promjena načina</b><small>Nije moguća kad forma već ima odgovore.</small></div></li>
        </ul>
      </section>
    </>
  );
}
