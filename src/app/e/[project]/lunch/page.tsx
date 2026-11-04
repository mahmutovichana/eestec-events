import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { PollClient } from "@/components/PollClient";
import { SignInButton } from "@/components/SignInButton";

export const dynamic = "force-dynamic";

export default async function LunchTab({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  const user = await getCurrentUser();
  const p = await db.project.findUnique({
    where: { slug: project },
    include: {
      polls: {
        orderBy: { id: "asc" },
        include: { options: { orderBy: { position: "asc" }, include: { _count: { select: { votes: true } } } } },
      },
    },
  });
  if (!p) return null;
  if (p.polls.length === 0) {
    return <div className="empty"><h2>Anketa za ručak još nije objavljena</h2><p>Provjeri ponovo bliže događaju.</p></div>;
  }

  const mine = user
    ? await db.lunchVote.findMany({ where: { userId: user.id, pollId: { in: p.polls.map((x) => x.id) } }, select: { pollId: true, optionId: true } })
    : [];

  return (
    <>
      {p.polls.map((poll) => {
        const open = poll.isOpen && p.status === "PUBLISHED";
        const myOpt = mine.find((m) => m.pollId === poll.id)?.optionId ?? null;
        const total = poll.options.reduce((s, o) => s + o._count.votes, 0);
        const showResults = !open || poll.showResultsWhileOpen;
        const live = poll.options.filter((o) => !o.archivedAt);
        // Rezultati uključuju i arhivirane opcije koje imaju glasove, da zbir odgovara stvarnom broju glasova.
        const shown = poll.options.filter((o) => !o.archivedAt || o._count.votes > 0);
        const maxVotes = Math.max(1, ...shown.map((o) => o._count.votes));
        return (
          <section key={poll.id} className="panel" aria-labelledby={"p-" + poll.id}>
            <div className="panel-head">
              <h2 id={"p-" + poll.id}>{poll.title}</h2>
              <span className={"pill " + (open ? "PUBLISHED" : "ARCHIVED")}>{open ? "Otvoreno" : "Zatvoreno"}</span>
            </div>
            {poll.description ? <p className="hint">{poll.description}</p> : null}

            {open && !user ? (
              <div className="cta">
                <p><b>Prijavi se da glasaš.</b> Glasanje je vezano za Google račun, jedan glas po osobi.</p>
                <SignInButton />
              </div>
            ) : null}

            {open && user ? (
              <PollClient pollId={poll.id} options={live} current={myOpt && live.some((o) => o.id === myOpt) ? myOpt : null} canChange={poll.allowChange} />
            ) : (
              <div>
                {live.map((o) => (
                  <div key={o.id} className={"opt static" + (myOpt === o.id ? " mine" : "")}>
                    <span>
                      <b>{o.name}{myOpt === o.id ? " · tvoj izbor" : ""}</b>
                      {o.description ? <small>{o.description}</small> : null}
                      {o.allergens ? <span className="allergen">Alergeni: {o.allergens}</span> : null}
                    </span>
                  </div>
                ))}
                {!open ? <p className="hint">Glasanje je zatvoreno.</p> : null}
              </div>
            )}

            {showResults ? (
              <div className="results" style={{ marginTop: 22 }}>
                <h3>Rezultati · {total} {total === 1 ? "glas" : "glasova"}</h3>
                {shown.map((o) => {
                  const pct = total ? Math.round((o._count.votes / total) * 100) : 0;
                  return (
                    <div className="bar-row" key={o.id}>
                      <div className="top"><span>{o.name}{o.archivedAt ? " (uklonjeno iz ponude)" : ""}</span><span>{o._count.votes} · {pct}%</span></div>
                      <div className="track" role="img" aria-label={`${o.name}: ${o._count.votes} glasova, ${pct}%`}>
                        <div className="fill" style={{ width: (o._count.votes / maxVotes) * 100 + "%" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="hint" style={{ marginTop: 16 }}>Rezultati će biti vidljivi kad se glasanje zatvori.</p>
            )}
          </section>
        );
      })}
    </>
  );
}
