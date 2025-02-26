-- AlterEnum
ALTER TYPE "FieldType" ADD VALUE 'VOICE_SIGNATURE';

-- AlterTable
ALTER TABLE "Signature" ADD COLUMN     "voiceEnrollmentId" TEXT,
ADD COLUMN     "voiceSignatureCreatedAt" TIMESTAMP(3),
ADD COLUMN     "voiceSignatureMetadata" JSONB,
ADD COLUMN     "voiceSignatureTranscript" TEXT,
ADD COLUMN     "voiceSignatureUrl" TEXT;

-- CreateTable
CREATE TABLE "VoiceEnrollment" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "voicePatternData" BYTEA NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "enrollmentVideoPath" TEXT,

    CONSTRAINT "VoiceEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Signature_voiceEnrollmentId_idx" ON "Signature"("voiceEnrollmentId");

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_voiceEnrollmentId_fkey" FOREIGN KEY ("voiceEnrollmentId") REFERENCES "VoiceEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceEnrollment" ADD CONSTRAINT "VoiceEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
