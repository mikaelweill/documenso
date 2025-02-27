import { NextResponse } from 'next/server';

import { getRequiredServerComponentSession } from '@documenso/lib/next-auth/get-server-component-session';
import { prisma } from '@documenso/prisma';

export async function POST(req: Request) {
  try {
    // Check authentication
    const { session } = await getRequiredServerComponentSession();

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get field ID from request
    const body = await req.json();
    const { fieldId } = body;

    if (!fieldId) {
      return NextResponse.json({ error: 'Field ID is required' }, { status: 400 });
    }

    // First, get the field details
    const field = await prisma.field.findUnique({
      where: {
        id: parseInt(fieldId),
      },
      select: {
        id: true,
        type: true,
        inserted: true,
      },
    });

    if (!field) {
      return NextResponse.json({ error: 'Field not found' }, { status: 404 });
    }

    // Get the signature data for this field
    const signature = await prisma.signature.findFirst({
      where: {
        fieldId: parseInt(fieldId),
      },
    });

    // Check if voice signature data exists but transcript doesn't
    const hasVoiceData = !!signature?.voiceSignatureUrl;
    const hasTranscript = !!signature?.voiceSignatureTranscript;
    const hasMetadata = !!signature?.voiceSignatureMetadata;

    let parsedMetadata = null;
    if (hasMetadata && signature?.voiceSignatureMetadata) {
      try {
        // Try to parse the metadata without showing the actual audio data
        const metadataObj = signature.voiceSignatureMetadata as Record<string, unknown>;
        parsedMetadata = {
          hasTranscriptInMetadata: !!metadataObj.transcript,
          transcriptLength:
            typeof metadataObj.transcript === 'string' ? metadataObj.transcript.length : 0,
          transcriptPreview:
            typeof metadataObj.transcript === 'string'
              ? metadataObj.transcript.substring(0, 50) +
                (metadataObj.transcript.length > 50 ? '...' : '')
              : null,
          duration: metadataObj.duration,
        };
      } catch (e) {
        parsedMetadata = { error: 'Failed to parse metadata' };
      }
    }

    return NextResponse.json({
      field,
      signatureExists: !!signature,
      hasVoiceData,
      hasTranscript,
      hasMetadata,
      transcriptValue: hasTranscript ? signature?.voiceSignatureTranscript : null,
      metadata: parsedMetadata,
    });
  } catch (error) {
    console.error('Error in voice transcript check endpoint:', error);
    return NextResponse.json({ error: 'Failed to check voice transcript' }, { status: 500 });
  }
}
