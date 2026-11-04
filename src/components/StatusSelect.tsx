"use client";
import { useTransition } from "react";
import { useToast } from "./Toast";
import { setEventStatus } from "@/app/admin/actions";
import { TRANSITIONS, type Status } from "@/lib/status";

const OPTS = [
  ["DRAFT", "Nacrt"], ["PUBLISHED", "Objavljen"], ["COMPLETED", "Završen"], ["ARCHIVED", "Arhiviran"],
];

export function StatusSelect({ id, status }: { id: string; status: string }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <label className="status-sel">
      <span>Status</span>
      <select
        value={status}
        disabled={pending}
        aria-label="Status događaja"
        onChange={(e) => start(async () => { const r = await setEventStatus(id, e.target.value); toast(r.ok ? "ok" : "err", r.ok ? (r.message ?? "Sačuvano") : r.error); })}
      >
        {OPTS.filter(([v]) => v === status || TRANSITIONS[status as Status].includes(v as Status)).map(([v, l]) => <option key={v} value={v}>{status === "ARCHIVED" && v !== "ARCHIVED" ? "Vrati: " + l : l}</option>)}
      </select>
    </label>
  );
}
