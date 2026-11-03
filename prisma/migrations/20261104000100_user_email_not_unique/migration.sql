-- Isti email može doći od različitih identiteta (npr. neverifikovan račun s tuđim emailom).
-- Unique ostaje samo na auth0Sub, da takav račun ne može blokirati prijavu pravog korisnika.
DROP INDEX "User_email_key";
CREATE INDEX "User_email_idx" ON "User"("email");
