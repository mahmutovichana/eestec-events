// Sav pristup serveru ide kroz ovaj fajl. Klijent šalje samo Google ID token; server sam zaključuje ko je i da li je admin.
export type Config = { apiUrl: string; clientId: string };
declare global { interface Window { EESTEC_CONFIG?: Config; google?: any; } }

export const config: Config = window.EESTEC_CONFIG ?? { apiUrl: "", clientId: "" };

export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const TOKEN_KEY = "eestec.idToken";
let token: string | null = null;
try { token = sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem("eestecTestToken"); } catch { /* privatni način */ }

export function getToken() { return token; }
export function setToken(t: string | null) {
  token = t;
  try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}
/** Čita samo `exp` radi UX-a (da se ne šalje istekao token). Ne vjeruje se ničemu iz tokena: server ga provjerava. */
export function tokenExpired(t: string | null) {
  if (!t) return true;
  try { const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return Number(p.exp) * 1000 < Date.now() + 30_000; } catch { return true; }
}

let onAuthLost: (() => void) | null = null;
export function setAuthLostHandler(f: () => void) { onAuthLost = f; }

export async function call<T = any>(action: string, payload: Record<string, unknown> = {}, opts: { anonymous?: boolean } = {}): Promise<T> {
  if (!config.apiUrl) throw new ApiError("CONFIG", "Aplikacija još nije povezana sa serverom (config.js).");
  const idToken = opts.anonymous ? undefined : token && !tokenExpired(token) ? token : undefined;
  let res: Response;
  try {
    // text/plain = "simple request": bez CORS preflighta, koji Apps Script ne podržava.
    res = await fetch(config.apiUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action, ...payload, idToken }), redirect: "follow" });
  } catch {
    throw new ApiError("NETWORK", "Nema veze sa serverom. Provjerite internet i pokušajte ponovo.");
  }
  let body: any;
  try { body = await res.json(); } catch { throw new ApiError("BAD_RESPONSE", "Server je vratio neočekivan odgovor."); }
  if (!body.ok) {
    if (body.error.code === "UNAUTHENTICATED" && token) { setToken(null); onAuthLost?.(); }
    throw new ApiError(body.error.code, body.error.message);
  }
  return body.data as T;
}
