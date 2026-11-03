import { CopyLink } from "./CopyLink";
import { fmtDuration, toMin } from "@/lib/util";

type Item = {
  id: string;
  startTime: string;
  endTime: string;
  title: string;
  description: string;
  speaker: string;
  location: string;
  notes?: string;
  kind: string;
};

export function AgendaView({
  title,
  dateLabel,
  items,
  href,
}: {
  title: string;
  dateLabel?: string;
  items: Item[];
  href?: string;
}) {
  const first = items[0]?.startTime;
  const last = items[items.length - 1]?.endTime;
  return (
    <section className="day">
      <div className="dayhead">
        <h2>{title}</h2>
        <span className="bar" />
        {dateLabel ? <span className="chip">{dateLabel}</span> : null}
        {first && last ? (
          <span className="chip">
            {first} – {last}
          </span>
        ) : null}
        {href ? <CopyLink path={href} label="Kopiraj link agende" className="chip btnlike" /> : null}
      </div>
      {items.length === 0 ? <p>Agenda još nije popunjena.</p> : null}
      <ol className="list">
        {items.map((it) => {
          const dur = toMin(it.endTime) - toMin(it.startTime);
          return (
            <li key={it.id} className="row">
              <div className="time">{it.startTime}</div>
              <div className={"card " + it.kind}>
                <div>
                  <h3>{it.title}</h3>
                  {dur > 0 ? (
                    <div className="rng">
                      {it.startTime} – {it.endTime}
                    </div>
                  ) : null}
                  {it.description ? <p className="desc">{it.description}</p> : null}
                  {it.notes ? <p className="note">{it.notes}</p> : null}
                  {it.speaker || it.location ? (
                    <div className="meta">
                      {it.speaker ? <span>Govornik: {it.speaker}</span> : null}
                      {it.location ? <span>Lokacija: {it.location}</span> : null}
                    </div>
                  ) : null}
                </div>
                {dur > 0 ? <span className="dur">{fmtDuration(dur)}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
