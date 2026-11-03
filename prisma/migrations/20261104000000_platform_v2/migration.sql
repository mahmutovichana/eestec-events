-- Platform v2: korisnici, uloge, statusi događaja, glasanje preko računa, konfigurabilan feedback.
-- Stari anonimni glasovi ostaju (userId = NULL). HIDDEN -> DRAFT, TEXT -> LONG_TEXT, showResults -> showResultsWhileOpen.
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "FeedbackMode" AS ENUM ('ANONYMOUS', 'IDENTIFIED');

-- AlterEnum
BEGIN;
CREATE TYPE "ProjectStatus_new" AS ENUM ('DRAFT', 'PUBLISHED', 'COMPLETED', 'ARCHIVED');
ALTER TABLE "public"."Project" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Project" ALTER COLUMN "status" TYPE "ProjectStatus_new" USING ((CASE WHEN "status"::text = 'HIDDEN' THEN 'DRAFT' ELSE "status"::text END)::"ProjectStatus_new");
ALTER TYPE "ProjectStatus" RENAME TO "ProjectStatus_old";
ALTER TYPE "ProjectStatus_new" RENAME TO "ProjectStatus";
DROP TYPE "public"."ProjectStatus_old";
ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "QuestionType_new" AS ENUM ('RATING', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SHORT_TEXT', 'LONG_TEXT');
ALTER TABLE "FeedbackQuestion" ALTER COLUMN "type" TYPE "QuestionType_new" USING ((CASE WHEN "type"::text = 'TEXT' THEN 'LONG_TEXT' ELSE "type"::text END)::"QuestionType_new");
ALTER TYPE "QuestionType" RENAME TO "QuestionType_old";
ALTER TYPE "QuestionType_new" RENAME TO "QuestionType";
DROP TYPE "public"."QuestionType_old";
COMMIT;

-- DropIndex
DROP INDEX "LunchVote_pollId_netHash_idx";

-- AlterTable
ALTER TABLE "AgendaItem" ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "FeedbackAnswer" ADD COLUMN     "choices" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "FeedbackForm" ADD COLUMN     "mode" "FeedbackMode" NOT NULL DEFAULT 'ANONYMOUS',
ADD COLUMN     "oneResponsePerUser" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "FeedbackQuestion" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "options" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "FeedbackResponse" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "LunchPoll" RENAME COLUMN "showResults" TO "showResultsWhileOpen";
ALTER TABLE "LunchPoll" ALTER COLUMN "showResultsWhileOpen" SET DEFAULT false,
ADD COLUMN     "allowChange" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "LunchVote" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "userId" TEXT,
ALTER COLUMN "voterHash" DROP NOT NULL,
ALTER COLUMN "netHash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "endsAt" TIMESTAMP(3),
ADD COLUMN     "location" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "startsAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Project" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "auth0Sub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "picture" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_auth0Sub_key" ON "User"("auth0Sub");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "AgendaItem_agendaId_position_idx" ON "AgendaItem"("agendaId", "position");

-- CreateIndex
CREATE INDEX "FeedbackAnswer_questionId_idx" ON "FeedbackAnswer"("questionId");

-- CreateIndex
CREATE INDEX "FeedbackForm_projectId_idx" ON "FeedbackForm"("projectId");

-- CreateIndex
CREATE INDEX "FeedbackQuestion_formId_position_idx" ON "FeedbackQuestion"("formId", "position");

-- CreateIndex
CREATE INDEX "FeedbackResponse_formId_idx" ON "FeedbackResponse"("formId");

-- CreateIndex
CREATE INDEX "FeedbackResponse_userId_idx" ON "FeedbackResponse"("userId");

-- CreateIndex
CREATE INDEX "LunchPoll_projectId_idx" ON "LunchPoll"("projectId");

-- CreateIndex
CREATE INDEX "LunchVote_pollId_optionId_idx" ON "LunchVote"("pollId", "optionId");

-- CreateIndex
CREATE UNIQUE INDEX "LunchVote_pollId_userId_key" ON "LunchVote"("pollId", "userId");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- AddForeignKey
ALTER TABLE "LunchVote" ADD CONSTRAINT "LunchVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackResponse" ADD CONSTRAINT "FeedbackResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data: postojeći feedback je prikupljen anonimno. Smanji preciznost vremena na dan, kao za nove anonimne odgovore.
UPDATE "FeedbackResponse" SET "createdAt" = date_trunc('day', "createdAt") WHERE "userId" IS NULL;
