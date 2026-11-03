import { Auth0Client } from "@auth0/nextjs-auth0/server";

// Čita AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET i APP_BASE_URL iz okruženja.
export const auth0 = new Auth0Client({
  authorizationParameters: { connection: "google-oauth2", scope: "openid profile email" },
});
