import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { FeedbackClient } from "@/components/FeedbackClient";
import { SignInButton } from "@/components/SignInButton";

export const dynamic = "force-dynamic";

export default async function FeedbackTab({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  const user = await getCurrentUser();
  const p = await db.project.findUnique({
    where: { slug: project },
    include: { forms: { orderBy: { id: "asc" }, include: { questions: { where: { enabled: true }, orderBy: { position: "asc" } } } } },
  });
  if (!p) return null;
  if (p.forms.length === 0) return <div className="empty"><h2>Feedback forma još nije objavljena</h2><p>Provjeri ponovo nakon događaja.</p></div>;

  const submitted = user
    ? new Set((await db.feedbackResponse.findMany({ where: { userId: user.id, formId: { in: p.forms.map((f) => f.id) } }, select: { formId: true } })).map((r) => r.formId))
    : new Set<string>();

  return (
    <>
      {p.forms.map((f) => {
        const open = f.isOpen && (p.status === "PUBLISHED" || p.status === "COMPLETED");
        const identified = f.mode === "IDENTIFIED";
        const already = identified && f.oneResponsePerUser && submitted.has(f.id);
        return (
          <section key={f.id} className="panel" aria-labelledby={"f-" + f.id}>
            <div className="panel-head">
              <h2 id={"f-" + f.id}>{f.title}</h2>
              <span className={"pill " + (open ? "PUBLISHED" : "ARCHIVED")}>{open ? "Otvoreno" : "Zatvoreno"}</span>
            </div>
            {f.description ? <p className="hint">{f.description}</p> : null}

            {/* Način prikupljanja je uvijek vidljiv PRIJE slanja. */}
            <div className={"privacy " + (identified ? "ident" : "anon")} role="note">
              <b>{identified ? "Nije anonimno" : "Anonimno"}</b>
              <span>
                {identified
                  ? "Odgovori se povezuju s tvojim Google računom. Organizatori vide tvoje ime i email uz svaki odgovor."
                  : "Odgovor se ne povezuje s tvojim računom. Ne čuvamo ime, email ni IP adresu uz odgovor, a vrijeme se bilježi samo kao datum."}
              </span>
            </div>

            {!open ? (
              <p className="err">Feedback je zatvoren.</p>
            ) : identified && !user ? (
              <div className="cta">
                <p><b>Prijavi se da pošalješ feedback.</b> Ova forma traži Google prijavu.</p>
                <SignInButton />
              </div>
            ) : already ? (
              <p className="ok">Već si poslao/la feedback. Hvala!</p>
            ) : (
              <FeedbackClient
                formId={f.id}
                mode={f.mode}
                questions={f.questions.map((q) => ({ id: q.id, type: q.type, label: q.label, required: q.required, options: q.options }))}
              />
            )}
          </section>
        );
      })}
    </>
  );
}
