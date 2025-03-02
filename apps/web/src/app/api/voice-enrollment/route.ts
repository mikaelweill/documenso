import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getServerSession } from 'next-auth';

import { NEXT_AUTH_OPTIONS } from '@documenso/lib/next-auth/auth-options';
import { prisma } from '@documenso/prisma';

/**
 * API Route to handle voice enrollment uploads.
 * This endpoint receives a video file and stores it for voice profile creation.
 */
export const POST = async (req: NextRequest) => {
  try {
    // Get server session
    const session = await getServerSession(NEXT_AUTH_OPTIONS);

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use FormData to handle file upload
    const formData = await req.formData();
    const fileEntry = formData.get('file');

    if (!fileEntry || !(fileEntry instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const file = fileEntry; // Now TypeScript knows it's a File

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Check if user already has an enrollment
    const existingEnrollment = await prisma.voiceEnrollment.findFirst({
      where: {
        userId: session.user.id,
      },
    });

    // Update existing or create new enrollment
    if (existingEnrollment) {
      await prisma.voiceEnrollment.update({
        where: {
          id: existingEnrollment.id,
        },
        data: {
          voicePatternData: buffer,
          lastUsedAt: new Date(),
        },
      });
    } else {
      await prisma.voiceEnrollment.create({
        data: {
          userId: session.user.id,
          voicePatternData: buffer,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in voice enrollment:', error);
    return NextResponse.json(
      { error: 'An error occurred during voice enrollment' },
      { status: 500 },
    );
  }
};
