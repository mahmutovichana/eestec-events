import { Auth0Client } from "@auth0/nextjs-auth0/server";

// Čita AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET i APP_BASE_URL iz okruženja.
// Sesija: kliznuća (rolling), ali s tvrdom gornjom granicom od 7 dana i istekom nakon 24 h neaktivnosti.
// Kolačić je httpOnly, SameSite=Lax, a u produkciji uvijek Secure. Nema trajne sesije bez ograničenja.
export const auth0 = new Auth0Client({
  authorizationParameters: { connection: "google-oauth2", scope: "openid profile email" },
  session: {
    rolling: true,
    absoluteDuration: 60 * 60 * 24 * 7,
    inactivityDuration: 60 * 60 * 24,
    cookie: { sameSite: "lax", secure: process.env.NODE_ENV === "production" },
  },
});
