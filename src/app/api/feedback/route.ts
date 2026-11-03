import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, sameOrigin } from "@/lib/session";
import { clientIp, rateLimit } from "@/lib/util";

const Body = z.object({
  formId: z.string().min(1).max(64),
  // Način koji je učesnik vidio prije slanja. Ako se u međuvremenu promijenio, odbijamo slanje.
  acknowledgedMode: z.enum(["ANONYMOUS", "IDENTIFIED"]),
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1).max(64),
        rating: z.number().int().min(1).max(5).optional(),
        text: z.string().max(3000).optional(),
        choices: z.array(z.string().max(200)).max(20).optional(),
      }),
    )
    .max(60),
});

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return err("Zahtjev odbijen.", 403);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("Neispravan zahtjev.", 400);
  const { formId, answers, acknowledgedMode } = parsed.data;

  const form = await db.feedbackForm.findUnique({
    where: { id: formId },
    include: { project: { select: { status: true } }, questions: { where: { enabled: true } } },
  });
  if (!form || form.project.status === "DRAFT") return err("Forma nije pronađena.", 404);
  if (!["PUBLISHED", "COMPLETED"].includes(form.project.status) || !form.isOpen) return err("Feedback je zatvoren.", 403);
  if (form.mode !== acknowledgedMode) return err("Način prikupljanja feedbacka je promijenjen. Osvježi stranicu i pročitaj nove uslove.", 409);

  // ANONYMOUS: sesija se namjerno NE čita. Ništa o korisniku ne može završiti u odgovoru.
  let userId: string | null = null;
  if (form.mode === "IDENTIFIED") {
    const user = await getCurrentUser();
    if (!user) return err("Prijavi se da bi poslao/la feedback.", 401);
    userId = user.id;
    if (!rateLimit(`fb:${formId}:${user.id}`, 10, 60 * 60_000)) return err("Previše slanja. Pokušaj kasnije.", 429);
  } else if (!rateLimit(`fb:${formId}:${clientIp(req)}`, 10, 60 * 60_000)) {
    return err("Previše slanja. Pokušaj kasnije.", 429);
  }

  const byId = new Map(form.questions.map((q) => [q.id, q]));
  const clean: { questionId: string; rating: number | null; text: string | null; choices: string[] }[] = [];
  for (const a of answers) {
    const q = byId.get(a.questionId);
    if (!q) continue;
    if (q.type === "RATING") {
      if (a.rating) clean.push({ questionId: q.id, rating: a.rating, text: null, choices: [] });
    } else if (q.type === "SHORT_TEXT" || q.type === "LONG_TEXT") {
      const t = a.text?.trim().slice(0, q.type === "SHORT_TEXT" ? 200 : 3000);
      if (t) clean.push({ questionId: q.id, rating: null, text: t, choices: [] });
    } else {
      const picked = [...new Set(a.choices ?? [])];
      if (picked.some((c) => !q.options.includes(c))) return err("Neispravan izbor.", 400);
      if (q.type === "SINGLE_CHOICE" && picked.length > 1) return err("Dozvoljen je samo jedan izbor.", 400);
      if (picked.length) clean.push({ questionId: q.id, rating: null, text: null, choices: picked });
    }
  }
  for (const q of form.questions) {
    if (q.required && !clean.some((c) => c.questionId === q.id)) return err(`Obavezno pitanje: ${q.label}`, 400);
  }
  if (clean.length === 0) return err("Odgovori na barem jedno pitanje.", 400);

  // Anonimno: vrijeme se zaokružuje na dan da se odgovor ne može povezati s trenutkom prijave.
  const createdAt = form.mode === "ANONYMOUS" ? new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z") : undefined;

  const created = await db.$transaction(async (tx) => {
    if (userId && form.oneResponsePerUser) {
      // Advisory lock serijalizuje istovremena slanja istog korisnika na istu formu.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${formId + ":" + userId}))`;
      if (await tx.feedbackResponse.findFirst({ where: { formId, userId }, select: { id: true } })) return false;
    }
    await tx.feedbackResponse.create({ data: { formId, userId, createdAt, answers: { create: clean } } });
    return true;
  });
  if (!created) return err("Već si poslao/la feedback za ovu formu.", 409);
  return NextResponse.json({ ok: true });
}
