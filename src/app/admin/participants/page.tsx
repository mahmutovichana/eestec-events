/* eslint-disable @next/next/no-img-element */
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/session";

export const metadata = { title: "Učesnici" };
const fmt = new Intl.DateTimeFormat("bs-BA", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Sarajevo" });

export default async function Participants({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdminPage("/admin/participants");
  const { q = "" } = await searchParams;
  const users = await db.user.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {},
    orderBy: { lastLoginAt: "desc" },
    take: 200,
    include: { _count: { select: { votes: true, responses: true } } },
  });
  return (
    <>
      <div className="page-h"><div><h1>Učesnici</h1><p>Svi koji su se prijavili Google računom.</p></div></div>
      <form className="filters" role="search">
        <label className="f" style={{ flex: 1, margin: 0 }}>Pretraga<input type="text" name="q" defaultValue={q} placeholder="Ime ili email" /></label>
        <button className="btn ghost">Traži</button>
      </form>
      {users.length === 0 ? (
        <div className="empty"><h2>{q ? "Nema rezultata" : "Još se niko nije prijavio"}</h2><p>Korisnici se pojavljuju nakon prve prijave.</p></div>
      ) : (
        <div className="table-wrap" role="region" aria-label="Tabela učesnika" tabIndex={0}>
          <table>
            <thead><tr><th>Korisnik</th><th>Uloga</th><th>Glasovi</th><th>Identif. feedback</th><th>Zadnja prijava</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><div className="ucell">{u.picture ? <img src={u.picture} alt="" width={28} height={28} referrerPolicy="no-referrer" /> : <span className="av sm">{u.name.slice(0, 1).toUpperCase()}</span>}<div><b>{u.name}</b><small>{u.email}</small></div></div></td>
                  <td><span className={"pill " + (u.role === "ADMIN" ? "PUBLISHED" : "DRAFT")}>{u.role === "ADMIN" ? "Admin" : "Korisnik"}</span></td>
                  <td>{u._count.votes}</td>
                  <td>{u._count.responses}</td>
                  <td>{fmt.format(u.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
