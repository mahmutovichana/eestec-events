import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { csvRow } from "@/lib/util";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ pollId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "ADMIN") return new Response("Forbidden", { status: 403 });

  const { pollId } = await params;
  const poll = await db.lunchPoll.findUnique({
    where: { id: pollId },
    include: { project: { select: { slug: true } }, options: { orderBy: { position: "asc" } }, votes: { include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } } },
  });
  if (!poll) return new Response("Not found", { status: 404 });

  const total = poll.votes.length;
  const optName = new Map(poll.options.map((o) => [o.id, o.name]));
  const lines = [
    csvRow(["Opcija", "Broj glasova", "Postotak", "Glasovi prijavljenih", "Stari anonimni glasovi"]),
    ...poll.options.map((o) => {
      const v = poll.votes.filter((x) => x.optionId === o.id);
      return csvRow([o.name, v.length, total ? ((v.length / total) * 100).toFixed(1) + "%" : "0%", v.filter((x) => x.userId).length, v.filter((x) => !x.userId).length]);
    }),
    "",
    csvRow(["Ime", "Email", "Opcija", "Glasano (UTC)", "Vrsta"]),
    ...poll.votes.map((v) => csvRow([v.user?.name ?? "", v.user?.email ?? "", optName.get(v.optionId) ?? "", v.updatedAt.toISOString(), v.userId ? "prijavljen" : "stari anonimni"])),
  ];
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="lunch-${poll.project.slug}.csv"`,
      "cache-control": "no-store",
    },
  });
}
