import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getServerSession } from 'next-auth';
import { z } from 'zod';

import { NEXT_AUTH_OPTIONS } from '@documenso/lib/next-auth/auth-options';
import { verifyUserVoice } from '@documenso/lib/server-only/voice-verification/voice-profile-service';
import { prisma } from '@documenso/prisma';

// Logging function to add timestamps
function logWithTime(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [Voice Verification] ${message}`);
  if (data) {
    console.log(`[${timestamp}] [Voice Verification] Data:`, JSON.stringify(data, null, 2));
  }
}

// Define schema for verification request
export const ZVoiceVerifyRequestSchema = z.object({
  audioData: z.string(),
  userId: z.number().optional(),
  documentId: z.string().optional(),
});

type TVoiceVerifyRequest = z.infer<typeof ZVoiceVerifyRequestSchema>;

/**
 * POST /api/voice-verification
 * Endpoint for verifying a user's voice against their enrolled profile
 */
export async function POST(req: NextRequest) {
  console.time('[Voice Verification] Total processing time');
  logWithTime('Request received');

  try {
    // Authenticate the request
    console.time('[Voice Verification] Authentication');
    const session = await getServerSession(NEXT_AUTH_OPTIONS);

    if (!session?.user) {
      logWithTime('Unauthorized. Authentication required.');
      console.timeEnd('[Voice Verification] Authentication');
      console.timeEnd('[Voice Verification] Total processing time');
      return NextResponse.json(
        { error: 'Unauthorized. Authentication required.' },
        { status: 401 },
      );
    }
    console.timeEnd('[Voice Verification] Authentication');

    // Parse and validate request body
    console.time('[Voice Verification] Request parsing');
    let body;
    try {
      const requestText = await req.text();
      logWithTime(`Request body size: ${requestText.length} bytes`);
      body = JSON.parse(requestText);
      logWithTime('Request parsed successfully');
    } catch (error) {
      logWithTime('Error parsing request body', error);
      console.timeEnd('[Voice Verification] Request parsing');
      console.timeEnd('[Voice Verification] Total processing time');
      return NextResponse.json(
        { error: 'Invalid request format', details: String(error) },
        { status: 400 },
      );
    }

    const parsedBody = ZVoiceVerifyRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      logWithTime('Invalid request schema', parsedBody.error.format());
      console.timeEnd('[Voice Verification] Request parsing');
      console.timeEnd('[Voice Verification] Total processing time');
      return NextResponse.json(
        { error: 'Invalid request', details: parsedBody.error.format() },
        { status: 400 },
      );
    }

    const { audioData, userId, documentId } = parsedBody.data;
    logWithTime('Request validation successful', {
      hasAudioData: !!audioData,
      audioDataLength: audioData.length,
      userId,
      documentId,
    });
    console.timeEnd('[Voice Verification] Request parsing');

    // Verify the user is authorized to verify this user's voice
    console.time('[Voice Verification] User verification');
    const userIdToVerify = userId || session.user.id;
    logWithTime(`Verifying user ID: ${userIdToVerify}`);

    // Don't allow verifying other users unless the current user owns the document
    // This check is needed if verifying a recipient's voice for a document
    if (userId && userId !== session.user.id && documentId) {
      logWithTime(`Checking document ownership for document ${documentId}`);
      const document = await prisma.document.findUnique({
        where: {
          id: parseInt(documentId, 10),
          userId: session.user.id,
        },
      });

      if (!document) {
        logWithTime('Unauthorized to verify this user for this document');
        console.timeEnd('[Voice Verification] User verification');
        console.timeEnd('[Voice Verification] Total processing time');
        return NextResponse.json(
          { error: 'Unauthorized to verify this user for this document' },
          { status: 403 },
        );
      }
      logWithTime('Document ownership verified');
    }
    console.timeEnd('[Voice Verification] User verification');

    // Extract audio format and convert base64 audio data to buffer
    console.time('[Voice Verification] Audio processing');

    // Parse the MIME type from the data URI
    const mimeTypeMatch = audioData.match(/^data:([^;]+);/);
    const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'audio/unknown';
    logWithTime(`MIME type from data URI: ${mimeType}`);

    // Extract base64 data after the comma
    const base64Data = audioData.split(',')[1];
    logWithTime(`Base64 data length: ${base64Data ? base64Data.length : 0} bytes`);

    if (!base64Data || base64Data.length < 100) {
      logWithTime(`Base64 data is too short: ${base64Data ? base64Data.length : 0} bytes`);
      console.timeEnd('[Voice Verification] Audio processing');
      console.timeEnd('[Voice Verification] Total processing time');
      return NextResponse.json(
        {
          error: 'Audio data is too short or invalid',
          details:
            'Received audio is too small to be valid. Please record again with a longer sample.',
        },
        { status: 400 },
      );
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64');
    logWithTime(`Converted to buffer: ${buffer.length} bytes`);

    // Log the first 20 bytes of the buffer to check header
    const bufferPrefix = Array.from(buffer.subarray(0, 20))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    logWithTime(`Buffer header bytes: ${bufferPrefix}`);

    console.timeEnd('[Voice Verification] Audio processing');

    // Verify the user's voice
    console.time('[Voice Verification] Azure voice verification');
    logWithTime('Starting verification with Azure');

    try {
      const verificationResult = await verifyUserVoice(userIdToVerify, buffer);
      logWithTime('Verification completed', verificationResult);
      console.timeEnd('[Voice Verification] Azure voice verification');
      console.timeEnd('[Voice Verification] Total processing time');

      return NextResponse.json(verificationResult);
    } catch (error) {
      logWithTime('Error during voice verification', {
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : 'Unknown Error Type',
      });
      console.timeEnd('[Voice Verification] Azure voice verification');
      console.timeEnd('[Voice Verification] Total processing time');

      // Check for specific error types to provide better error messages
      let errorMessage = 'Unknown verification error';

      if (error instanceof Error) {
        errorMessage = error.message;

        // Handle specific error types
        if (error.message.includes('fetch failed') || error.message.includes('Failed to fetch')) {
          errorMessage =
            'Could not connect to voice verification service. Please check your network connection or try again later.';
        } else if (error.message.includes('Unauthorized') || error.message.includes('credential')) {
          errorMessage =
            'Authentication error with voice verification service. Please contact support.';
        } else if (error.message.includes('format') || error.message.includes('audio')) {
          errorMessage = 'Audio format not supported. Please try again with a different recording.';
        }
      }

      return NextResponse.json(
        {
          verified: false,
          score: 0,
          threshold: 0.7,
          error: errorMessage,
          details: {
            error: String(error),
            errorType: error instanceof Error ? error.name : 'Unknown',
          },
        },
        { status: 500 },
      );
    }
  } catch (error) {
    logWithTime('Unhandled exception', { error: String(error) });
    console.timeEnd('[Voice Verification] Total processing time');

    return NextResponse.json(
      {
        verified: false,
        score: 0,
        threshold: 0.7,
        error: 'Failed to verify voice',
        details: { error: String(error) },
      },
      { status: 500 },
    );
  }
}
