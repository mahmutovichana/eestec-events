"use client";
import { useRef, useState, useTransition } from "react";
import { useToast } from "./Toast";
import type { Result } from "./AForm";

/**
 * Dugme s dijalogom potvrde. Poziva akciju s FormData koji sadrži zadana polja.
 * Koristi <dialog> (fokus ostaje unutar dijaloga, Esc zatvara).
 */
export function ConfirmButton({
  action,
  fields,
  title,
  message,
  confirmLabel = "Obriši",
  children,
  className = "btn dark sm",
}: {
  action: (fd: FormData) => Promise<Result>;
  fields: Record<string, string>;
  title: string;
  message: string;
  confirmLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const toast = useToast();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function confirm() {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.set(k, v));
    start(async () => {
      const r = await action(fd);
      if (r.ok) {
        ref.current?.close();
        if (r.message) toast("ok", r.message);
      } else {
        setErr(r.error);
      }
    });
  }

  return (
    <>
      <button type="button" className={className} onClick={() => { setErr(""); ref.current?.showModal(); }}>
        {children}
      </button>
      <dialog ref={ref} className="dlg" aria-labelledby="dlg-t">
        <h2 id="dlg-t">{title}</h2>
        <p>{message}</p>
        {err ? <p className="err" role="alert">{err}</p> : null}
        <div className="actions" style={{ justifyContent: "flex-end", marginTop: 18 }}>
          <button type="button" className="btn ghost sm" onClick={() => ref.current?.close()} autoFocus>
            Odustani
          </button>
          <button type="button" className="btn sm" onClick={confirm} disabled={pending}>
            {pending ? "Radim…" : confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
