import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { uploadToS3 } from '@documenso/lib/server-only/storage/s3-storage';

/**
 * API Route to handle temporary voice enrollment uploads during signup.
 * This endpoint receives a video file, stores it in S3, and returns the URL.
 * It doesn't require authentication since it's used during the signup process.
 */
export const POST = async (req: NextRequest) => {
  try {
    console.log('[Temp Upload API] Request received');

    // Use FormData to handle file upload
    console.log('[Temp Upload API] Parsing form data');
    const formData = await req.formData();
    const fileEntry = formData.get('file');
    const durationStr = formData.get('duration');
    const isAudioOnly = formData.get('isAudioOnly') === 'true';

    console.log('[Temp Upload API] File received:', !!fileEntry, 'Duration:', durationStr);

    if (!fileEntry || !(fileEntry instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // Parse duration (seconds)
    const videoDuration = durationStr ? parseInt(durationStr.toString(), 10) : null;

    const file = fileEntry;
    const fileName = file.name;
    const fileType = file.type;

    console.log('[Temp Upload API] File name:', fileName, 'Type:', fileType);

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log('[Temp Upload API] File converted to buffer, size:', buffer.length);

    // Generate a unique filename for S3
    const uniqueFileName = `temp_${Date.now()}.${fileType.split('/')[1] || 'webm'}`;
    console.log('[Temp Upload API] Uploading to S3 with filename:', uniqueFileName);

    // Upload file to S3 and get the URL
    try {
      const videoUrl = await uploadToS3(buffer, fileType, uniqueFileName, 'temp-voice-enrollments');
      console.log(
        '[Temp Upload API] S3 upload successful, URL:',
        videoUrl.substring(0, 50) + '...',
      );

      // Return the URL and duration for the client to use during signup
      return NextResponse.json({
        success: true,
        videoUrl,
        duration: videoDuration,
      });
    } catch (uploadError) {
      console.error('[Temp Upload API] S3 upload error:', uploadError);
      return NextResponse.json(
        { error: 'Failed to upload to S3', details: String(uploadError) },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error('[Temp Upload API] Unhandled error:', error);
    return NextResponse.json(
      {
        error: 'An error occurred during temporary voice enrollment upload',
        details: String(error),
      },
      { status: 500 },
    );
  }
};
