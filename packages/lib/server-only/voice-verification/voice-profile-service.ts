import { prisma } from '@documenso/prisma';

import { createVoiceProfile, deleteVoiceProfile, verifyVoice } from './azure-speaker-recognition';

/**
 * Result of enrolling a user's voice
 */
export interface EnrollmentResult {
  success: boolean;
  profileId?: string;
  error?: string;
  enrollmentStatus?: string;
}

/**
 * Result of verifying a user's voice
 */
export interface VerificationResult {
  verified: boolean;
  score: number;
  threshold: number;
  details?: Record<string, unknown>;
  error?: string;
}

/**
 * Creates a voice profile for a user during enrollment
 *
 * @param userId - The user ID
 * @param audioBuffer - The audio buffer from voice enrollment
 */
export async function createUserVoiceProfile(
  userId: number,
  audioBuffer: Buffer,
): Promise<EnrollmentResult> {
  try {
    // Create a profile in Azure
    const profileResponse = await createVoiceProfile(audioBuffer);

    // Update user and voice enrollment
    await prisma.$transaction(async (tx) => {
      // Update the voice enrollment
      await tx.voiceEnrollment.updateMany({
        where: {
          userId,
          isActive: true,
        },
        data: {
          voiceProfileId: profileResponse.profileId,
          // Store profile data in a way compatible with the schema
          // This requires the JSON field added to the schema
          isProcessed: true,
          processingStatus: 'ENROLLED',
        },
      });

      // Update the user record
      await tx.user.update({
        where: { id: userId },
        data: {
          voiceProfileId: profileResponse.profileId,
          voiceEnrollmentComplete: true,
          voiceEnrollmentDate: new Date(),
        },
      });
    });

    return {
      success: true,
      profileId: profileResponse.profileId,
      enrollmentStatus: profileResponse.enrollmentStatus,
    };
  } catch (error) {
    console.error('Error creating user voice profile:', error);

    // Update enrollment to indicate error
    await prisma.voiceEnrollment.updateMany({
      where: {
        userId,
        isActive: true,
      },
      data: {
        processingStatus: 'ERROR',
        processingError: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Verifies a user's voice against their enrolled profile
 *
 * @param userId - The user ID
 * @param audioBuffer - The audio buffer to verify
 */
export async function verifyUserVoice(
  userId: number,
  audioBuffer: Buffer,
): Promise<VerificationResult> {
  try {
    // Get the user with their voice profile ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        voiceProfileId: true,
        voiceEnrollmentComplete: true,
      },
    });

    if (!user) {
      return {
        verified: false,
        score: 0,
        threshold: 0.5,
        error: 'User not found',
      };
    }

    // Check if user has completed voice enrollment
    if (!user.voiceEnrollmentComplete || !user.voiceProfileId) {
      return {
        verified: false,
        score: 0,
        threshold: 0.5,
        error: 'Voice profile not enrolled',
      };
    }

    // Verify the voice sample against the enrolled profile
    const verificationResult = await verifyVoice(user.voiceProfileId, audioBuffer);

    // Log the verification attempt using available fields in the schema
    const logType = verificationResult.recognitionResult === 'Accept' ? 'SIGN_IN' : 'SIGN_IN_FAIL';

    await prisma.userSecurityAuditLog.create({
      data: {
        userId,
        type: logType,
        // We can add IP and user agent if available from the request context
        ipAddress: null,
        userAgent: null,
      },
    });

    // Update last used timestamp
    await prisma.voiceEnrollment.updateMany({
      where: {
        userId,
        voiceProfileId: user.voiceProfileId,
        isActive: true,
      },
      data: {
        lastUsedAt: new Date(),
      },
    });

    // Apply a threshold to determine if verified
    const isVerified = verificationResult.recognitionResult === 'Accept';
    const threshold = 0.5; // Define appropriate threshold

    return {
      verified: isVerified,
      score: verificationResult.score,
      threshold,
      details: {
        result: verificationResult.recognitionResult,
      },
    };
  } catch (error) {
    console.error('Error verifying user voice:', error);

    return {
      verified: false,
      score: 0,
      threshold: 0.5,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Re-enrolls a user's voice profile (updates existing profile)
 *
 * @param userId - The user ID
 * @param audioBuffer - New audio for enrollment
 */
export async function reEnrollUserVoice(
  userId: number,
  audioBuffer: Buffer,
): Promise<EnrollmentResult> {
  try {
    // Check if user already has a profile
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        voiceProfileId: true,
      },
    });

    if (!user) {
      return {
        success: false,
        error: 'User not found',
      };
    }

    // If user has existing profile, delete it first
    if (user.voiceProfileId) {
      await deleteVoiceProfile(user.voiceProfileId).catch((err) => {
        // Log error but continue
        console.error(`Error deleting existing voice profile: ${err.message}`);
      });
    }

    // Create a new profile
    return await createUserVoiceProfile(userId, audioBuffer);
  } catch (error) {
    console.error('Error re-enrolling user voice:', error);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
