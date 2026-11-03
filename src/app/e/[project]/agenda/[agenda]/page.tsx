import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { AgendaView } from "@/components/AgendaView";

export const dynamic = "force-dynamic";

export default async function SingleAgenda({ params }: { params: Promise<{ project: string; agenda: string }> }) {
  const { project, agenda } = await params;
  const a = await db.agenda.findFirst({
    where: { slug: agenda, project: { slug: project } },
    include: { items: { orderBy: { position: "asc" } } },
  });
  if (!a) notFound();
  return (
    <>
      <AgendaView title={a.title} dateLabel={a.dateLabel} items={a.items} />
      <p style={{ marginTop: 20 }}>
        <Link href={`/e/${project}`} className="btn ghost sm">
          Sve agende
        </Link>
      </p>
    </>
  );
}
