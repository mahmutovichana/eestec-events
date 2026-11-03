"use client";
import { createContext, useCallback, useContext, useState } from "react";

type T = { id: number; kind: "ok" | "err"; text: string };
const Ctx = createContext<(kind: T["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((kind: T["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === "err" ? 6000 : 3000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={"toast " + i.kind}>
            {i.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
