"use client";
import { useRef, useState, useTransition } from "react";
import { useToast } from "./Toast";

export type Result = { ok: true; message?: string } | { ok: false; error: string };

/** Forma koja poziva server akciju i prikazuje toast. Redirecti iz akcije rade normalno. */
export function AForm({
  action,
  children,
  className,
  resetOnSuccess,
  style,
}: {
  action: (fd: FormData) => Promise<Result>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  style?: React.CSSProperties;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  const [err, setErr] = useState("");

  return (
    <form
      ref={ref}
      className={className}
      style={style}
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as (HTMLButtonElement & { formAction?: string }) | null;
        const fd = new FormData(e.currentTarget, submitter);
        start(async () => {
          // Dugme s drugom akcijom (formAction) je rukovano preko onAction prop-a dugmeta.
          const r = await action(fd);
          if (r.ok) {
            setErr("");
            if (r.message) toast("ok", r.message);
            if (resetOnSuccess) ref.current?.reset();
          } else {
            setErr(r.error);
            toast("err", r.error);
          }
        });
      }}
    >
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {children}
        {err ? (
          <p className="err" role="alert">
            {err}
          </p>
        ) : null}
      </fieldset>
    </form>
  );
}
