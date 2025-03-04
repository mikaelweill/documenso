import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getServerSession } from 'next-auth';
import { z } from 'zod';

import { NEXT_AUTH_OPTIONS } from '@documenso/lib/next-auth/auth-options';
import { checkProfileExists } from '@documenso/lib/server-only/voice-verification/voice-profile-service';
import { prisma } from '@documenso/prisma';

// Define schema for profile check request
export const ZProfileCheckRequestSchema = z.object({
  profileId: z.string().optional(),
  userId: z.number().optional(),
});

type TProfileCheckRequest = z.infer<typeof ZProfileCheckRequestSchema>;

/**
 * POST /api/voice-verification/check-profile
 * Endpoint for checking if a voice profile exists and is valid in Azure
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
    const parsedBody = ZProfileCheckRequestSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsedBody.error.format() },
        { status: 400 },
      );
    }

    const { profileId, userId } = parsedBody.data;

    // If profileId is provided directly, check it
    if (profileId) {
      const result = await checkProfileExists(profileId);
      return NextResponse.json(result);
    }

    // If userId is provided, look up their profile ID
    if (userId) {
      // Check if this is the current user or an admin
      if (userId !== session.user.id) {
        return NextResponse.json(
          { error: "Unauthorized to check another user's profile" },
          { status: 403 },
        );
      }

      // Look up the user's voice enrollment
      const enrollment = await prisma.voiceEnrollment.findFirst({
        where: {
          userId,
          isActive: true,
          voiceProfileId: { not: null },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!enrollment?.voiceProfileId) {
        return NextResponse.json({
          exists: false,
          details: 'User has no active voice profile ID',
        });
      }

      // Check if profile exists in Azure
      const result = await checkProfileExists(enrollment.voiceProfileId);
      return NextResponse.json({
        ...result,
        profileId: enrollment.voiceProfileId,
        enrollmentId: enrollment.id,
      });
    }

    // If neither profileId nor userId provided
    return NextResponse.json({ error: 'Either profileId or userId is required' }, { status: 400 });
  } catch (error) {
    console.error('Error in voice profile check:', error);

    return NextResponse.json(
      {
        error: 'Failed to check voice profile',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
