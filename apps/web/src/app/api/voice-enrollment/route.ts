import type { NextRequest } from 'next/server';

import { getServerSession } from 'next-auth';

import { NEXT_AUTH_OPTIONS } from '@documenso/lib/next-auth/auth-options';
import { uploadToS3 } from '@documenso/lib/server-only/storage/s3-storage';
import { prisma } from '@documenso/prisma';

// Extended type to match our schema
interface VoiceEnrollmentWithUrl {
  id: string;
  userId: number;
  videoUrl?: string | null;
  videoDuration?: number | null;
  audioUrl?: string | null;
  isProcessed: boolean;
  processingStatus?: string | null;
  // other fields...
}

/**
 * Type guard helper for checking object properties
 */
function hasProperty<T, K extends string>(obj: T, prop: K): obj is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

/**
 * Handles POST requests for voice enrollment
 * Takes a video file and stores it for future processing and analysis
 */
export const POST = async (req: NextRequest) => {
  try {
    const session = await getServerSession(NEXT_AUTH_OPTIONS);

    if (!session?.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use FormData to handle file upload
    console.log('[Voice Enrollment API] Parsing form data');
    const formData = await req.formData();
    const fileEntry = formData.get('file');
    const durationStr = formData.get('duration');

    // Validate inputs
    if (!fileEntry || !(fileEntry instanceof Blob)) {
      return Response.json({ error: 'No file provided or invalid file type' }, { status: 400 });
    }

    // Convert duration string to number
    const videoDuration = durationStr ? parseFloat(String(durationStr)) : null;
    const isAudioOnly = formData.get('audioOnly') === 'true';

    console.log(
      `[Voice Enrollment API] Received file of type ${fileEntry.type}, size ${fileEntry.size} bytes, duration: ${videoDuration}s`,
    );

    // Convert file to buffer
    const arrayBuffer = await fileEntry.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload the file to S3
    const videoUrl = await uploadToS3(
      buffer,
      fileEntry.type,
      `voice-enrollment-${session.user.id}-${Date.now()}.webm`,
      'voice-enrollments',
    );

    console.log(`[Voice Enrollment API] Uploaded file to ${videoUrl}`);

    // Check if user already has a voice enrollment
    const existingEnrollment = await prisma.voiceEnrollment.findFirst({
      where: {
        userId: session.user.id,
      },
    });

    // Create or update voice enrollment in the database
    let enrollment;
    if (existingEnrollment) {
      // Update existing enrollment
      enrollment = await prisma.voiceEnrollment.update({
        where: {
          id: existingEnrollment.id,
        },
        data: {
          videoUrl: videoUrl,
          videoDuration: videoDuration,
          lastUsedAt: new Date(),
          isProcessed: false,
          processingStatus: 'UPLOADED',
        },
      });
    } else {
      // Create new enrollment
      enrollment = await prisma.voiceEnrollment.create({
        data: {
          userId: session.user.id,
          videoUrl: videoUrl,
          videoDuration: videoDuration,
          processingStatus: 'UPLOADED',
        },
      });
    }

    // Update user's enrollment status
    await prisma.user.update({
      where: {
        id: session.user.id,
      },
      data: {
        voiceEnrollmentComplete: true,
        voiceEnrollmentDate: new Date(),
      },
    });

    return Response.json({
      success: true,
      enrollmentId: enrollment.id,
      videoUrl: videoUrl,
      duration: videoDuration,
    });
  } catch (error) {
    console.error('[Voice Enrollment API] Error:', error);
    return Response.json({ error: 'Failed to process voice enrollment' }, { status: 500 });
  }
};
