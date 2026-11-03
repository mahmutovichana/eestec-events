import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@/generated/prisma";
import { db } from "./db";
import { auth0 } from "./auth0";
import { computeRole, type Claims } from "./roles";

export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "hr@eestec-sa.ba").trim().toLowerCase();

export type SessionUser = { id: string; email: string; name: string; picture: string | null; role: Role };

// Lokalni razvoj bez Google/Auth0 računa. Nikad u produkciji (NODE_ENV=production isključuje ovu granu).
const DEV_AUTH = process.env.NODE_ENV !== "production" && process.env.DEV_AUTH === "true";
export const devAuthEnabled = () => DEV_AUTH;

const DEV_PROFILES: Record<string, Claims & { name: string; picture: string | null }> = {
  admin: { sub: "google-oauth2|dev-admin", email: ADMIN_EMAIL, email_verified: true, name: "Dev Admin", picture: null },
  user: { sub: "google-oauth2|dev-user", email: "dev.user@example.com", email_verified: true, name: "Dev User", picture: null },
  user2: { sub: "google-oauth2|dev-user2", email: "dev.user2@example.com", email_verified: true, name: "Dev User Dva", picture: null },
  // Pokušaj eskalacije: isti email kao admin, ali neverifikovan i ne-Google identitet.
  fake: { sub: "auth0|dev-fake", email: ADMIN_EMAIL, email_verified: false, name: "Lažni Admin", picture: null },
};

async function readClaims(): Promise<(Claims & { name?: string | null; picture?: string | null }) | null> {
  if (DEV_AUTH) {
    const who = (await cookies()).get("dev_user")?.value;
    return who && DEV_PROFILES[who] ? DEV_PROFILES[who] : null;
  }
  const session = await auth0.getSession();
  const u = session?.user;
  if (!u?.sub || !u.email) return null;
  return { sub: u.sub, email: u.email, email_verified: u.email_verified === true, name: u.name ?? null, picture: u.picture ?? null };
}

/** Jedina funkcija koja kreira/ažurira lokalnog korisnika. Uloga se uvijek računa iz verifikovanih tvrdnji. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const c = await readClaims();
  if (!c?.sub || !c.email) return null;
  const email = c.email.trim().toLowerCase();
  const role = computeRole(c, ADMIN_EMAIL);
  const name = (c.name || email.split("@")[0]).slice(0, 120);
  const picture = c.picture ?? null;
  const verified = c.email_verified === true;

  try {
    const existing = await db.user.findUnique({ where: { auth0Sub: c.sub } });
    if (!existing) {
      const u = await db.user.create({ data: { auth0Sub: c.sub, email, emailVerified: verified, name, picture, role } });
      return { id: u.id, email: u.email, name: u.name, picture: u.picture, role: u.role };
    }
    const stale = Date.now() - existing.lastLoginAt.getTime() > 15 * 60_000;
    const changed =
      existing.email !== email || existing.emailVerified !== verified || existing.name !== name ||
      existing.picture !== picture || existing.role !== role;
    if (changed || stale) {
      const u = await db.user.update({
        where: { id: existing.id },
        data: { email, emailVerified: verified, name, picture, role, lastLoginAt: stale ? new Date() : undefined },
      });
      return { id: u.id, email: u.email, name: u.name, picture: u.picture, role: u.role };
    }
    return { id: existing.id, email: existing.email, name: existing.name, picture: existing.picture, role: existing.role };
  } catch {
    // npr. isti email već pripada drugom identitetu: tretiraj kao neprijavljen.
    return null;
  }
});

export const isAdminUser = (u: SessionUser | null): u is SessionUser => !!u && u.role === "ADMIN";

export function loginUrl(returnTo: string) {
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  return `/auth/login?returnTo=${encodeURIComponent(safe)}`;
}

/** Za stranice: Guest -> prijava. */
export async function requireUser(returnTo = "/profile"): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) redirect(loginUrl(returnTo));
  return u;
}

/** Za admin stranice: Guest -> prijava, User -> 403 stranica. */
export async function requireAdminPage(returnTo = "/admin"): Promise<SessionUser> {
  const u = await requireUser(returnTo);
  if (u.role !== "ADMIN") redirect("/forbidden");
  return u;
}

/** Za server akcije i admin API: baca grešku umjesto redirecta. Poziva se kao PRVA linija svake akcije. */
export async function assertAdmin(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) throw new Error("UNAUTHENTICATED");
  if (u.role !== "ADMIN") throw new Error("FORBIDDEN");
  return u;
}

/** Zaštita od cross-site POST-ova na API rutama: Origin mora odgovarati hostu. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
