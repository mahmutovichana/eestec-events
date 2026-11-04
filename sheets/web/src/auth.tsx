import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { call, config, getToken, setAuthLostHandler, setToken, tokenExpired } from "./api";
import type { Me } from "./types";

type Auth = { me: Me; ready: boolean; signOut: () => void; refresh: () => Promise<void>; gisReady: boolean };
const LOGGED_OUT: Me = { loggedIn: false, isAdmin: false };
const Ctx = createContext<Auth>({ me: LOGGED_OUT, ready: false, signOut() {}, refresh: async () => {}, gisReady: false });
export const useAuth = () => useContext(Ctx);

let gisPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("GIS"));
    document.head.appendChild(s);
  });
  return gisPromise;
}

export function AuthProvider({ children, onExpired }: { children: ReactNode; onExpired: () => void }) {
  const [me, setMe] = useState<Me>(LOGGED_OUT);
  const [ready, setReady] = useState(false);
  const [gisReady, setGisReady] = useState(false);

  const refresh = useCallback(async () => {
    const t = getToken();
    if (!t || tokenExpired(t)) { if (t) setToken(null); setMe(LOGGED_OUT); setReady(true); return; }
    try { setMe((await call<{ me: Me }>("whoami")).me); } catch { setMe(LOGGED_OUT); }
    setReady(true);
  }, []);

  useEffect(() => { setAuthLostHandler(() => { setMe(LOGGED_OUT); onExpired(); }); }, [onExpired]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!config.clientId) return;
    let dead = false;
    loadGis().then(() => {
      if (dead) return;
      window.google.accounts.id.initialize({
        client_id: config.clientId, auto_select: false, cancel_on_tap_outside: true, use_fedcm_for_prompt: true,
        callback: (r: { credential: string }) => { setToken(r.credential); refresh(); },
      });
      setGisReady(true);
    }).catch(() => {});
    return () => { dead = true; };
  }, [refresh]);

  const signOut = useCallback(() => {
    setToken(null);
    window.google?.accounts?.id?.disableAutoSelect?.();
    setMe(LOGGED_OUT);
  }, []);
  return <Ctx.Provider value={{ me, ready, signOut, refresh, gisReady }}>{children}</Ctx.Provider>;
}

/** Službeno Google dugme (GIS). Ako clientId nije podešen, prikazuje jasnu poruku umjesto "mrtvog" dugmeta. */
export function GoogleSignIn({ text = "signin_with" }: { text?: "signin_with" | "continue_with" }) {
  const { gisReady } = useAuth();
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (gisReady && el.current) window.google.accounts.id.renderButton(el.current, { theme: "outline", size: "large", text, shape: "pill", locale: "bs", width: 260 });
  }, [gisReady, text]);
  if (!config.clientId) return <p className="muted">Prijava nije podešena (nedostaje clientId u config.js).</p>;
  return <div className="gbtn" ref={el} aria-label="Prijava Google računom">{!gisReady && <span className="muted">Učitavanje prijave…</span>}</div>;
}
