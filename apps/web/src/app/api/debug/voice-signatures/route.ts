import { NextResponse } from 'next/server';

import { getRequiredServerComponentSession } from '@documenso/lib/next-auth/get-server-component-session';
import { prisma } from '@documenso/prisma';

export async function GET() {
  try {
    // Check authentication
    const { session } = await getRequiredServerComponentSession();

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get latest 10 voice signatures
    const voiceSignatures = await prisma.signature.findMany({
      where: {
        voiceSignatureUrl: {
          not: null,
        },
      },
      select: {
        id: true,
        fieldId: true,
        recipientId: true,
        voiceSignatureCreatedAt: true,
        voiceSignatureTranscript: true,
        voiceSignatureMetadata: true,
      },
      orderBy: {
        voiceSignatureCreatedAt: 'desc',
      },
      take: 10,
    });

    // Process and return the data
    const processedData = voiceSignatures.map((signature) => {
      return {
        id: signature.id,
        fieldId: signature.fieldId,
        recipientId: signature.recipientId,
        createdAt: signature.voiceSignatureCreatedAt,
        hasTranscript: !!signature.voiceSignatureTranscript,
        transcriptLength: signature.voiceSignatureTranscript?.length || 0,
        transcript: signature.voiceSignatureTranscript?.substring(0, 50),
        hasMetadata: !!signature.voiceSignatureMetadata,
        metadataContent: signature.voiceSignatureMetadata
          ? JSON.stringify(signature.voiceSignatureMetadata).substring(0, 100)
          : null,
      };
    });

    return NextResponse.json({
      count: voiceSignatures.length,
      signatures: processedData,
    });
  } catch (error) {
    console.error('Error in voice signatures debug endpoint:', error);
    return NextResponse.json({ error: 'Failed to fetch voice signatures' }, { status: 500 });
  }
}
