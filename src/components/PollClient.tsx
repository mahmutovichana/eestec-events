"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Opt = { id: string; name: string; description: string; allergens: string };

export function PollClient({
  pollId, options, current, canChange,
}: { pollId: string; options: Opt[]; current: string | null; canChange: boolean }) {
  const router = useRouter();
  const [sel, setSel] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const locked = !!current && !canChange;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sel) return setErr("Odaberi jednu opciju.");
    setBusy(true);
    setErr("");
    setSaved(false);
    const r = await fetch("/api/vote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pollId, optionId: sel }) });
    setBusy(false);
    if (r.ok) {
      setSaved(true);
      return router.refresh();
    }
    setErr((await r.json().catch(() => null))?.error ?? "Greška. Pokušaj ponovo.");
  }

  return (
    <form onSubmit={submit}>
      <div role="radiogroup" aria-label="Opcije ručka">
        {options.map((o) => (
          <label key={o.id} className="opt">
            <input type="radio" name={"opt-" + pollId} value={o.id} checked={sel === o.id} onChange={() => setSel(o.id)} disabled={locked} />
            <span>
              <b>{o.name}{current === o.id ? " · tvoj izbor" : ""}</b>
              {o.description ? <small>{o.description}</small> : null}
              {o.allergens ? <span className="allergen">Alergeni: {o.allergens}</span> : null}
            </span>
          </label>
        ))}
      </div>
      {err ? <p className="err" role="alert">{err}</p> : null}
      {saved ? <p className="ok" role="status">{current ? "Glas je promijenjen." : "Glas je zabilježen."}</p> : null}
      {locked ? (
        <p className="hint">Glas je zabilježen. Promjena nije dozvoljena u ovoj anketi.</p>
      ) : (
        <button className="btn" disabled={busy || (!!current && sel === current)}>
          {busy ? "Šaljem…" : current ? "Promijeni glas" : "Glasaj"}
        </button>
      )}
    </form>
  );
}
