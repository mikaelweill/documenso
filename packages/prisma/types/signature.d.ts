/* eslint-disable @typescript-eslint/no-empty-interface */
import type { Signature as PrismaSignature } from '@prisma/client';

declare module '@documenso/prisma/client' {
  // Add the missing fields to the Signature type
  interface Signature extends PrismaSignature {
    voiceSignatureUrl?: string | null;
    voiceSignatureTranscript?: string | null;
    voiceSignatureMetadata?: Record<string, unknown> | null;
    voiceSignatureCreatedAt?: Date | null;
    voiceEnrollmentId?: string | null;
  }
}
