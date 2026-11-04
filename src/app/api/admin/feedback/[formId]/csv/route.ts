import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { csvRow } from "@/lib/util";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ formId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "ADMIN") return new Response("Forbidden", { status: 403 });

  const { formId } = await params;
  const form = await db.feedbackForm.findUnique({
    where: { id: formId },
    include: {
      project: { select: { slug: true } },
      questions: { orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { position: "asc" }] },
      responses: { orderBy: { createdAt: "asc" }, include: { answers: true, user: { select: { name: true, email: true } } } },
    },
  });
  if (!form) return new Response("Not found", { status: 404 });

  const identified = form.mode === "IDENTIFIED";
  // Anonimna forma: u izvozu nema kolona o identitetu, a datum je zaokružen na dan.
  // Zaglavlje: trenutni tekst pitanja, uz oznaku arhive i raniji tekst ako su historijski odgovori dati pod drugačijim tekstom.
  const headerOf = (q: (typeof form.questions)[number]) => {
    const old = [...new Set(form.responses.flatMap((r) => r.answers.filter((a) => a.questionId === q.id).map((a) => a.questionLabel)))].filter((l) => l !== q.label);
    return q.label + (q.archivedAt ? " [arhivirano]" : "") + (old.length ? ` [ranije: ${old.join(" | ")}]` : "");
  };
  const head = [...(identified ? ["Ime", "Email"] : []), identified ? "Poslano (UTC)" : "Datum", ...form.questions.map(headerOf)];
  const rows = form.responses.map((r) => {
    const cells = form.questions.map((q) => {
      const a = r.answers.find((x) => x.questionId === q.id);
      if (!a) return "";
      return a.rating ?? a.text ?? a.choices.join("; ");
    });
    return csvRow([...(identified ? [r.user?.name ?? "", r.user?.email ?? ""] : []), identified ? r.createdAt.toISOString() : r.createdAt.toISOString().slice(0, 10), ...cells]);
  });
  return new Response("﻿" + [csvRow(head), ...rows].join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="feedback-${form.project.slug}.csv"`,
      "cache-control": "no-store",
    },
  });
}
