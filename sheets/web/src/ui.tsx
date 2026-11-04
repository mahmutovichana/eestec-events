import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ApiError } from "./api";

// ── toast ──
type ToastFn = (msg: string, kind?: "ok" | "err") => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; kind: string; n: number } | null>(null);
  const show = useCallback<ToastFn>((msg, kind = "ok") => setT({ msg, kind, n: Date.now() }), []);
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(() => setT(null), t.kind === "err" ? 7000 : 3500);
    return () => clearTimeout(id);
  }, [t]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{t && <div className={"toast " + t.kind}>{t.msg}</div>}</div>
    </ToastCtx.Provider>
  );
}
export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Došlo je do greške. Pokušajte ponovo.");

// ── async akcije s greškom u toastu ──
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
    setBusy(true);
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
    catch (e) { toast(errMsg(e), "err"); return undefined; }
    finally { setBusy(false); }
  }, [toast]);
  return { busy, run };
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    try { const d = await fn(); if (n === seq.current) { setData(d); setError(null); } }
    catch (e) { if (n === seq.current) setError(e instanceof ApiError ? e : new ApiError("X", "Greška")); }
    finally { if (n === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { setLoading(true); reload(); }, [reload]);
  return { data, error, loading, reload };
}

// ── potvrda (tipkanje fraze za opasne radnje) ──
export function Confirm({ title, text, phrase, confirmLabel, onConfirm, onCancel }: { title: string; text: string; phrase?: string; confirmLabel: string; onConfirm: (typed: string) => void; onCancel: () => void }) {
  const [typed, setTyped] = useState("");
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,button")?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); prev?.focus(); };
  }, [onCancel]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={id + "t"} ref={ref}>
        <h2 id={id + "t"}>{title}</h2>
        <p>{text}</p>
        {phrase && (
          <label className="field">Za potvrdu upišite <b>{phrase}</b>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
        )}
        <div className="actions">
          <button className="btn ghost" onClick={onCancel}>Odustani</button>
          <button className="btn danger" disabled={!!phrase && typed !== phrase} onClick={() => onConfirm(typed)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function Spinner({ label = "Učitavanje…" }: { label?: string }) { return <div className="spinner" role="status"><span className="dot" />{label}</div>; }
export function ErrorBox({ error, retry }: { error: ApiError; retry?: () => void }) {
  return (
    <div className="notice err" role="alert">
      <b>{error.code === "NOT_FOUND" ? "Nije pronađeno" : "Greška"}</b>
      <p>{error.message}</p>
      {retry && error.code !== "NOT_FOUND" && <button className="btn ghost" onClick={retry}>Pokušaj ponovo</button>}
    </div>
  );
}

export const STATUS_LABEL: Record<string, string> = { DRAFT: "Nacrt", PUBLISHED: "Objavljen", COMPLETED: "Završen", ARCHIVED: "Arhiviran" };
export const TRANSITIONS: Record<string, string[]> = { DRAFT: ["PUBLISHED", "ARCHIVED"], PUBLISHED: ["DRAFT", "COMPLETED", "ARCHIVED"], COMPLETED: ["PUBLISHED", "ARCHIVED"], ARCHIVED: ["COMPLETED", "DRAFT"] };

const MONTHS = ["januar", "februar", "mart", "april", "maj", "juni", "juli", "august", "septembar", "oktobar", "novembar", "decembar"];
export function fmtDate(d: string) {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return `${day}. ${MONTHS[m - 1]} ${y}.`;
}
export function fmtRange(a: string, b: string) { return !a ? "" : !b || a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`; }
export function duration(a: string, b: string) {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const d = m(b) - m(a);
  return d >= 60 ? `${Math.floor(d / 60)} h${d % 60 ? ` ${d % 60} min` : ""}` : `${d} min`;
}
export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
