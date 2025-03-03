import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getServerSession } from 'next-auth';
import { z } from 'zod';

import { NEXT_AUTH_OPTIONS } from '@documenso/lib/next-auth/auth-options';
import { verifyUserVoice } from '@documenso/lib/server-only/voice-verification/voice-profile-service';
import { prisma } from '@documenso/prisma';

// Define schema for verification request
export const ZVoiceVerifyRequestSchema = z.object({
  audioData: z.string().min(1, 'Audio data is required'),
  userId: z.number().optional(),
  documentId: z.number().optional(),
  fieldId: z.number().optional(),
});

type _TVoiceVerifyRequest = z.infer<typeof ZVoiceVerifyRequestSchema>;

/**
 * POST /api/voice-verification
 * Endpoint for verifying a voice sample against a user's enrolled profile
 */
export async function POST(req: NextRequest) {
  try {
    // Authenticate the request
    const session = await getServerSession(NEXT_AUTH_OPTIONS);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized. Authentication required.' },
        { status: 401 },
      );
    }

    // Parse and validate request body
    const body = await req.json();
    const parsedBody = ZVoiceVerifyRequestSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsedBody.error.format() },
        { status: 400 },
      );
    }

    const { audioData, userId, documentId, fieldId } = parsedBody.data;

    // Determine which user to verify (current user or specified user)
    const userIdToVerify = userId || session.user.id;

    // Don't allow verifying other users unless the current user owns the document
    // This check is needed if verifying a recipient's voice for a document
    if (userId && userId !== session.user.id && documentId) {
      const document = await prisma.document.findUnique({
        where: {
          id: documentId,
          userId: session.user.id,
        },
      });

      if (!document) {
        return NextResponse.json(
          { error: 'Unauthorized to verify this user for this document' },
          { status: 403 },
        );
      }
    }

    // Convert base64 audio data to buffer
    const audioBuffer = Buffer.from(audioData.replace(/^data:audio\/\w+;base64,/, ''), 'base64');

    // Verify the voice
    const verificationResult = await verifyUserVoice(userIdToVerify, audioBuffer);

    // If we have a field ID, we can optionally log the verification for the specific field
    if (documentId && fieldId) {
      // You could log this verification against a specific signature field if needed
      // await prisma.signatureVerification.create({ ... });
    }

    return NextResponse.json(verificationResult);
  } catch (error) {
    console.error('Error in voice verification:', error);

    return NextResponse.json(
      {
        error: 'Failed to verify voice',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
