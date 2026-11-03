"use client";
import { useEffect, useRef, useState } from "react";
import { deleteItem, reorderItems, saveItem, type ItemFields } from "@/app/admin/actions";
import { useToast } from "./Toast";
import { ConfirmButton } from "./ConfirmButton";

export type EItem = ItemFields & { id: string };

const KINDS: [string, string][] = [["SESSION", "Sesija"], ["TALK", "Govor"], ["BREAK", "Pauza"], ["MEAL", "Ručak"], ["END", "Kraj"]];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function validate(f: ItemFields): string {
  if (!f.title.trim()) return "Unesi naslov.";
  if (!TIME.test(f.startTime) || !TIME.test(f.endTime)) return "Vrijeme mora biti HH:MM.";
  if (f.endTime < f.startTime) return "Kraj ne može biti prije početka.";
  return "";
}

type Status = "saved" | "dirty" | "saving" | "error";

function Card({ item, index, count, onMove, onDelete, dnd }: {
  item: EItem; index: number; count: number; onMove: (d: -1 | 1) => void; onDelete: () => void;
  dnd: { onDragStart: () => void; onDragEnd: () => void; onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void; className: string };
}) {
  const [f, setF] = useState<ItemFields>(item);
  const [status, setStatus] = useState<Status>("saved");
  const [msg, setMsg] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const first = useRef(true);
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(f);
  latest.current = f;

  // Autosave: 900 ms nakon zadnje izmjene, samo ako je unos ispravan.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    clearTimeout(timer.current);
    const bad = validate(f);
    if (bad) { setStatus("error"); setMsg(bad); return; }
    setStatus("dirty"); setMsg("");
    timer.current = setTimeout(async () => {
      setStatus("saving");
      const r = await saveItem(item.id, latest.current);
      if (r.ok) setStatus("saved"); else { setStatus("error"); setMsg(r.error); }
    }, 900);
    return () => clearTimeout(timer.current);
  }, [f, item.id]);

  const set = <K extends keyof ItemFields>(k: K, v: ItemFields[K]) => setF((p) => ({ ...p, [k]: v }));
  const label = { saved: "Sačuvano", dirty: "Nesačuvane izmjene…", saving: "Čuvam…", error: msg }[status];

  return (
    <div ref={root} className={dnd.className} onDragOver={dnd.onDragOver} onDrop={dnd.onDrop} role="group" aria-label={`Stavka ${index + 1}: ${f.title}`}>
      <div className="top">
        <span className="handle" title="Povuci za promjenu redoslijeda" aria-hidden="true" draggable onDragStart={(e) => { if (root.current) e.dataTransfer.setDragImage(root.current, 24, 24); e.dataTransfer.effectAllowed = "move"; dnd.onDragStart(); }} onDragEnd={dnd.onDragEnd}>⠿</span>
        <button type="button" className="btn ghost sm" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Pomjeri gore">↑</button>
        <button type="button" className="btn ghost sm" onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Pomjeri dolje">↓</button>
        <strong className="item-title">{f.startTime} – {f.endTime} · {f.title || "Bez naslova"}</strong>
        <span className={"save-state " + status} role="status">{label}</span>
      </div>
      <div className="grid3">
        <label className="f">Početak<input type="time" value={f.startTime} onChange={(e) => set("startTime", e.target.value)} required /></label>
        <label className="f">Kraj<input type="time" value={f.endTime} onChange={(e) => set("endTime", e.target.value)} required /></label>
        <label className="f">Naslov<input type="text" value={f.title} maxLength={200} onChange={(e) => set("title", e.target.value)} required /></label>
      </div>
      <div className="grid2">
        <label className="f">Govornik<input type="text" value={f.speaker} maxLength={160} onChange={(e) => set("speaker", e.target.value)} /></label>
        <label className="f">Lokacija<input type="text" value={f.location} maxLength={160} onChange={(e) => set("location", e.target.value)} /></label>
      </div>
      <label className="f">Opis<textarea value={f.description} maxLength={1500} onChange={(e) => set("description", e.target.value)} style={{ minHeight: 56 }} /></label>
      <label className="f">Napomena (prikazuje se uz stavku)<input type="text" value={f.notes} maxLength={1500} onChange={(e) => set("notes", e.target.value)} /></label>
      <div className="actions">
        <label className="f inline">Tip
          <select value={f.kind} onChange={(e) => set("kind", e.target.value as ItemFields["kind"])}>
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <ConfirmButton
          action={async () => { onDelete(); return { ok: true as const }; }}
          fields={{}} title="Obrisati stavku?" message={`"${f.title}" će biti trajno obrisana iz agende.`}
        >
          Obriši
        </ConfirmButton>
      </div>
    </div>
  );
}

export function ItemEditor({ agendaId, initial }: { agendaId: string; initial: EItem[] }) {
  const [items, setItems] = useState(initial);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const toast = useToast();

  // Nove stavke s servera (dodane formom ispod) se dodaju u listu bez resetovanja kartica koje se uređuju.
  useEffect(() => {
    setItems((cur) => {
      const have = new Set(cur.map((i) => i.id));
      const add = initial.filter((i) => !have.has(i.id));
      return add.length ? [...cur, ...add] : cur;
    });
  }, [initial]);

  async function persist(next: EItem[]) {
    setItems(next);
    const r = await reorderItems(agendaId, next.map((i) => i.id));
    toast(r.ok ? "ok" : "err", r.ok ? "Redoslijed je sačuvan." : r.error);
  }
  const move = (id: string, d: -1 | 1) => {
    const i = items.findIndex((x) => x.id === id), j = i + d;
    if (j < 0 || j >= items.length) return;
    const n = [...items]; [n[i], n[j]] = [n[j], n[i]]; persist(n);
  };
  function drop(target: string) {
    if (!drag || drag === target) return;
    const n = [...items];
    const [m] = n.splice(n.findIndex((i) => i.id === drag), 1);
    n.splice(n.findIndex((i) => i.id === target), 0, m);
    persist(n);
  }
  async function remove(id: string) {
    const r = await deleteItem(id);
    if (r.ok) setItems((x) => x.filter((i) => i.id !== id));
    toast(r.ok ? "ok" : "err", r.ok ? "Stavka je obrisana." : r.error);
  }

  if (items.length === 0) return <div className="empty"><h2>Agenda je prazna</h2><p>Dodaj prvu stavku ispod.</p></div>;

  return (
    <div>
      {items.map((it, i) => (
        <Card
          key={it.id} item={it} index={i} count={items.length}
          onMove={(d) => move(it.id, d)} onDelete={() => remove(it.id)}
          dnd={{
            className: "item" + (drag === it.id ? " dragging" : "") + (over === it.id ? " over" : ""),
            onDragStart: () => setDrag(it.id),
            onDragEnd: () => { setDrag(null); setOver(null); },
            onDragOver: (e) => { e.preventDefault(); setOver(it.id); },
            onDrop: (e) => { e.preventDefault(); drop(it.id); setOver(null); },
          }}
        />
      ))}
    </div>
  );
}
