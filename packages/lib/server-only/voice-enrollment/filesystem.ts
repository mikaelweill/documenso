'use server';

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

import { BASE_ENROLLMENT_VIDEO_PATH } from './constants';

/**
 * Saves a video blob to the local filesystem.
 *
 * @param userId - The ID of the user the video belongs to
 * @param videoBlob - The video blob to save
 * @returns The path to the saved video file
 */
export async function saveEnrollmentVideo(userId: number, videoBlob: Blob): Promise<string> {
  // Create directory if it doesn't exist
  const userDir = path.join(BASE_ENROLLMENT_VIDEO_PATH, userId.toString());

  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }

  // Generate a unique filename
  const filename = `${randomUUID()}.webm`;
  const filePath = path.join(userDir, filename);

  // Convert blob to buffer and save
  const arrayBuffer = await videoBlob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(filePath, buffer as unknown as Buffer & { buffer: ArrayBuffer });

  // Return the relative path (without the base path)
  return path.join(userId.toString(), filename);
}

/**
 * Deletes an enrollment video from the local filesystem.
 *
 * @param enrollmentVideoPath - The path to the video file relative to BASE_ENROLLMENT_VIDEO_PATH
 * @returns True if the file was deleted, false otherwise
 */
export function deleteEnrollmentVideo(enrollmentVideoPath: string): boolean {
  try {
    const fullPath = path.join(BASE_ENROLLMENT_VIDEO_PATH, enrollmentVideoPath);

    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error deleting enrollment video:', error);
    return false;
  }
}

/**
 * Gets the full path to an enrollment video.
 *
 * @param enrollmentVideoPath - The path to the video file relative to BASE_ENROLLMENT_VIDEO_PATH
 * @returns The full path to the video file
 */
export function getEnrollmentVideoPath(enrollmentVideoPath: string): string {
  return path.join(BASE_ENROLLMENT_VIDEO_PATH, enrollmentVideoPath);
}

/**
 * Checks if an enrollment video exists.
 *
 * @param enrollmentVideoPath - The path to the video file relative to BASE_ENROLLMENT_VIDEO_PATH
 * @returns True if the file exists, false otherwise
 */
export function enrollmentVideoExists(enrollmentVideoPath: string): boolean {
  const fullPath = path.join(BASE_ENROLLMENT_VIDEO_PATH, enrollmentVideoPath);
  return fs.existsSync(fullPath);
}

/**
 * Reads an enrollment video as a buffer.
 *
 * @param enrollmentVideoPath - The path to the video file relative to BASE_ENROLLMENT_VIDEO_PATH
 * @returns The video buffer or null if the file doesn't exist
 */
export function readEnrollmentVideo(enrollmentVideoPath: string): Buffer | null {
  try {
    const fullPath = path.join(BASE_ENROLLMENT_VIDEO_PATH, enrollmentVideoPath);

    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath);
    }

    return null;
  } catch (error) {
    console.error('Error reading enrollment video:', error);
    return null;
  }
}
