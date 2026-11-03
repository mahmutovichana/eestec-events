"use client";
import { useState } from "react";

export function CopyLink({ path, label = "Kopiraj link", className = "btn ghost sm" }: { path: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");
  async function copy() {
    const url = new URL(path, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setState("ok");
    } catch {
      // Rezerva kad clipboard API nije dostupan.
      window.prompt("Kopiraj link:", url);
      setState("err");
    }
    setTimeout(() => setState("idle"), 2000);
  }
  return (
    <button type="button" className={className} onClick={copy} aria-live="polite">
      {state === "ok" ? "Link kopiran" : label}
    </button>
  );
}
