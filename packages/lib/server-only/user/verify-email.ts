import { DateTime } from 'luxon';

import { prisma } from '@documenso/prisma';

import { jobsClient } from '../../jobs/client';
import { createUserVoiceProfile } from '../voice-verification/voice-profile-service';

export const EMAIL_VERIFICATION_STATE = {
  NOT_FOUND: 'NOT_FOUND',
  VERIFIED: 'VERIFIED',
  EXPIRED: 'EXPIRED',
  ALREADY_VERIFIED: 'ALREADY_VERIFIED',
} as const;

export type VerifyEmailProps = {
  token: string;
};

/**
 * Process any pending voice enrollments after email verification
 * This creates Azure voice profiles for any enrollments that have audio extracted but no profile created
 */
async function processPendingVoiceEnrollments(userId: number) {
  try {
    // Find voice enrollments that are ready for profile creation
    const pendingEnrollments = await prisma.voiceEnrollment.findMany({
      where: {
        userId,
        readyForProfileCreation: true,
        voiceProfileId: null, // No profile created yet
        audioUrl: { not: null }, // Has audio extracted
      },
    });

    console.log(`Found ${pendingEnrollments.length} pending voice enrollments for user ${userId}`);

    if (pendingEnrollments.length === 0) {
      return;
    }

    // Process each enrollment to create voice profile
    for (const enrollment of pendingEnrollments) {
      try {
        if (!enrollment.audioUrl) {
          continue; // Skip if no audio URL (shouldn't happen due to query filter)
        }

        console.log(`Creating voice profile for enrollment ${enrollment.id}`);

        // Update status
        await prisma.voiceEnrollment.update({
          where: { id: enrollment.id },
          data: { processingStatus: 'CREATING_PROFILE' },
        });

        // Fetch audio
        const audioResponse = await fetch(enrollment.audioUrl);
        if (!audioResponse.ok) {
          throw new Error(`Failed to fetch audio: ${audioResponse.statusText}`);
        }

        // Convert to buffer
        const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

        // Create profile
        const result = await createUserVoiceProfile(userId, audioBuffer);

        if (result.success && result.profileId) {
          // Update with profile info
          await prisma.voiceEnrollment.update({
            where: { id: enrollment.id },
            data: {
              voiceProfileId: result.profileId,
              processingStatus: 'PROFILE_CREATED',
              profileData: result,
              readyForProfileCreation: false,
            },
          });

          console.log(`Voice profile created successfully: ${result.profileId}`);
        } else {
          throw new Error(result.error || 'Unknown error creating voice profile');
        }
      } catch (error) {
        console.error(`Error creating voice profile for enrollment ${enrollment.id}:`, error);

        // Update with error but continue with other enrollments
        await prisma.voiceEnrollment.update({
          where: { id: enrollment.id },
          data: {
            processingStatus: 'PROFILE_ERROR',
            processingError: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  } catch (error) {
    console.error('Error processing pending voice enrollments:', error);
    // Don't throw - this is a background task that shouldn't affect email verification
  }
}

export const verifyEmail = async ({ token }: VerifyEmailProps) => {
  const verificationToken = await prisma.verificationToken.findFirst({
    include: {
      user: true,
    },
    where: {
      token,
    },
  });

  if (!verificationToken) {
    return EMAIL_VERIFICATION_STATE.NOT_FOUND;
  }

  // check if the token is valid or expired
  const valid = verificationToken.expires > new Date();

  if (!valid) {
    const mostRecentToken = await prisma.verificationToken.findFirst({
      where: {
        userId: verificationToken.userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // If there isn't a recent token or it's older than 1 hour, send a new token
    if (
      !mostRecentToken ||
      DateTime.now().minus({ hours: 1 }).toJSDate() > mostRecentToken.createdAt
    ) {
      await jobsClient.triggerJob({
        name: 'send.signup.confirmation.email',
        payload: {
          email: verificationToken.user.email,
        },
      });
    }

    return EMAIL_VERIFICATION_STATE.EXPIRED;
  }

  if (verificationToken.completed) {
    return EMAIL_VERIFICATION_STATE.ALREADY_VERIFIED;
  }

  const [updatedUser] = await prisma.$transaction([
    prisma.user.update({
      where: {
        id: verificationToken.userId,
      },
      data: {
        emailVerified: new Date(),
      },
    }),
    prisma.verificationToken.updateMany({
      where: {
        userId: verificationToken.userId,
      },
      data: {
        completed: true,
      },
    }),
    // Tidy up old expired tokens
    prisma.verificationToken.deleteMany({
      where: {
        userId: verificationToken.userId,
        expires: {
          lt: new Date(),
        },
      },
    }),
  ]);

  if (!updatedUser) {
    throw new Error('Something went wrong while verifying your email. Please try again.');
  }

  // Process any pending voice enrollments in the background
  // We don't await this to avoid blocking the email verification response
  processPendingVoiceEnrollments(verificationToken.userId).catch(console.error);

  return EMAIL_VERIFICATION_STATE.VERIFIED;
};
