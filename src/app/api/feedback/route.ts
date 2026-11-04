import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, sameOrigin } from "@/lib/session";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/util";
import { feedbackAllowed, type Status } from "@/lib/status";

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

class Reject extends Error {
  constructor(public msg: string, public status: number) {
    super(msg);
  }
}

type QRow = { id: string; type: "RATING" | "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "SHORT_TEXT" | "LONG_TEXT"; label: string; options: string[]; required: boolean };

export async function POST(req: Request) {
  if (!sameOrigin(req)) return err("Zahtjev odbijen.", 403);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("Neispravan zahtjev.", 400);
  const { formId, answers, acknowledgedMode } = parsed.data;

  // Isto pitanje dvaput u jednom slanju je greška klijenta, ne tiho spajanje.
  if (new Set(answers.map((a) => a.questionId)).size !== answers.length) return err("Isto pitanje je poslano više puta.", 400);

  // Mod forme se čita bez sesije. ANONYMOUS: sesija se namjerno NE čita, pa ništa o korisniku ne može završiti u odgovoru.
  const meta = await db.feedbackForm.findUnique({ where: { id: formId }, select: { mode: true, project: { select: { status: true } } } });
  if (!meta || meta.project.status === "DRAFT") return err("Forma nije pronađena.", 404);
  if (meta.mode !== acknowledgedMode) return err("Način prikupljanja feedbacka je promijenjen. Osvježi stranicu i pročitaj nove uslove.", 409);

  let userId: string | null = null;
  if (meta.mode === "IDENTIFIED") {
    const user = await getCurrentUser();
    if (!user) return err("Prijavi se da bi poslao/la feedback.", 401);
    userId = user.id;
    if (!(await rateLimit(`fb:${formId}`, user.id, 10, 60 * 60_000))) return err("Previše slanja. Pokušaj kasnije.", 429);
  } else if (!(await rateLimit(`fb:${formId}`, clientIp(req), 10, 60 * 60_000))) {
    return err("Previše slanja. Pokušaj kasnije.", 429);
  }

  try {
    await db.$transaction(async (tx) => {
      // Zaključaj formu i događaj (FOR SHARE): zatvaranje/promjena moda čeka kraj slanja, a mi vidimo konačno stanje.
      const rows = await tx.$queryRaw<{ isOpen: boolean; mode: "ANONYMOUS" | "IDENTIFIED"; oneResponsePerUser: boolean; status: Status }[]>`
        SELECT f."isOpen", f."mode"::text AS "mode", f."oneResponsePerUser", pr."status"::text AS "status"
          FROM "FeedbackForm" f JOIN "Project" pr ON pr."id" = f."projectId"
         WHERE f."id" = ${formId}
           FOR SHARE OF f, pr`;
      const form = rows[0];
      if (!form || form.status === "DRAFT") throw new Reject("Forma nije pronađena.", 404);
      if (!feedbackAllowed(form.status) || !form.isOpen) throw new Reject("Feedback je zatvoren.", 403);
      if (form.mode !== acknowledgedMode) throw new Reject("Način prikupljanja feedbacka je promijenjen. Osvježi stranicu i pročitaj nove uslove.", 409);

      // Aktivna pitanja (uključena i nearhivirana), zaključana da se ne mijenjaju dok validiramo i upisujemo snimak.
      const questions = await tx.$queryRaw<QRow[]>`
        SELECT q."id", q."type"::text AS "type", q."label", q."options", q."required"
          FROM "FeedbackQuestion" q
         WHERE q."formId" = ${formId} AND q."enabled" = true AND q."archivedAt" IS NULL
           FOR SHARE`;
      const byId = new Map(questions.map((q) => [q.id, q]));

      const clean: { formId: string; questionId: string; questionLabel: string; questionType: QRow["type"]; questionOptions: string[]; rating: number | null; text: string | null; choices: string[] }[] = [];
      for (const a of answers) {
        const q = byId.get(a.questionId);
        // Isključeno, arhivirano ili tuđe pitanje: greška, ne tiho ignorisanje (klijent je poslao nešto što ne vidi).
        if (!q) throw new Reject("Pitanje više nije dostupno. Osvježi stranicu.", 409);
        const base = { formId, questionId: q.id, questionLabel: q.label, questionType: q.type, questionOptions: q.options };
        if (q.type === "RATING") {
          if (a.rating) clean.push({ ...base, rating: a.rating, text: null, choices: [] });
        } else if (q.type === "SHORT_TEXT" || q.type === "LONG_TEXT") {
          const t = a.text?.trim().slice(0, q.type === "SHORT_TEXT" ? 200 : 3000);
          if (t) clean.push({ ...base, rating: null, text: t, choices: [] });
        } else {
          const picked = [...new Set(a.choices ?? [])];
          if (picked.some((c) => !q.options.includes(c))) throw new Reject("Neispravan izbor.", 400);
          if (q.type === "SINGLE_CHOICE" && picked.length > 1) throw new Reject("Dozvoljen je samo jedan izbor.", 400);
          if (picked.length) clean.push({ ...base, rating: null, text: null, choices: picked });
        }
      }
      for (const q of questions) {
        if (q.required && !clean.some((c) => c.questionId === q.id)) throw new Reject(`Obavezno pitanje: ${q.label}`, 400);
      }
      if (clean.length === 0) throw new Reject("Odgovori na barem jedno pitanje.", 400);

      if (userId && form.oneResponsePerUser) {
        // Advisory lock serijalizuje istovremena slanja istog korisnika na istu formu.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${formId + ":" + userId}))`;
        if (await tx.feedbackResponse.findFirst({ where: { formId, userId }, select: { id: true } })) {
          throw new Reject("Već si poslao/la feedback za ovu formu.", 409);
        }
      }

      // Anonimno: vrijeme se zaokružuje na dan da se odgovor ne može povezati s trenutkom prijave.
      const createdAt = form.mode === "ANONYMOUS" ? new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z") : undefined;
      // Odgovori se upisuju sa createMany: složeni FK (formId, responseId) traži eksplicitne skalarne ključeve.
      const response = await tx.feedbackResponse.create({ data: { formId, userId, createdAt }, select: { id: true } });
      await tx.feedbackAnswer.createMany({ data: clean.map((a) => ({ ...a, responseId: response.id })) });
    });
  } catch (e) {
    if (e instanceof Reject) return err(e.msg, e.status);
    throw e;
  }
  return NextResponse.json({ ok: true });
}
