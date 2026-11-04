import "server-only";
import { createHmac } from "node:crypto";
import { db } from "./db";

function secret(): string {
  const s = process.env.AUTH0_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH0_SECRET nije postavljen");
  return "dev-only-secret";
}

/** Sirov identitet (IP, userId) se nikad ne upisuje u bazu, samo njegov HMAC. */
export const keyOf = (...parts: string[]) => createHmac("sha256", secret()).update(parts.join("|")).digest("hex").slice(0, 40);

/**
 * Distribuirano ograničenje brzine: stanje je u PostgreSQL-u, pa vrijedi za sve serverless instance.
 * Jedan atomarni upsert po pozivu. Vraća true ako je zahtjev dozvoljen.
 * `scope` je čitljiv prefiks (npr. "vote"), `id` se hashira.
 */
// Samo za testove (nikad u produkciji): RATE_LIMIT_SCALE množi limite da test paralelnih zahtjeva ne udari u njih.
const SCALE = process.env.NODE_ENV !== "production" ? Number(process.env.RATE_LIMIT_SCALE ?? 1) || 1 : 1;

export async function rateLimit(scope: string, id: string, max: number, windowMs: number): Promise<boolean> {
  max = max * SCALE;
  const key = `${scope}:${keyOf(scope, id)}`;
  const secs = windowMs / 1000;
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "windowStart")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${secs}) THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${secs}) THEN now() ELSE "RateLimit"."windowStart" END
    RETURNING "count"`;
  // Povremeno čišćenje isteklih redova (dnevni prozor je dovoljno velik za sve naše limite).
  if (Math.random() < 0.01) {
    void db.$executeRaw`DELETE FROM "RateLimit" WHERE "windowStart" < now() - interval '1 day'`.catch(() => {});
  }
  return Number(rows[0]?.count ?? 1) <= max;
}
