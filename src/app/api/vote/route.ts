import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, sameOrigin } from "@/lib/session";
import { rateLimit } from "@/lib/ratelimit";
import { votingAllowed, type Status } from "@/lib/status";

const Body = z.object({ pollId: z.string().min(1).max(64), optionId: z.string().min(1).max(64) });
const err = (error: string, status: number) => NextResponse.json({ error }, { status });

type Outcome =
  | { kind: "ok"; changed: boolean }
  | { kind: "notfound" }
  | { kind: "closed" }
  | { kind: "badoption" }
  | { kind: "nochange" };

// Identitet dolazi ISKLJUČIVO iz verifikovane sesije. Tijelo zahtjeva nikad ne sadrži userId.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return err("Zahtjev odbijen.", 403);
  const user = await getCurrentUser();
  if (!user) return err("Prijavi se da bi glasao/la.", 401);
  if (!(await rateLimit("vote", user.id, 30, 60_000))) return err("Previše pokušaja. Pokušaj za minutu.", 429);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("Neispravan zahtjev.", 400);
  const { pollId, optionId } = parsed.data;

  // Najviše dva pokušaja: drugi je potreban samo kad dva istovremena zahtjeva istog korisnika oba pokušaju kreirati glas.
  let outcome: Outcome | undefined;
  for (let attempt = 0; attempt < 2 && !outcome; attempt++) {
    try {
      outcome = await db.$transaction(async (tx): Promise<Outcome> => {
        // FOR SHARE na anketi i događaju: admin UPDATE (zatvaranje, promjena statusa) čeka da se glasanje završi,
        // a svako glasanje nakon toga vidi zatvoreno stanje. Tako nema glasa "nakon zatvaranja".
        const rows = await tx.$queryRaw<{ isOpen: boolean; allowChange: boolean; status: Status }[]>`
          SELECT p."isOpen", p."allowChange", pr."status"::text AS "status"
            FROM "LunchPoll" p JOIN "Project" pr ON pr."id" = p."projectId"
           WHERE p."id" = ${pollId}
             FOR SHARE OF p, pr`;
        const poll = rows[0];
        // Nacrt se ponaša kao nepostojeće (ne otkriva da anketa postoji).
        if (!poll || poll.status === "DRAFT") return { kind: "notfound" };
        if (!votingAllowed(poll.status) || !poll.isOpen) return { kind: "closed" };

        // Opcija mora pripadati OVOJ anketi i ne smije biti arhivirana. (Baza dodatno garantuje isti pollId.)
        const option = await tx.lunchOption.findFirst({ where: { id: optionId, pollId, archivedAt: null }, select: { id: true } });
        if (!option) return { kind: "badoption" };

        const existing = await tx.lunchVote.findUnique({ where: { pollId_userId: { pollId, userId: user.id } } });
        if (existing) {
          if (!poll.allowChange) return { kind: "nochange" };
          if (existing.optionId === optionId) return { kind: "ok", changed: false };
          await tx.lunchVote.update({ where: { id: existing.id }, data: { optionId } });
          return { kind: "ok", changed: true };
        }
        await tx.lunchVote.create({ data: { pollId, optionId, userId: user.id } });
        return { kind: "ok", changed: true };
      });
    } catch (e) {
      // P2002: unique (pollId, userId) je konačna zaštita od duplikata. Ponovi transakciju, sada će naći postojeći glas.
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  if (!outcome) return err("Već si glasao/la u ovoj anketi.", 409);

  switch (outcome.kind) {
    case "ok":
      return NextResponse.json({ ok: true, changed: outcome.changed });
    case "notfound":
      return err("Anketa nije pronađena.", 404);
    case "closed":
      return err("Glasanje je zatvoreno.", 403);
    case "badoption":
      return err("Nepoznata opcija.", 400);
    case "nochange":
      return err("Već si glasao/la, a promjena glasa nije dozvoljena.", 409);
  }
}
