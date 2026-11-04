-- Profil korisnika traži glasove po userId. Unique (pollId, userId) ne pomaže jer pollId dolazi prvi.
CREATE INDEX "LunchVote_userId_idx" ON "LunchVote"("userId");
