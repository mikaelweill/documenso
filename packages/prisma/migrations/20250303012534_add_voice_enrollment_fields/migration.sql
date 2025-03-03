/*
  Warnings:

  - Added the required column `updatedAt` to the `VoiceEnrollment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "voiceEnrollmentComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "voiceEnrollmentDate" TIMESTAMP(3),
ADD COLUMN     "voiceProfileId" TEXT;

-- AlterTable
ALTER TABLE "VoiceEnrollment" ADD COLUMN     "audioUrl" TEXT,
ADD COLUMN     "isProcessed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "processingError" TEXT,
ADD COLUMN     "processingStatus" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "videoDuration" INTEGER,
ADD COLUMN     "videoUrl" TEXT,
ADD COLUMN     "voiceProfileId" TEXT,
ALTER COLUMN "voicePatternData" DROP NOT NULL;
