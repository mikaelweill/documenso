import { prisma } from '@documenso/prisma';

export const getUserVoiceEnrollment = async (userId: number) => {
  try {
    const enrollment = await prisma.voiceEnrollment.findFirst({
      where: {
        userId,
        isActive: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return enrollment;
  } catch (error) {
    console.error('Error fetching voice enrollment', error);
    return null;
  }
};
