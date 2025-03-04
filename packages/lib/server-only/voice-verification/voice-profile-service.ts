import { randomUUID } from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import { unlinkSync } from 'fs';
// Add imports for audio conversion
import { writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { prisma } from '@documenso/prisma';

// Import the axios version
import { verifyVoiceWithAxios } from './axios-speaker-recognition';
import {
  type VoiceVerificationResponse,
  createVoiceProfile,
  deleteVoiceProfile,
  getAzureCredentials,
  verifyVoice,
} from './azure-speaker-recognition';

// Enhanced logging function
function logVoiceProfile(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [Voice Profile Service] ${message}`);
  if (data) {
    try {
      console.log(
        `[${timestamp}] [Voice Profile Service] Data:`,
        typeof data === 'object' ? JSON.stringify(data, null, 2) : data,
      );
    } catch (err) {
      console.log(
        `[${timestamp}] [Voice Profile Service] Data: [Complex object, stringification failed]`,
      );
    }
  }
}

/**
 * Result of enrolling a user's voice
 */
export interface EnrollmentResult {
  success: boolean;
  profileId?: string;
  error?: string;
  enrollmentStatus?: string;
}

/**
 * Result of verifying a user's voice
 */
export interface VerificationResult {
  verified: boolean;
  score: number;
  threshold: number;
  details?: Record<string, unknown>;
  error?: string;
}

/**
 * Check if a voice profile exists in Azure
 * This can be used for diagnostics to verify profile validity
 * @param profileId The Azure voice profile ID to check
 * @returns Object with exists flag and any error details
 */
export async function checkProfileExists(
  profileId: string,
): Promise<{ exists: boolean; details?: string }> {
  try {
    logVoiceProfile(`Checking if profile exists: ${profileId}`);

    if (!profileId) {
      logVoiceProfile('No profile ID provided for existence check');
      return { exists: false, details: 'No profile ID provided' };
    }

    const { speechKey: AZURE_SPEECH_KEY, speechRegion: AZURE_SPEECH_REGION } =
      getAzureCredentials();

    if (!AZURE_SPEECH_KEY) {
      logVoiceProfile('Azure speech key not found');
      return { exists: false, details: 'Azure credentials missing' };
    }

    logVoiceProfile(`Using endpoint region: ${AZURE_SPEECH_REGION}`);

    const endpoint = `https://${AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/speaker/verification/v2.0/text-independent/profiles/${profileId}`;
    logVoiceProfile(`Making API request to: ${endpoint}`);

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
        'Content-Type': 'application/json',
      },
    });

    logVoiceProfile(`Profile check response status: ${response.status}`);

    if (response.ok) {
      const data = await response.json();
      logVoiceProfile('Profile check successful:', data);
      return {
        exists: true,
        details: `Profile exists with status: ${data.enrollmentStatus || 'unknown'}`,
      };
    } else {
      const errorText = await response.text();
      logVoiceProfile(`Profile check failed: ${response.status}`, errorText);
      return {
        exists: false,
        details: `Azure returned status ${response.status}: ${errorText}`,
      };
    }
  } catch (error) {
    logVoiceProfile('Error checking profile existence:', error);
    return {
      exists: false,
      details: error instanceof Error ? error.message : 'Unknown error checking profile',
    };
  }
}

/**
 * Convert audio buffer to WAV format for Azure compatibility
 * @param inputBuffer The source audio buffer (WebM, MP3, etc.)
 * @returns A buffer containing the converted WAV audio
 */
