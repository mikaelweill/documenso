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

export const POST = async (req: NextRequest) => {
  try {
    // Authorize the request
    const session = await getServerSession(NEXT_AUTH_OPTIONS);

    if (!session?.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has completed voice enrollment
    const enrollment = await prisma.voiceEnrollment.findFirst({
      where: {
        userId: session.user.id,
        isProcessed: true,
      },
    });

    if (!enrollment) {
      return Response.json({ error: 'Voice enrollment not found' }, { status: 404 });
    }

    // Extract audio URL from enrollment
    if (!enrollment.audioUrl) {
      return Response.json({ error: 'No voice enrollment audio found' }, { status: 400 });
    }

    // Parse form data with the verification audio
    const formData = await req.formData();
    const audioFile = formData.get('audio');

    if (!audioFile || !(audioFile instanceof File)) {
      return Response.json({ error: 'No audio file provided' }, { status: 400 });
    }

    // In a real implementation:
    // 1. Process the audio files (enrollment.audioUrl and audioFile)
    // 2. Run voice verification algorithms to compare the voices
    // 3. Return a confidence score or match result

    // For simulation purposes, we're just adding a delay
    // and returning a random score between 0.7 and 0.95
    await delay(1500);

    const score = 0.7 + Math.random() * 0.25;
    const isMatch = score > 0.85;

    // Store verification result (commented out since schema may not include voiceVerification yet)
    // If you have the voiceVerification model in your schema, uncomment this code
    /* 
    await prisma.voiceVerification.create({
      data: {
        userId: session.user.id,
        enrollmentId: enrollment.id,
        score,
        isMatch,
        status: isMatch ? 'SUCCESS' : 'FAILED',
      },
    });
    */

    // Log the verification attempt
    console.log(
      `Voice verification attempt: User ID ${session.user.id}, Score: ${score}, Match: ${isMatch}`,
    );

    return Response.json({
      success: true,
      score,
      isMatch,
      threshold: 0.85,
      message: isMatch ? 'Voice verified successfully' : 'Voice verification failed',
    });
  } catch (error) {
    console.error('Error during voice verification:', error);
    return Response.json(
      { error: 'Failed to verify voice', details: String(error) },
      { status: 500 },
    );
  }
};
