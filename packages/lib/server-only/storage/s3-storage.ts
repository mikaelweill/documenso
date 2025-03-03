import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

// FIXME: The following environment variables should be added to turbo.json:
// AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME, AWS_S3_ENDPOINT

// Environment variables for S3 configuration
const AWS_REGION = process.env.AWS_REGION || 'us-west-1';
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
const AWS_S3_ENDPOINT = process.env.AWS_S3_ENDPOINT;

// Initialize S3 client with typed configuration
const s3Client = new S3Client({
  region: AWS_REGION,
  credentials:
    AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: AWS_ACCESS_KEY_ID,
          secretAccessKey: AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
  endpoint: AWS_S3_ENDPOINT,
});

console.log(`S3 Client initialized with region: ${AWS_REGION}, bucket: ${S3_BUCKET_NAME}`);
if (AWS_S3_ENDPOINT) {
  console.log(`Using custom endpoint: ${AWS_S3_ENDPOINT}`);
}

/**
 * Upload a file buffer to S3
 * @param buffer - The file buffer to upload
 * @param fileName - Optional file name (will generate UUID if not provided)
 * @param contentType - MIME type of the file
 * @param folder - Optional folder path inside the bucket
 * @returns The URL of the uploaded file
 */
export async function uploadToS3(
  buffer: Buffer,
  contentType: string,
  fileName?: string,
  folder: string = 'voice-enrollments',
): Promise<string> {
  // Generate a unique filename if not provided
  const finalFileName = fileName || `${uuidv4()}.${getExtensionFromMimeType(contentType)}`;

  // Create the full key (path) in S3
  const key = folder ? `${folder}/${finalFileName}` : finalFileName;

  console.log(`Uploading to S3: ${key} (${formatBytes(buffer.length)})`);

  try {
    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    await s3Client.send(command);

    // Construct the S3 URL based on whether we're using a custom endpoint
    let fileUrl: string;
    if (AWS_S3_ENDPOINT) {
      fileUrl = `${AWS_S3_ENDPOINT}/${S3_BUCKET_NAME}/${key}`;
    } else {
      fileUrl = `https://${S3_BUCKET_NAME}.s3.amazonaws.com/${key}`;
    }

    console.log(`S3 upload successful, URL: ${fileUrl.substring(0, 50)}...`);
    return fileUrl;
  } catch (error) {
    console.error('Error uploading to S3:', error);
    throw new Error(`Failed to upload to S3: ${(error as Error).message}`);
  }
}

/**
 * Generate a presigned URL for temporary access to an S3 object
 * @param key - The key (path) of the object in S3
 * @param expiresIn - Expiration time in seconds (default: 1 hour)
 * @returns A presigned URL for the object
 */
export async function getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
  try {
    // Generate presigned URL
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME || '',
      Key: key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn });
    return url;
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    if (error instanceof Error) {
      throw new Error(`Failed to generate presigned URL: ${error.message}`);
    }
    throw new Error('Failed to generate presigned URL: Unknown error');
  }
}

/**
 * Delete a file from S3
 * @param url - The S3 URL of the file to delete
 * @returns true if deletion was successful, false otherwise
 */
export async function deleteFromS3(url: string): Promise<boolean> {
  try {
    const key = getKeyFromUrl(url);

    if (!key) {
      console.error('Invalid S3 URL format:', url);
      return false;
    }

    const command = new DeleteObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
    console.log(`Successfully deleted S3 object: ${key}`);
    return true;
  } catch (error) {
    console.error('Error deleting file from S3:', error);
    return false;
  }
}

/**
 * Extract S3 key from a full S3 URL
 * @param url - The full S3 URL
 * @returns The key (path) of the object in S3
 */
export function getKeyFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);

    // Handle both path-style and virtual-hosted style URLs
    let key: string;

    if (urlObj.hostname === `${S3_BUCKET_NAME}.s3.amazonaws.com`) {
      // Virtual-hosted style
      key = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
    } else if (urlObj.pathname.startsWith(`/${S3_BUCKET_NAME}/`)) {
      // Path-style
      key = urlObj.pathname.substring(`/${S3_BUCKET_NAME}/`.length);
    } else {
      // Fallback
      key = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
    }

    return key;
  } catch (error) {
    console.error('Invalid URL:', error);
    return null;
  }
}

/**
 * Get file extension from MIME type
 * @param mimeType - The MIME type
 * @returns The file extension
 */
function getExtensionFromMimeType(mimeType: string): string {
  const extensions: Record<string, string> = {
    'video/webm': 'webm',
    'video/mp4': 'mp4',
    'audio/webm': 'webm',
    'audio/mp3': 'mp3',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
  };

  return extensions[mimeType] || 'bin';
}

/**
 * Format bytes to human-readable format
 * @param bytes - Number of bytes
 * @param decimals - Number of decimal places
 * @returns Formatted string (e.g., "1.5 MB")
 */
function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
