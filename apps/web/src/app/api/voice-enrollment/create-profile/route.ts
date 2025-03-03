import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getServerSession } from 'next-auth';

import { NEXT_AUTH_OPTIONS } from '@documenso/lib/next-auth/auth-options';
import {
  downloadFileFromS3,
  getKeyFromUrl,
  getPresignedUrl,
} from '@documenso/lib/server-only/storage/s3-storage';
import { createVoiceProfile } from '@documenso/lib/server-only/voice-verification/azure-speaker-recognition';
import { prisma } from '@documenso/prisma';

// Define error types for better type checking
interface FetchError extends Error {
  status?: number;
  statusText?: string;
}

export async function POST(req: NextRequest) {
  try {
    console.log('POST /api/voice-enrollment/create-profile: Received request');

    // Get authentication session
    const session = await getServerSession(NEXT_AUTH_OPTIONS);

    if (!session?.user?.id) {
      console.log('POST /api/voice-enrollment/create-profile: Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    console.log(`POST /api/voice-enrollment/create-profile: Processing for user ${userId}`);

    // Get the enrollment ID from the request
    const { enrollmentId } = await req.json();

    if (!enrollmentId) {
      console.log('POST /api/voice-enrollment/create-profile: Missing enrollmentId');
      return NextResponse.json({ error: 'Missing enrollmentId' }, { status: 400 });
    }

    console.log(
      `POST /api/voice-enrollment/create-profile: Processing enrollment ID ${enrollmentId}`,
    );

    // Find the enrollment record
    const enrollment = await prisma.voiceEnrollment.findFirst({
      where: {
        id: enrollmentId,
        userId,
      },
    });

    if (!enrollment) {
      console.log(
        `POST /api/voice-enrollment/create-profile: Enrollment ${enrollmentId} not found for user ${userId}`,
      );
      return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    }

    // Check if we have the audio URL
    if (!enrollment.audioUrl) {
      console.log(
        `POST /api/voice-enrollment/create-profile: No audio URL found for enrollment ${enrollmentId}`,
      );
      return NextResponse.json(
        { error: 'No audio available for this enrollment' },
        { status: 400 },
      );
    }

    console.log(
      `POST /api/voice-enrollment/create-profile: Original audio URL: ${enrollment.audioUrl}`,
    );

    // Update the enrollment status
    await prisma.voiceEnrollment.update({
      where: {
        id: enrollmentId,
      },
      data: {
        processingStatus: 'PROFILE_CREATING',
      },
    });

    // Extract the S3 key from the URL - we'll need this for both approaches
    const s3Key = getKeyFromUrl(enrollment.audioUrl);

    // First attempt: Try to get the audio using presigned URL
    let buffer: Buffer | null = null;
    let fetchError: FetchError | null = null;

    try {
      // Generate a fresh presigned URL to avoid permission issues
      let audioUrl = enrollment.audioUrl;

      if (s3Key) {
        console.log(
          `POST /api/voice-enrollment/create-profile: Regenerating presigned URL for key: ${s3Key}`,
        );
        // Generate a new presigned URL with 15 minutes expiration
        audioUrl = await getPresignedUrl(s3Key, 900);
        console.log(`POST /api/voice-enrollment/create-profile: Generated fresh presigned URL`);
      } else {
        console.log(
          `POST /api/voice-enrollment/create-profile: Could not extract S3 key from URL, using original URL`,
        );
      }

      // Fetch the audio data with the fresh URL
      console.log(`POST /api/voice-enrollment/create-profile: Fetching audio using presigned URL`);
      const audioResponse = await fetch(audioUrl, {
        headers: {
          // Explicitly set Accept header to support different audio formats
          Accept: 'audio/wav, audio/mpeg, audio/*',
        },
      });

      if (!audioResponse.ok) {
        console.error(
          `POST /api/voice-enrollment/create-profile: Presigned URL fetch failed: ${audioResponse.status} ${audioResponse.statusText}`,
        );

        // Log more details about the failure
        const responseBody = await audioResponse.text().catch(() => 'Could not read response body');
        console.error(`POST /api/voice-enrollment/create-profile: Response body: ${responseBody}`);

        // Store the error for later (we'll try direct S3 download next)
        const error = new Error(`HTTP ${audioResponse.status}: ${audioResponse.statusText}`);
        // Add properties to error using proper typing
        const typedError: FetchError = Object.assign(error, {
          status: audioResponse.status,
          statusText: audioResponse.statusText,
        });
        fetchError = typedError;
      } else {
        // Get the audio buffer
        const audioBuffer = await audioResponse.arrayBuffer();
        buffer = Buffer.from(audioBuffer);

        console.log(
          `POST /api/voice-enrollment/create-profile: Retrieved audio buffer with size ${buffer.length} bytes`,
        );
        console.log(
          `POST /api/voice-enrollment/create-profile: Audio content type: ${audioResponse.headers.get('content-type')}`,
        );
      }
    } catch (error) {
      console.error(
        `POST /api/voice-enrollment/create-profile: Error fetching with presigned URL:`,
        error,
      );

      // Create a properly typed error object
      if (error instanceof Error) {
        const typedError: FetchError = Object.assign(
          new Error(`Presigned URL error: ${error.message}`),
          {
            cause: error,
          },
        );
        fetchError = typedError;
      } else {
        // Create a properly typed error for unknown error type
        const unknownError: FetchError = Object.assign(
          new Error('Unknown error with presigned URL'),
          {
            cause: String(error),
          },
        );
        fetchError = unknownError;
      }
    }

    // Second attempt: If presigned URL failed and we have a valid S3 key, try direct S3 download
    if (!buffer && s3Key) {
      try {
        console.log(
          `POST /api/voice-enrollment/create-profile: Attempting direct S3 download as fallback`,
        );
        buffer = await downloadFileFromS3(s3Key);
        console.log(
          `POST /api/voice-enrollment/create-profile: Direct S3 download successful, got ${buffer.length} bytes`,
        );
      } catch (directError) {
        console.error(
          `POST /api/voice-enrollment/create-profile: Direct S3 download also failed:`,
          directError,
        );

        // Both methods failed - update status and return error
        await prisma.voiceEnrollment.update({
          where: {
            id: enrollmentId,
          },
          data: {
            processingStatus: 'PROFILE_ERROR',
          },
        });

        const presignedErrorMsg = fetchError?.message || 'Unknown error';
        const directErrorMsg = directError instanceof Error ? directError.message : 'Unknown error';

        return NextResponse.json(
          {
            error: 'Failed to fetch audio from S3',
            message: `Tried both presigned URL and direct download methods. Presigned URL error: ${presignedErrorMsg}. Direct download error: ${directErrorMsg}`,
          },
          { status: 500 },
        );
      }
    }

    // If we still don't have a buffer, both approaches failed
    if (!buffer) {
      console.error(
        'POST /api/voice-enrollment/create-profile: Failed to get audio using any method',
      );

      await prisma.voiceEnrollment.update({
        where: {
          id: enrollmentId,
        },
        data: {
          processingStatus: 'PROFILE_ERROR',
        },
      });

      return NextResponse.json(
        {
          error: 'Failed to fetch audio',
          message: fetchError?.message || 'Unknown error getting audio',
        },
        { status: 500 },
      );
    }

    // Validate buffer size
    if (buffer.length < 1000) {
      console.error('POST /api/voice-enrollment/create-profile: Audio buffer is too small');

      await prisma.voiceEnrollment.update({
        where: {
          id: enrollmentId,
        },
        data: {
          processingStatus: 'PROFILE_ERROR',
        },
      });

      return NextResponse.json({ error: 'Audio buffer is too small' }, { status: 400 });
    }

    try {
      console.log('POST /api/voice-enrollment/create-profile: Creating voice profile in Azure');

      // Create the voice profile
      const result = await createVoiceProfile(buffer);

      console.log(
        `POST /api/voice-enrollment/create-profile: Voice profile created successfully with ID: ${result.profileId}`,
      );

      // Update the enrollment record with the profile ID
      await prisma.voiceEnrollment.update({
        where: {
          id: enrollmentId,
        },
        data: {
          voiceProfileId: result.profileId,
          processingStatus: 'PROFILE_CREATED',
        },
      });

      // Update the user record to set voiceProfileId
      await prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          voiceProfileId: result.profileId,
        },
      });

      return NextResponse.json({ success: true, profileId: result.profileId }, { status: 200 });
    } catch (error) {
      console.error(
        'POST /api/voice-enrollment/create-profile: Error creating voice profile:',
        error,
      );

      // Log detailed error information
      if (error instanceof Error) {
        console.error(`Error type: ${error.name}`);
        console.error(`Error message: ${error.message}`);
        console.error(`Error stack: ${error.stack}`);
      } else {
        console.error(`Unknown error type: ${typeof error}`);
        console.error(`Error value: ${JSON.stringify(error)}`);
      }

      // Update the enrollment status
      await prisma.voiceEnrollment.update({
        where: {
          id: enrollmentId,
        },
        data: {
          processingStatus: 'PROFILE_ERROR',
        },
      });

      return NextResponse.json(
        {
          error: 'Failed to create voice profile',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error('POST /api/voice-enrollment/create-profile: Unhandled error:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
