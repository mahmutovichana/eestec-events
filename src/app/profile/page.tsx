/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Hero, SiteFooter } from "@/components/Brand";

export const dynamic = "force-dynamic";
export const metadata = { title: "Moj profil", robots: { index: false, follow: false } };

const fmt = new Intl.DateTimeFormat("bs-BA", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Sarajevo" });

export default async function Profile() {
  const user = await requireUser("/profile");
  // Samo vlastiti podaci: svi upiti su filtrirani po userId iz sesije.
  const [votes, responses] = await Promise.all([
    db.lunchVote.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      include: { option: { select: { name: true } }, poll: { select: { title: true, isOpen: true, allowChange: true, project: { select: { slug: true, name: true, status: true } } } } },
    }),
    db.feedbackResponse.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { form: { select: { title: true, project: { select: { slug: true, name: true } } } } },
    }),
  ]);

  const events = new Map<string, string>();
  votes.forEach((v) => events.set(v.poll.project.slug, v.poll.project.name));
  responses.forEach((r) => events.set(r.form.project.slug, r.form.project.name));

  return (
    <>
      <Hero kicker="Moj profil" title={user.name} sub={user.email} />
      <main className="wrap" style={{ paddingTop: 32 }}>
        <section className="panel" style={{ marginTop: 0 }}>
          <div className="profile-head">
            {user.picture ? <img src={user.picture} alt="" width={72} height={72} referrerPolicy="no-referrer" /> : <span className="av big">{user.name.slice(0, 1).toUpperCase()}</span>}
            <div>
              <h2 style={{ marginBottom: 2 }}>{user.name}</h2>
              <p className="hint" style={{ marginBottom: 6 }}>{user.email}</p>
              <span className={"pill " + (user.role === "ADMIN" ? "PUBLISHED" : "DRAFT")}>{user.role === "ADMIN" ? "Admin" : "Korisnik"}</span>
            </div>
            <div className="actions" style={{ marginLeft: "auto" }}>
              {user.role === "ADMIN" ? <Link href="/admin" className="btn ghost sm">Admin panel</Link> : null}
              <a href="/auth/logout" className="btn sm">Odjavi se</a>
            </div>
          </div>
        </section>

        <section className="panel">
          <h2>Događaji u kojima si učestvovao/la</h2>
          {events.size === 0 ? (
            <p className="hint">Još nema aktivnosti. Glasaj u anketi za ručak ili pošalji feedback na stranici događaja.</p>
          ) : (
            <ul className="plain">
              {[...events].map(([slug, name]) => (
                <li key={slug}><Link href={`/e/${slug}`}>{name}</Link></li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Moji glasovi za ručak</h2>
          {votes.length === 0 ? <p className="hint">Nisi glasao/la ni u jednoj anketi.</p> : (
            <ul className="plain">
              {votes.map((v) => {
                const open = v.poll.isOpen && v.poll.project.status === "PUBLISHED";
                return (
                  <li key={v.id}>
                    <div>
                      <b>{v.option.name}</b>
                      <small>{v.poll.project.name} · {v.poll.title} · {fmt.format(v.updatedAt)}</small>
                    </div>
                    {open && v.poll.allowChange ? <Link className="btn ghost sm" href={`/e/${v.poll.project.slug}/lunch`}>Promijeni glas</Link> : <span className="pill ARCHIVED">{open ? "Bez izmjene" : "Zatvoreno"}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Moj feedback</h2>
          {responses.length === 0 ? <p className="hint">Nema poslanog feedbacka povezanog s tvojim računom.</p> : (
            <ul className="plain">
              {responses.map((r) => (
                <li key={r.id}>
                  <div><b>{r.form.title}</b><small>{r.form.project.name} · {fmt.format(r.createdAt)}</small></div>
                  <span className="pill PUBLISHED">Poslano</span>
                </li>
              ))}
            </ul>
          )}
          <p className="hint" style={{ marginTop: 12 }}>Anonimni feedback se ne vezuje za tvoj račun, pa se ovdje ne prikazuje.</p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
