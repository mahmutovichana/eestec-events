import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdminPage } from "@/lib/session";
import { fmtDateRange, STATUS_LABEL } from "@/lib/util";

export default async function Overview() {
  await requireAdminPage("/admin");
  const [events, published, users, votes, responses, recent, openPolls, openForms] = await Promise.all([
    db.project.count(),
    db.project.count({ where: { status: "PUBLISHED" } }),
    db.user.count(),
    db.lunchVote.count(),
    db.feedbackResponse.count(),
    db.project.findMany({ orderBy: { updatedAt: "desc" }, take: 5, include: { _count: { select: { agendas: true, polls: true, forms: true } } } }),
    db.lunchPoll.count({ where: { isOpen: true, project: { status: "PUBLISHED" } } }),
    db.feedbackForm.count({ where: { isOpen: true, project: { status: { in: ["PUBLISHED", "COMPLETED"] } } } }),
  ]);
  const tiles: [string, number, string][] = [
    ["Događaji", events, `${published} objavljeno`],
    ["Korisnici", users, "prijavljeni Google računi"],
    ["Glasovi za ručak", votes, `${openPolls} otvorenih anketa`],
    ["Odgovori na feedback", responses, `${openForms} otvorenih formi`],
  ];
  return (
    <>
      <div className="page-h"><div><h1>Pregled</h1><p>Stanje svih događaja na jednom mjestu.</p></div><Link href="/admin/events/new" className="btn">Novi događaj</Link></div>
      <div className="tiles">
        {tiles.map(([l, n, s]) => (
          <div className="tile" key={l}><span>{l}</span><b>{n}</b><small>{s}</small></div>
        ))}
      </div>
      <h2 className="sect">Nedavno mijenjano</h2>
      {recent.length === 0 ? (
        <div className="empty"><h2>Još nema događaja</h2><p>Kreiraj prvi događaj ili dupliciraj postojeći.</p><Link href="/admin/events/new" className="btn">Novi događaj</Link></div>
      ) : (
        <div className="projects">
          {recent.map((p) => (
            <Link key={p.id} href={`/admin/events/${p.id}`} className="pcard">
              <span className={"pill " + p.status}>{STATUS_LABEL[p.status]}</span>
              <h3>{p.name}</h3>
              <p>{[fmtDateRange(p.startsAt, p.endsAt), p.location].filter(Boolean).join(" · ") || `/e/${p.slug}`}</p>
              <p>{p._count.agendas} agende · {p._count.polls} ankete · {p._count.forms} feedback</p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
