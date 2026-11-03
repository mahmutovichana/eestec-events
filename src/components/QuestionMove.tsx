"use client";
import { useTransition } from "react";
import { moveQuestion } from "@/app/admin/actions";
import { useToast } from "./Toast";

export function QuestionMove({ id, first, last }: { id: string; first: boolean; last: boolean }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const go = (dir: "up" | "down") => start(async () => { const r = await moveQuestion(id, dir); if (!r.ok) toast("err", r.error); });
  return (
    <>
      <button type="button" className="btn ghost sm" disabled={first || pending} onClick={() => go("up")} aria-label="Pomjeri pitanje gore">↑</button>
      <button type="button" className="btn ghost sm" disabled={last || pending} onClick={() => go("down")} aria-label="Pomjeri pitanje dolje">↓</button>
    </>
  );
}
