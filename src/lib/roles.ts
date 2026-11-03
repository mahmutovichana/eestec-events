// Čista funkcija bez ovisnosti od okruženja, da se može testirati.
export const GOOGLE_SUB_PREFIX = "google-oauth2|";

export type Claims = { sub?: string | null; email?: string | null; email_verified?: boolean | null };

/**
 * ADMIN samo ako je verifikovan Google identitet čiji je email tačno adminEmail.
 * Ulaz dolazi isključivo iz potpisane Auth0 sesije na serveru, nikad od klijenta.
 */
export function computeRole(claims: Claims, adminEmail: string): "ADMIN" | "USER" {
  const email = claims.email?.trim().toLowerCase();
  if (claims.email_verified === true && !!email && email === adminEmail.trim().toLowerCase() && !!claims.sub?.startsWith(GOOGLE_SUB_PREFIX)) {
    return "ADMIN";
  }
  return "USER";
}
