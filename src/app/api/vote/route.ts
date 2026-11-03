import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, sameOrigin } from "@/lib/session";
import { rateLimit } from "@/lib/util";

const Body = z.object({ pollId: z.string().min(1).max(64), optionId: z.string().min(1).max(64) });
const err = (error: string, status: number) => NextResponse.json({ error }, { status });

// Identitet dolazi ISKLJUČIVO iz verifikovane sesije. Tijelo zahtjeva nikad ne sadrži userId.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return err("Zahtjev odbijen.", 403);
  const user = await getCurrentUser();
  if (!user) return err("Prijavi se da bi glasao/la.", 401);
  if (!rateLimit("vote:" + user.id, 30, 60_000)) return err("Previše pokušaja. Pokušaj za minutu.", 429);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("Neispravan zahtjev.", 400);
  const { pollId, optionId } = parsed.data;

  const poll = await db.lunchPoll.findUnique({
    where: { id: pollId },
    include: { project: { select: { status: true } }, options: { select: { id: true } } },
  });
  // Nepublikovano se ponaša kao nepostojeće (ne otkriva da anketa postoji).
  if (!poll || poll.project.status === "DRAFT") return err("Anketa nije pronađena.", 404);
  if (poll.project.status !== "PUBLISHED" || !poll.isOpen) return err("Glasanje je zatvoreno.", 403);
  if (!poll.options.some((o) => o.id === optionId)) return err("Nepoznata opcija.", 400);

  const existing = await db.lunchVote.findUnique({ where: { pollId_userId: { pollId, userId: user.id } } });
  if (existing) {
    if (!poll.allowChange) return err("Već si glasao/la, a promjena glasa nije dozvoljena.", 409);
    if (existing.optionId === optionId) return NextResponse.json({ ok: true, changed: false });
    await db.lunchVote.update({ where: { id: existing.id }, data: { optionId } });
    return NextResponse.json({ ok: true, changed: true });
  }
  try {
    await db.lunchVote.create({ data: { pollId, optionId, userId: user.id } });
  } catch (e) {
    // Trka dva istovremena zahtjeva: jedinstveni ključ (pollId, userId) u bazi je konačna zaštita.
    if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") return err("Već si glasao/la u ovoj anketi.", 409);
    throw e;
  }
  return NextResponse.json({ ok: true, changed: true });
}
