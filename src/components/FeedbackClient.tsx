"use client";
import { useState } from "react";

type Q = { id: string; type: "RATING" | "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "SHORT_TEXT" | "LONG_TEXT"; label: string; required: boolean; options: string[] };

export function FeedbackClient({ formId, mode, questions }: { formId: string; mode: "ANONYMOUS" | "IDENTIFIED"; questions: Q[] }) {
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const has = (q: Q) =>
    q.type === "RATING" ? !!ratings[q.id] : q.type === "SHORT_TEXT" || q.type === "LONG_TEXT" ? !!texts[q.id]?.trim() : (choices[q.id]?.length ?? 0) > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const missing = questions.find((q) => q.required && !has(q));
    if (missing) return setErr(`Obavezno pitanje: ${missing.label}`);
    const answers = questions.map((q) => ({ questionId: q.id, rating: ratings[q.id], text: texts[q.id], choices: choices[q.id] }));
    setBusy(true);
    const r = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ formId, acknowledgedMode: mode, answers }),
    });
    setBusy(false);
    if (r.ok) return setDone(true);
    setErr((await r.json().catch(() => null))?.error ?? "Greška. Pokušaj ponovo.");
  }

  if (done) {
    return (
      <p className="ok" role="status">
        Hvala na feedbacku! {mode === "ANONYMOUS" ? "Odgovor je anoniman." : "Odgovor je povezan s tvojim računom."}
      </p>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      {questions.map((q) => (
        <fieldset key={q.id} className="q">
          <legend className="lab">{q.label}{q.required ? <span aria-label="obavezno"> *</span> : null}</legend>
          {q.type === "RATING" ? (
            <>
              <div className="stars" role="radiogroup" aria-label={q.label}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n}>
                    <input type="radio" name={"r-" + q.id} value={n} checked={ratings[q.id] === n} onChange={() => setRatings({ ...ratings, [q.id]: n })} />
                    <span>{n}</span>
                  </label>
                ))}
              </div>
              <div className="scale"><span>Loše</span><span>Odlično</span></div>
            </>
          ) : q.type === "SHORT_TEXT" ? (
            <input type="text" maxLength={200} value={texts[q.id] ?? ""} onChange={(e) => setTexts({ ...texts, [q.id]: e.target.value })} aria-label={q.label} />
          ) : q.type === "LONG_TEXT" ? (
            <textarea maxLength={3000} value={texts[q.id] ?? ""} onChange={(e) => setTexts({ ...texts, [q.id]: e.target.value })} aria-label={q.label} />
          ) : (
            <div>
              {q.options.map((o) => {
                const multi = q.type === "MULTIPLE_CHOICE";
                const on = choices[q.id]?.includes(o) ?? false;
                return (
                  <label key={o} className="opt compact">
                    <input
                      type={multi ? "checkbox" : "radio"}
                      name={"c-" + q.id}
                      checked={on}
                      onChange={() =>
                        setChoices({
                          ...choices,
                          [q.id]: multi ? (on ? (choices[q.id] ?? []).filter((x) => x !== o) : [...(choices[q.id] ?? []), o]) : [o],
                        })
                      }
                    />
                    <span><b>{o}</b></span>
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>
      ))}
      {err ? <p className="err" role="alert">{err}</p> : null}
      <button className="btn" disabled={busy}>{busy ? "Šaljem…" : "Pošalji feedback"}</button>
    </form>
  );
}
