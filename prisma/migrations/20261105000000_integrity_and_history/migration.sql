-- Integritet i čuvanje historije (bez gubitka podataka).
--  * LunchVote: složeni FK (pollId, optionId) -> LunchOption(pollId, id); opcija mora pripadati istoj anketi.
--  * FeedbackAnswer: čuva snimak pitanja, formId, složeni FK-ovi; brisanje pitanja više ne briše odgovore (NO ACTION).
--  * Soft-delete: LunchOption.archivedAt, FeedbackQuestion.archivedAt.
--  * AgendaItem.version (optimistično zaključavanje), RateLimit tabela.
-- Migracija se zaustavlja (ništa se ne mijenja, jer je u transakciji) ako postojeći podaci krše nova pravila.

-- Prethodne provjere: namjerno bacaju grešku umjesto da tiho brišu ili ispravljaju podatke.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "LunchVote" v JOIN "LunchOption" o ON o."id" = v."optionId" WHERE o."pollId" <> v."pollId") THEN
    RAISE EXCEPTION 'Migracija prekinuta: postoje glasovi s opcijom iz druge ankete. Ispravi ih ručno prije migracije.';
  END IF;
  IF EXISTS (SELECT 1 FROM "FeedbackAnswer" a JOIN "FeedbackResponse" r ON r."id" = a."responseId" JOIN "FeedbackQuestion" q ON q."id" = a."questionId" WHERE q."formId" <> r."formId") THEN
    RAISE EXCEPTION 'Migracija prekinuta: postoje odgovori na pitanje iz druge forme. Ispravi ih ručno prije migracije.';
  END IF;
  IF EXISTS (SELECT 1 FROM "FeedbackAnswer" GROUP BY "responseId", "questionId" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Migracija prekinuta: postoji više odgovora na isto pitanje u istom odgovoru. Ispravi ih ručno prije migracije.';
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "FeedbackAnswer" DROP CONSTRAINT "FeedbackAnswer_questionId_fkey";
ALTER TABLE "FeedbackAnswer" DROP CONSTRAINT "FeedbackAnswer_responseId_fkey";
ALTER TABLE "LunchVote" DROP CONSTRAINT "LunchVote_optionId_fkey";

-- AlterTable
ALTER TABLE "AgendaItem" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FeedbackQuestion" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "LunchOption" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- FeedbackAnswer: dodaj kolone nullable, popuni iz postojećih redova, pa postavi NOT NULL.
ALTER TABLE "FeedbackAnswer"
  ADD COLUMN "formId" TEXT,
  ADD COLUMN "questionLabel" TEXT,
  ADD COLUMN "questionOptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "questionType" "QuestionType";
UPDATE "FeedbackAnswer" a
   SET "formId" = r."formId"
  FROM "FeedbackResponse" r WHERE r."id" = a."responseId";
UPDATE "FeedbackAnswer" a
   SET "questionLabel" = q."label", "questionType" = q."type", "questionOptions" = q."options"
  FROM "FeedbackQuestion" q WHERE q."id" = a."questionId";
ALTER TABLE "FeedbackAnswer"
  ALTER COLUMN "formId" SET NOT NULL,
  ALTER COLUMN "questionLabel" SET NOT NULL,
  ALTER COLUMN "questionType" SET NOT NULL;

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "RateLimit_windowStart_idx" ON "RateLimit"("windowStart");
CREATE UNIQUE INDEX "FeedbackAnswer_responseId_questionId_key" ON "FeedbackAnswer"("responseId", "questionId");
CREATE UNIQUE INDEX "FeedbackQuestion_formId_id_key" ON "FeedbackQuestion"("formId", "id");
CREATE UNIQUE INDEX "FeedbackResponse_formId_id_key" ON "FeedbackResponse"("formId", "id");
CREATE UNIQUE INDEX "LunchOption_pollId_id_key" ON "LunchOption"("pollId", "id");

-- AddForeignKey
ALTER TABLE "LunchVote" ADD CONSTRAINT "LunchVote_pollId_optionId_fkey" FOREIGN KEY ("pollId", "optionId") REFERENCES "LunchOption"("pollId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "FeedbackAnswer" ADD CONSTRAINT "FeedbackAnswer_formId_responseId_fkey" FOREIGN KEY ("formId", "responseId") REFERENCES "FeedbackResponse"("formId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedbackAnswer" ADD CONSTRAINT "FeedbackAnswer_formId_questionId_fkey" FOREIGN KEY ("formId", "questionId") REFERENCES "FeedbackQuestion"("formId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
