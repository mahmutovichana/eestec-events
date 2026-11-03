import type { NextRequest } from "next/server";
import { auth0 } from "./lib/auth0";

// Auth0 rute (/auth/login, /auth/callback, /auth/logout) i sesija.
// Stvarna autorizacija je u requireAdmin() na serveru, ne ovdje.
export async function middleware(request: NextRequest) {
  return auth0.middleware(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:png|jpg|svg|ico)$).*)"],
};
