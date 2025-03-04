import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import fetch from 'node-fetch';
import { tmpdir } from 'os';
import path from 'path';

import { prisma } from '@documenso/prisma';

import {
  getKeyFromUrl,
  getPresignedUrl,
  uploadToS3,
} from '../../../server-only/storage/s3-storage';
import { type TExtractAudioJobDefinition } from './extract-audio';

// Configure ffmpeg to use the installed version
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * Download a file from a URL to a local path
 */
async function downloadFile(url: string, outputPath: string): Promise<void> {
  try {
    // Get a presigned URL if it's an S3 URL
    let downloadUrl = url;
    const key = getKeyFromUrl(url);

    if (key) {
      console.log(`Getting presigned URL for S3 key: ${key}`);
      try {
        downloadUrl = await getPresignedUrl(key);
        console.log(`Generated presigned URL`);
      } catch (presignError) {
        console.error('Error generating presigned URL:', presignError);
        throw new Error(`Failed to generate presigned URL: ${presignError}`);
      }
    }

    console.log(`Downloading file from URL to ${outputPath}`);

    // Download the file
    const response = await fetch(downloadUrl);

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    await fs.writeFile(outputPath, new Uint8Array(buffer));
    console.log(`File downloaded successfully to ${outputPath}`);
  } catch (error) {
    console.error('Error downloading file:', error);
    throw error;
  }
}

/**
 * Extract audio from a video file
 */
async function extractAudio(videoPath: string, audioPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    ffmpeg(videoPath)
      .output(audioPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .on('end', () => {
        resolve();
      })
      .on('error', (err: Error) => {
        reject(err);
      })
      .run();
  });
}

/**
 * Get the size of a file in a human-readable format
 */
async function getFileSize(filePath: string): Promise<string> {
  const stats = await fs.stat(filePath);
  const fileSizeInBytes = stats.size;

  // Convert to KB, MB, etc.
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = fileSizeInBytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Job handler function
 */
export const run = async ({ payload }: { payload: TExtractAudioJobDefinition }) => {
  const { enrollmentId } = payload;

  try {
    // Find the enrollment in the database
    const enrollmentData = await prisma.voiceEnrollment.findUnique({
      where: { id: enrollmentId },
    });

    if (!enrollmentData) {
      throw new Error('Enrollment not found');
    }

    // Check if video URL exists
    const videoUrl = enrollmentData.videoUrl ?? '';
    if (!videoUrl) {
      throw new Error('No video URL found in enrollment');
    }

    // Check if enrollment already has an audio URL
    if (enrollmentData.audioUrl) {
      console.log('Audio already extracted, skipping job');
      return;
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

    // Create temp directory paths for processing
    const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'voice-enrollment-'));
    const videoFilename = `video-${Date.now()}.webm`;
    const audioFilename = `audio-${Date.now()}.mp3`;
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
        'audio/mp3',
        `audio-${Date.now()}.mp3`,
        'voice-audio',
      );

      console.log(`Audio uploaded to S3: ${s3AudioUrl}`);

      // Update the enrollment record with the audio URL
      await prisma.voiceEnrollment.update({
        where: {
          id: enrollmentId,
        },
        data: {
          audioUrl: s3AudioUrl,
          processingStatus: 'AUDIO_EXTRACTED',
          readyForProfileCreation: true,
          updatedAt: new Date(),
        },
      });

      // Clean up temp files
      await fs.unlink(videoPath).catch(console.error);
      await fs.unlink(audioPath).catch(console.error);
      await fs.rmdir(tempDir).catch(console.error);

      console.log('Audio extraction completed successfully');
    } catch (processingError) {
      // Clean up temp files if they exist
      await fs.unlink(videoPath).catch(() => {});
      await fs.unlink(audioPath).catch(() => {});
      await fs.rmdir(tempDir).catch(() => {});

      console.error('Error during audio extraction:', processingError);

      // Update the enrollment with the error
      await prisma.voiceEnrollment.update({
        where: {
          id: enrollmentId,
        },
        data: {
          processingStatus: 'ERROR',
          processingError: String(processingError),
          updatedAt: new Date(),
        },
      });

      throw processingError;
    }
  } catch (error) {
    console.error('Error extracting audio:', error);
    throw error;
  }
};
