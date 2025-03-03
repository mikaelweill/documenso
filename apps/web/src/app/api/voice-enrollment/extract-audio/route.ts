import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffmpeg from 'fluent-ffmpeg';
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import { getServerSession } from 'next-auth';
import fetch from 'node-fetch';
import { tmpdir } from 'os';
import path from 'path';

import { NEXT_AUTH_OPTIONS } from '@documenso/lib/next-auth/auth-options';
import { uploadToS3 } from '@documenso/lib/server-only/storage/s3-storage';
import { prisma } from '@documenso/prisma';

// Constants
const _INTERNAL_API_URL = process.env.NEXT_PRIVATE_INTERNAL_WEBAPP_URL || 'http://localhost:3000';

// Configure ffmpeg to use the installed version
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * Helper function to safely delay execution
 */
const _delay = async (ms: number): Promise<void> => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

/**
 * Type guard helper for checking object properties
 */
function _hasProperty<T, K extends string>(obj: T, prop: K): obj is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

/**
 * Downloads a file from a URL to a local path
 */
async function downloadFile(url: string, outputPath: string): Promise<void> {
  console.log(`Downloading file from ${url} to ${outputPath}`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }

  const fileStream = createWriteStream(outputPath);
  await new Promise<void>((resolve, reject) => {
    if (!response.body) {
      reject(new Error('No response body'));
      return;
    }

    response.body.pipe(fileStream);
    fileStream.on('finish', () => {
      fileStream.close();
      resolve();
    });
    fileStream.on('error', reject);
  });

  console.log('Download complete');
}

/**
 * Extracts audio from a video file using ffmpeg
 */
async function extractAudio(videoPath: string, audioPath: string): Promise<void> {
  console.log(`Extracting audio from ${videoPath} to ${audioPath}`);

  return new Promise<void>((resolve, reject) => {
    ffmpeg(videoPath)
      .output(audioPath)
      .noVideo()
      .audioCodec('pcm_s16le') // 16-bit PCM (required by Azure)
      .audioChannels(1) // Mono (required by Azure)
      .audioFrequency(16000) // 16kHz sample rate (required by Azure)
      .format('wav') // WAV format (required by Azure)
      .on('end', () => {
        console.log('Audio extraction complete - WAV format for Azure compatibility');
        resolve();
      })
      .on('error', (err: Error) => {
        console.error('Error extracting audio:', err);
        reject(err);
      })
      .run();
  });
}

/**
 * Get file size in a formatted string
 */
async function getFileSize(filePath: string): Promise<string> {
  const stats = await fs.stat(filePath);
  const bytes = stats.size;

  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

/**
 * Update the enrollment record with the audio URL without creating a profile
 */
async function updateEnrollmentWithAudioUrl(
  enrollmentId: string,
  audioUrl: string,
  error?: string,
): Promise<void> {
  try {
    // Update the enrollment record with the audio URL
    await prisma.voiceEnrollment.update({
      where: { id: enrollmentId },
      data: {
        audioUrl,
        processingStatus: error ? 'ERROR' : 'AUDIO_EXTRACTED',
        processingError: error,
        isProcessed: !error,
        updatedAt: new Date(),
      },
    });

    console.log(`Updated enrollment ${enrollmentId} with audio URL: ${audioUrl}`);
    console.log(
      'Audio extraction successful, profile creation will be done later after user logs in',
    );

    // No profile creation - this will be done when user clicks the profile creation button
  } catch (error) {
    console.error(`Error updating enrollment ${enrollmentId}:`, error);
    throw error;
  }
}

/**
 * Handles extraction of audio from a voice enrollment video using ffmpeg
 */
export async function POST(req: NextRequest) {
  try {
    // Authorize the request
    const session = await getServerSession(NEXT_AUTH_OPTIONS);

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse the request body for the enrollment ID or video URL
    const body = await req.json();

    // We can either process by enrollment ID or direct video URL
    const { enrollmentId, videoUrl: directVideoUrl } = body;

    let videoUrl: string;
    let enrollmentData = null;

    if (enrollmentId) {
      // Find the enrollment in the database
      enrollmentData = await prisma.voiceEnrollment.findUnique({
        where: { id: enrollmentId },
      });

      if (!enrollmentData) {
        return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
      }

      // Verify user owns this enrollment
      if (enrollmentData.userId !== session.user.id) {
        return NextResponse.json(
          { error: 'Not authorized to access this enrollment' },
          { status: 403 },
        );
      }

      // Check if video URL exists
      videoUrl = enrollmentData.videoUrl ?? '';
      if (!videoUrl) {
        return NextResponse.json({ error: 'No video URL found in enrollment' }, { status: 400 });
      }

      // Check if enrollment already has an audio URL
      if (enrollmentData.audioUrl) {
        return NextResponse.json(
          {
            message: 'Audio already extracted',
            audioUrl: enrollmentData.audioUrl,
          },
          { status: 200 },
        );
      }

      // Update status to processing
      await prisma.voiceEnrollment.update({
        where: {
          id: enrollmentId,
        },
        data: {
          processingStatus: 'PROCESSING',
          updatedAt: new Date(),
        },
      });
    } else if (directVideoUrl) {
      // Use direct video URL provided in the request
      videoUrl = directVideoUrl;
    } else {
      return NextResponse.json(
        { error: 'Either enrollmentId or videoUrl must be provided' },
        { status: 400 },
      );
    }

    // Create temp directory paths for processing
    const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'voice-enrollment-'));
    const videoFilename = `video-${Date.now()}.webm`;
    const audioFilename = `audio-${Date.now()}.wav`;
    const videoPath = path.join(tempDir, videoFilename);
    const audioPath = path.join(tempDir, audioFilename);

    try {
      // Download the video file
      await downloadFile(videoUrl, videoPath);
      console.log(`Video downloaded to ${videoPath}`);

      // Get video file size
      const videoSize = await getFileSize(videoPath);
      console.log(`Video size: ${videoSize}`);

      // Extract audio from the video
      await extractAudio(videoPath, audioPath);

      // Get audio file size
      const audioSize = await getFileSize(audioPath);
      console.log(`Audio size: ${audioSize}`);

      // Read the audio file
      const audioBuffer = await fs.readFile(audioPath);

      // Upload the audio to S3
      const s3AudioUrl = await uploadToS3(
        audioBuffer,
        'audio/wav',
        `audio-${Date.now()}.wav`,
        'voice-audio',
      );

      console.log(`Audio uploaded to S3: ${s3AudioUrl}`);

      // Update the enrollment record with the audio URL if we have an enrollment ID
      if (enrollmentId && enrollmentData) {
        await updateEnrollmentWithAudioUrl(enrollmentId, s3AudioUrl);
      }

      // Clean up temp files
      await fs.unlink(videoPath);
      await fs.unlink(audioPath);
      await fs.rmdir(tempDir);

      return NextResponse.json({
        success: true,
        message: 'Audio extracted successfully',
        audioUrl: s3AudioUrl,
        enrollmentId: enrollmentId,
        readyForProfile: true,
      });
    } catch (processingError) {
      // Clean up temp files if they exist
      await fs.unlink(videoPath).catch(() => {});
      await fs.unlink(audioPath).catch(() => {});
      await fs.rmdir(tempDir).catch(() => {});

      console.error('Error during audio extraction:', processingError);

      // Update the enrollment with the error if we have an enrollment ID
      if (enrollmentId) {
        await updateEnrollmentWithAudioUrl(enrollmentId, '', String(processingError));
      }

      throw processingError;
    }
  } catch (error) {
    console.error('Error extracting audio:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to extract audio',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
