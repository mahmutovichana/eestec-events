import { NextResponse, type NextRequest } from "next/server";
import { auth0 } from "./lib/auth0";

// Auth0 rute (/auth/login, /auth/callback, /auth/logout) i sesija.
// Stvarna autorizacija je u requireAdminPage()/assertAdmin() na serveru, ne ovdje.
export async function middleware(request: NextRequest) {
  const res = await auth0.middleware(request);

  // Neuspjela prijava (odbijena saglasnost, istekao ili neispravan state): umjesto golog 500 s tekstom
  // vodi korisnika na početnu s porukom. Kolačići iz odgovora (čišćenje transakcije) se prenose.
  if (request.nextUrl.pathname === "/auth/callback" && res.status >= 400) {
    const back = NextResponse.redirect(new URL("/?prijava=neuspjela", request.url));
    for (const c of res.headers.getSetCookie()) back.headers.append("set-cookie", c);
    return back;
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:png|jpg|svg|ico)$).*)"],
};
