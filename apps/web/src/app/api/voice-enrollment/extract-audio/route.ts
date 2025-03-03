import type { NextRequest } from 'next/server';

import { getServerSession } from 'next-auth';

import { NEXT_AUTH_OPTIONS } from '@documenso/lib/next-auth/auth-options';
import { prisma } from '@documenso/prisma';

/**
 * Helper function to safely delay execution
 */
const delay = async (ms: number): Promise<void> => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

/**
 * Type guard helper for checking object properties
 */
function hasProperty<T, K extends string>(obj: T, prop: K): obj is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

/**
 * Handles extraction of audio from a voice enrollment video
 * This would use ffmpeg in production, but here we simulate the extraction
 */
export const POST = async (req: NextRequest) => {
  try {
    // Authorize the request
    const session = await getServerSession(NEXT_AUTH_OPTIONS);

    if (!session?.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse the request body for the enrollment ID
    const { enrollmentId } = await req.json();

    if (!enrollmentId) {
      return Response.json({ error: 'No enrollment ID provided' }, { status: 400 });
    }

    // Find the enrollment
    const enrollment = await prisma.voiceEnrollment.findUnique({
      where: { id: enrollmentId },
    });

    if (!enrollment) {
      return Response.json({ error: 'Enrollment not found' }, { status: 404 });
    }

    // Verify user owns this enrollment
    if (enrollment.userId !== session.user.id) {
      return Response.json({ error: 'Not authorized to access this enrollment' }, { status: 403 });
    }

    // Check if video URL exists
    const videoUrl = enrollment.videoUrl;
    if (!videoUrl) {
      return Response.json({ error: 'No video URL found in enrollment' }, { status: 400 });
    }

    // Simulate audio extraction process with a delay
    await delay(1000);

    // Create a new S3 path for the extracted audio
    const audioPath = videoUrl
      .replace('.webm', '.mp3')
      .replace('voice-enrollments/', 'voice-audio/');

    // In a real implementation, we would:
    // 1. Download the video from videoUrl
    // 2. Use ffmpeg to extract audio
    // 3. Upload the audio file to S3
    // 4. Update the database with the audio URL

    // For this simulation, we'll pretend the audio is at the same URL but with .mp3 extension
    await prisma.voiceEnrollment.update({
      where: { id: enrollmentId },
      data: {
        audioUrl: audioPath,
        isProcessed: true,
        processingStatus: 'COMPLETED',
      },
    });

    return Response.json({
      success: true,
      audioUrl: audioPath,
    });
  } catch (error) {
    console.error('Error extracting audio:', error);
    return Response.json(
      { error: 'Failed to extract audio', details: String(error) },
      { status: 500 },
    );
  }
};