async function convertAudioToWav(inputBuffer: Buffer): Promise<Buffer> {
  // Create temporary file paths
  const tempDir = tmpdir();
  const inputPath = join(tempDir, `${randomUUID()}-input.webm`);
  const outputPath = join(tempDir, `${randomUUID()}-output.wav`);

  logVoiceProfile(`Converting audio: Buffer size=${inputBuffer.length} bytes`);
  logVoiceProfile(`Creating temp files: Input=${inputPath}, Output=${outputPath}`);

  // Log the first few bytes to help identify format
  try {
    const bufferPrefix = Array.from(inputBuffer.subarray(0, 20))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    logVoiceProfile(`Buffer header bytes: ${bufferPrefix}`);

    // Detect audio format
    if (inputBuffer.length > 4) {
      // Check for WebM
      if (
        inputBuffer[0] === 0x1a &&
        inputBuffer[1] === 0x45 &&
        inputBuffer[2] === 0xdf &&
        inputBuffer[3] === 0xa3
      ) {
        logVoiceProfile('Detected WebM format from magic number');
      }
      // Check for WAV
      else if (
        inputBuffer.length > 12 &&
        inputBuffer[0] === 0x52 &&
        inputBuffer[1] === 0x49 &&
        inputBuffer[2] === 0x46 &&
        inputBuffer[3] === 0x46 &&
        inputBuffer[8] === 0x57 &&
        inputBuffer[9] === 0x41 &&
        inputBuffer[10] === 0x56 &&
        inputBuffer[11] === 0x45
      ) {
        logVoiceProfile('Detected WAV format from header');
      }
    }
  } catch (e) {
    logVoiceProfile('Error analyzing buffer header:', e);
  }

  try {
    // Write input buffer to temp file - fix the type error by using Uint8Array
    logVoiceProfile('Writing input buffer to temp file...');
    await writeFile(inputPath, new Uint8Array(inputBuffer));

    // Convert to WAV using ffmpeg
    logVoiceProfile('Starting ffmpeg conversion to WAV...');
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .outputFormat('wav')
        // Configure audio for optimal speech recognition
        .audioChannels(1) // Mono
        .audioFrequency(16000) // 16kHz sampling
        .output(outputPath)
        .on('start', (commandLine) => {
          logVoiceProfile(`FFmpeg command: ${commandLine}`);
        })
        .on('progress', (progress) => {
          logVoiceProfile(`FFmpeg progress: ${JSON.stringify(progress)}`);
        })
        .on('end', () => {
          logVoiceProfile('FFmpeg conversion completed successfully');
          resolve();
        })
        .on('error', (err) => {
          logVoiceProfile(`FFmpeg error: ${err.message}`);
          reject(new Error(`Audio conversion error: ${err.message}`));
        })
        .run();
    });

    // Read the output file
    logVoiceProfile('Reading converted WAV file...');
    const { readFile } = await import('fs/promises');
    const outputBuffer = await readFile(outputPath);
    logVoiceProfile(
      `Conversion complete: Original=${inputBuffer.length} bytes, WAV=${outputBuffer.length} bytes`,
    );

    return outputBuffer;
  } catch (error) {
    logVoiceProfile('Error converting audio:', error);
    throw new Error(
      `Failed to convert audio: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    // Clean up temp files
    try {
      logVoiceProfile('Cleaning up temporary files...');
      unlinkSync(inputPath);
      unlinkSync(outputPath);
    } catch (e) {
      // Ignore cleanup errors
      logVoiceProfile('Error cleaning up temp files (non-fatal):', e);
    }
  }
}

/**
 * Creates a voice profile for a user during enrollment
 *
 * @param userId - The user ID
 * @param audioBuffer - The audio buffer from voice enrollment
 */
export async function createUserVoiceProfile(
  userId: number,
  audioBuffer: Buffer,
): Promise<EnrollmentResult> {
  logVoiceProfile(
    `Creating voice profile for user ${userId}, audio buffer size: ${audioBuffer.length} bytes`,
  );

  try {
    // Create a profile in Azure
    logVoiceProfile('Sending audio to Azure to create profile...');
    const profileResponse = await createVoiceProfile(audioBuffer);
    logVoiceProfile('Profile created successfully', profileResponse);

    // Update user and voice enrollment
    logVoiceProfile('Updating user and voice enrollment records in database...');
    await prisma.$transaction(async (tx) => {
      // Update the voice enrollment
      const enrollmentResult = await tx.voiceEnrollment.updateMany({
        where: {
          userId,
          isActive: true,
        },
        data: {
          voiceProfileId: profileResponse.profileId,
          // Store profile data in a way compatible with the schema
          // This requires the JSON field added to the schema
          isProcessed: true,
          processingStatus: 'ENROLLED',
        },
      });
      logVoiceProfile('Voice enrollment updated:', enrollmentResult);

      // Update the user record
      const userResult = await tx.user.update({
        where: { id: userId },
        data: {
          voiceProfileId: profileResponse.profileId,
          voiceEnrollmentComplete: true,
          voiceEnrollmentDate: new Date(),
        },
      });
      logVoiceProfile('User record updated with profile ID:', {
        profileId: profileResponse.profileId,
        enrollmentComplete: userResult.voiceEnrollmentComplete,
      });
    });

    logVoiceProfile('Profile creation and database updates completed successfully');

    return {
      success: true,
      profileId: profileResponse.profileId,
      enrollmentStatus: profileResponse.enrollmentStatus,
    };
  } catch (error) {
    logVoiceProfile('Error creating user voice profile:', error);

    // Update enrollment to indicate error
    try {
      logVoiceProfile('Updating enrollment to indicate error...');
      await prisma.voiceEnrollment.updateMany({
        where: {
          userId,
          isActive: true,
        },
        data: {
          processingStatus: 'ERROR',
          processingError: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    } catch (dbError) {
      logVoiceProfile('Error updating enrollment status:', dbError);
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Verifies a user's voice against their enrolled profile
 *
 * @param userId - The user ID
 * @param audioBuffer - The audio buffer to verify
 */
export async function verifyUserVoice(
  userId: number,
  audioBuffer: Buffer,
): Promise<VerificationResult> {
  logVoiceProfile(
    `Verifying voice for user ID: ${userId}, buffer size: ${audioBuffer.length} bytes`,
  );

  try {
    // Find the user's voice enrollment
    logVoiceProfile('Looking up user voice enrollment in database...');
    const enrollment = await prisma.voiceEnrollment.findFirst({
      where: {
        userId,
        isActive: true,
        voiceProfileId: { not: null },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!enrollment) {
      logVoiceProfile(`No active voice enrollment found for user ${userId}`);
      return {
        verified: false,
        score: 0,
        threshold: 0.5,
        details: {
          error: 'No voice profile found for verification',
        },
      };
    }

    const { voiceProfileId } = enrollment;
    logVoiceProfile(`Found enrollment with profile ID: ${voiceProfileId}`);

    if (!voiceProfileId) {
      logVoiceProfile('Voice profile ID is null despite query filter');
      return {
        verified: false,
        score: 0,
        threshold: 0.5,
        details: {
          error: 'Voice profile ID is missing',
        },
      };
    }

    // Check if profile exists in Azure before attempting verification
    logVoiceProfile(`Checking if profile ${voiceProfileId} exists in Azure...`);
    const profileCheck = await checkProfileExists(voiceProfileId);
    logVoiceProfile('Profile existence check:', profileCheck);

    if (!profileCheck.exists) {
      logVoiceProfile(`Profile ${voiceProfileId} does not exist in Azure`);
      return {
        verified: false,
        score: 0,
        threshold: 0.5,
        details: {
          error: 'Voice profile not found in Azure',
          azureDetails: profileCheck.details,
        },
      };
    }

    // Convert audio to WAV format for better compatibility with Azure
    logVoiceProfile('Converting audio to WAV format for Azure compatibility...');
    let processedAudioBuffer: Buffer;

    try {
      processedAudioBuffer = await convertAudioToWav(audioBuffer);
      logVoiceProfile(
        `Audio converted: Original size=${audioBuffer.length}, WAV size=${processedAudioBuffer.length}`,
      );
    } catch (conversionError) {
      logVoiceProfile(
        'Audio conversion error, using original format as fallback:',
        conversionError,
      );
      // Fall back to original audio if conversion fails
      processedAudioBuffer = audioBuffer;
    }

    // Try the regular fetch-based verification first
    let result: VoiceVerificationResponse;
    let fetchError: Error | null = null;

    try {
      logVoiceProfile(
        `Attempting verification with fetch implementation for profile ${voiceProfileId}...`,
      );
      result = await verifyVoice(voiceProfileId, processedAudioBuffer);
      logVoiceProfile('Fetch-based verification complete:', result);
    } catch (error) {
      logVoiceProfile('Fetch-based verification failed:', error);
      fetchError = error instanceof Error ? error : new Error(String(error));

      // If fetch fails, try with axios as a fallback
      logVoiceProfile('Trying fallback with axios implementation...');
      try {
        result = await verifyVoiceWithAxios(voiceProfileId, processedAudioBuffer);
        logVoiceProfile('Axios-based verification complete:', result);
      } catch (axiosError) {
        logVoiceProfile('Axios-based verification also failed:', axiosError);
        // Re-throw the original fetch error, as it's more likely to be helpful
        throw fetchError;
      }
    }

    // Log the verification attempt using available fields in the schema
    const logType = result.recognitionResult === 'Accept' ? 'SIGN_IN' : 'SIGN_IN_FAIL';
    logVoiceProfile(`Creating security audit log with type: ${logType}`);

    try {
      await prisma.userSecurityAuditLog.create({
        data: {
          userId,
          type: logType,
          // We can add IP and user agent if available from the request context
          ipAddress: null,
          userAgent: null,
        },
      });
    } catch (logError) {
      logVoiceProfile('Error creating security audit log (non-fatal):', logError);
    }

    // Update last used timestamp
    try {
      logVoiceProfile('Updating enrollment last used timestamp');
      await prisma.voiceEnrollment.updateMany({
        where: {
          userId,
          voiceProfileId: voiceProfileId,
          isActive: true,
        },
        data: {
          lastUsedAt: new Date(),
        },
      });
    } catch (updateError) {
      logVoiceProfile('Error updating last used timestamp (non-fatal):', updateError);
    }

    // Apply a threshold to determine if verified
    const isVerified = result.recognitionResult === 'Accept';
    const threshold = 0.5; // Define appropriate threshold
    logVoiceProfile(
      `Verification result: ${isVerified ? 'ACCEPT' : 'REJECT'}, Score: ${result.score}, Threshold: ${threshold}`,
    );

    return {
      verified: isVerified,
      score: result.score,
      threshold,
      details: {
        result: result.recognitionResult,
      },
    };
  } catch (error) {
    logVoiceProfile('Error verifying user voice:', error);

    return {
      verified: false,
      score: 0,
      threshold: 0.5,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Re-enrolls a user's voice profile (updates existing profile)
 *
 * @param userId - The user ID
 * @param audioBuffer - New audio for enrollment
 */
export async function reEnrollUserVoice(
  userId: number,
  audioBuffer: Buffer,
): Promise<EnrollmentResult> {
  logVoiceProfile(
    `Re-enrolling voice for user ID: ${userId}, buffer size: ${audioBuffer.length} bytes`,
  );

  try {
    // Check if user already has a profile
    logVoiceProfile('Checking if user already has a profile...');
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        voiceProfileId: true,
      },
    });

    if (!user) {
      logVoiceProfile(`User ${userId} not found`);
      return {
        success: false,
        error: 'User not found',
      };
    }

    // If user has existing profile, delete it first
    if (user.voiceProfileId) {
      logVoiceProfile(`Deleting existing voice profile: ${user.voiceProfileId}`);
      await deleteVoiceProfile(user.voiceProfileId).catch((err) => {
        // Log error but continue
        logVoiceProfile(`Error deleting existing voice profile: ${err.message}`);
      });
    }

    // Create a new profile
    logVoiceProfile('Creating new voice profile...');
    return await createUserVoiceProfile(userId, audioBuffer);
  } catch (error) {
    logVoiceProfile('Error re-enrolling user voice:', error);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Performs a long enrollment session with multiple audio samples to ensure complete enrollment
 * This is useful when profiles are stuck in the "Enrolling" state
 *
 * @param userId - The user ID
 * @param audioBuffers - Array of audio buffers to use for enrollment
 */
export async function performLongEnrollment(
  userId: number,
  audioBuffers: Buffer[],
): Promise<EnrollmentResult> {
  logVoiceProfile(
    `Starting long enrollment for user ${userId} with ${audioBuffers.length} audio samples`,
  );

  if (!audioBuffers.length) {
    return {
      success: false,
      error: 'No audio samples provided for enrollment',
    };
  }

  try {
    // Find existing user profile
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, voiceProfileId: true },
    });

    if (!user) {
      logVoiceProfile(`User ${userId} not found`);
      return { success: false, error: 'User not found' };
    }

    let profileId: string | null | undefined = user.voiceProfileId;
    let enrollmentStatus = 'Enrolling';
    let remainingTime = 20; // Default assumption

    // If no profile exists yet, create one with the first buffer
    if (!profileId) {
      logVoiceProfile('No existing profile, creating new one');
      const createResult = await createUserVoiceProfile(userId, audioBuffers[0]);

      if (!createResult.success) {
        logVoiceProfile('Failed to create initial profile', createResult);
        return createResult;
      }

      profileId = createResult.profileId || null;
      enrollmentStatus = createResult.enrollmentStatus || 'Enrolling';
    } else {
      // Check existing profile status
      logVoiceProfile(`Checking existing profile ${profileId}`);
      const profileCheck = await checkProfileExists(profileId);

      if (profileCheck.exists) {
        // Extract enrollment status if available
        const statusMatch = profileCheck.details?.match(/status: ([A-Za-z]+)/);
        if (statusMatch && statusMatch[1]) {
          enrollmentStatus = statusMatch[1];
        }

        // Extract remaining time if available
        const remainingMatch = profileCheck.details?.match(
          /remainingEnrollmentsSpeechLength: ([0-9.]+)/,
        );
        if (remainingMatch && remainingMatch[1]) {
          remainingTime = parseFloat(remainingMatch[1]);
        }
      } else {
        // If profile doesn't exist in Azure but is in our DB, create a new one
        logVoiceProfile(`Profile ${profileId} not found in Azure, creating new one`);
        const createResult = await createUserVoiceProfile(userId, audioBuffers[0]);

        if (!createResult.success) {
          return createResult;
        }

        profileId = createResult.profileId || null;
        enrollmentStatus = createResult.enrollmentStatus || 'Enrolling';
      }
    }

    // If already enrolled, just return success
    if (enrollmentStatus === 'Enrolled') {
      logVoiceProfile(`Profile ${profileId} is already fully enrolled`);
      return {
        success: true,
        profileId: profileId || undefined,
        enrollmentStatus,
      };
    }

    // Process the remaining audio buffers for enrollment
    logVoiceProfile(`Enrolling with ${audioBuffers.length - 1} additional audio samples`);

    const { speechKey, speechRegion } = getAzureCredentials();
    if (!speechKey || !profileId) {
      return {
        success: false,
        error: 'Missing Azure credentials or profile ID',
      };
    }

    // Enroll each additional audio buffer
    for (let i = 1; i < audioBuffers.length; i++) {
      try {
        logVoiceProfile(`Enrolling with audio sample ${i + 1}/${audioBuffers.length}`);

        // Convert audio for better compatibility
        let processedBuffer: Buffer;
        try {
          processedBuffer = await convertAudioToWav(audioBuffers[i]);
        } catch (e) {
          logVoiceProfile(`Conversion failed, using original format for sample ${i + 1}`, e);
          processedBuffer = audioBuffers[i];
        }

        // Enroll the audio
        const enrollmentUrl = `https://${speechRegion}.api.cognitive.microsoft.com/speaker/verification/v2.0/text-independent/profiles/${profileId}/enrollments`;

        const enrollResponse = await fetch(enrollmentUrl, {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': speechKey,
            'Content-Type': 'audio/wav',
          },
          body: processedBuffer,
        });

        if (!enrollResponse.ok) {
          const errorText = await enrollResponse.text().catch(() => 'Unknown error');
          logVoiceProfile(
            `Enrollment failed for sample ${i + 1}: ${enrollResponse.status}`,
            errorText,
          );
          continue; // Try the next sample
        }

        const enrollData = await enrollResponse.json();
        logVoiceProfile(`Enrollment success for sample ${i + 1}`, enrollData);

        // Update status information
        enrollmentStatus = enrollData.enrollmentStatus || enrollmentStatus;
        if (enrollData.remainingEnrollmentsSpeechLength !== undefined) {
          remainingTime = enrollData.remainingEnrollmentsSpeechLength;
        }

        // If enrollment is complete, break the loop
        if (enrollmentStatus === 'Enrolled') {
          logVoiceProfile('Enrollment completed successfully!');
          break;
        }
      } catch (err) {
        logVoiceProfile(`Error processing audio sample ${i + 1}`, err);
        // Continue with next sample even if this one failed
      }
    }

    // Update user record with final status
    await prisma.user.update({
      where: { id: userId },
      data: {
        voiceProfileId: profileId,
        voiceEnrollmentComplete: enrollmentStatus === 'Enrolled',
        voiceEnrollmentDate: new Date(),
      },
    });

    await prisma.voiceEnrollment.updateMany({
      where: {
        userId,
        isActive: true,
      },
      data: {
        voiceProfileId: profileId,
        isProcessed: true,
        processingStatus: enrollmentStatus === 'Enrolled' ? 'ENROLLED' : 'ENROLLING',
      },
    });

    return {
      success: true,
      profileId: profileId || undefined,
      enrollmentStatus,
      error:
        enrollmentStatus !== 'Enrolled'
          ? `Enrollment still incomplete. Remaining speech needed: ${remainingTime} seconds`
          : undefined,
    };
  } catch (error) {
    logVoiceProfile('Error in long enrollment process', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during long enrollment',
    };
  }
}
