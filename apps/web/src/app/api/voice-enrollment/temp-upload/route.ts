import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { uploadToS3 } from '@documenso/lib/server-only/storage/s3-storage';

// Custom type guard for file-like objects
function isFileLike(
  value: unknown,
): value is { name?: string; type?: string; arrayBuffer(): Promise<ArrayBuffer> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'arrayBuffer' in value &&
    typeof value.arrayBuffer === 'function'
  );
}

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

    console.log(
      '[Temp Upload API] File received:',
      !!fileEntry,
      'Duration:',
      durationStr,
      'Audio only:',
      isAudioOnly,
    );

    // Check if fileEntry exists and has the necessary properties
    if (!isFileLike(fileEntry)) {
      return NextResponse.json({ error: 'No valid file uploaded' }, { status: 400 });
    }

    // Parse duration (seconds)
    const videoDuration = durationStr ? parseInt(durationStr.toString(), 10) : null;

    // Extract filename and type safely
    const fileName = fileEntry.name ?? `upload-${Date.now()}`;
    const fileType = fileEntry.type ?? (isAudioOnly ? 'audio/webm' : 'video/webm');

    console.log('[Temp Upload API] File name:', fileName, 'Type:', fileType);

    // Convert file to buffer
    const arrayBuffer = await fileEntry.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log('[Temp Upload API] File converted to buffer, size:', buffer.length);

    // Generate a unique filename for S3
    const fileExtension = fileType.split('/')[1] || 'webm';
    const uniqueFileName = `temp_${Date.now()}.${fileExtension}`;
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
