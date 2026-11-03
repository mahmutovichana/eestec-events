import { db } from "@/lib/db";
import { AgendaView } from "@/components/AgendaView";

export const dynamic = "force-dynamic";

export default async function AgendaTab({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  const p = await db.project.findUnique({
    where: { slug: project },
    include: { agendas: { orderBy: { position: "asc" }, include: { items: { orderBy: { position: "asc" } } } } },
  });
  if (!p) return null;
  if (p.agendas.length === 0) return <p style={{ padding: "40px 0" }}>Agenda još nije objavljena.</p>;
  return (
    <>
      {p.agendas.map((a) => (
        <AgendaView key={a.id} title={a.title} dateLabel={a.dateLabel} items={a.items} href={`/e/${p.slug}/agenda/${a.slug}`} />
      ))}
    </>
  );
}
