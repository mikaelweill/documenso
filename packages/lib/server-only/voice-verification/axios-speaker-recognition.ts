import type { AxiosError } from 'axios';
import axios from 'axios';
import { env } from 'next-runtime-env';

/**
 * Alternative implementation using Axios instead of fetch
 * This might help resolve the "fetch failed" errors
 */

// Get Azure Cognitive Services API keys
// Try both env() and process.env to ensure we can access the values
export function getAzureCredentials() {
  const speechKey = env('AZURE_SPEECH_KEY') || process.env.AZURE_SPEECH_KEY || '';
  const speechRegion = env('AZURE_SPEECH_REGION') || process.env.AZURE_SPEECH_REGION || 'eastus';
  const isDevelopment = process.env.NODE_ENV === 'development';

  console.log(
    `[AZURE AXIOS] USING REAL AZURE API - Key exists: ${Boolean(speechKey)}, Region: ${speechRegion}, Dev mode: ${isDevelopment}`,
  );

  if (!speechKey) {
    console.error(
      '[AZURE AXIOS] WARNING: No Azure Speech Key found. Voice verification will not work properly!',
    );
  }

  return { speechKey, speechRegion, isDevelopment };
}

// Type definitions
export interface VoiceProfileCreateResponse {
  profileId: string;
  enrollmentStatus: 'Enrolled' | 'Enrolling' | 'Training';
  remainingEnrollmentsCount: number;
  enrollmentsCount: number;
  enrollmentsSpeechLength: number;
}

export interface VoiceVerificationResponse {
  recognitionResult: 'Accept' | 'Reject';
  score: number; // Score between 0 and 1
  errorDetails?: string;
}

// Add a logging function
function logAzure(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [Azure Axios Client] ${message}`);
  if (data) {
    console.log(
      `[${timestamp}] [Azure Axios Client] Data:`,
      typeof data === 'object' ? JSON.stringify(data, null, 2) : data,
    );
  }
}

/**
 * Verifies a voice sample against an existing profile using Axios
 */
export async function verifyVoiceWithAxios(
  profileId: string,
  audioBuffer: Buffer,
): Promise<VoiceVerificationResponse> {
  const { speechKey, speechRegion } = getAzureCredentials();
  if (!speechKey || !speechRegion) {
    logAzure('Missing Azure credentials');
    throw new Error('Azure credentials not configured');
  }

  // Log buffer info to help diagnose issues
  logAzure(`Verifying voice with profile: ${profileId}`, {
    bufferSize: audioBuffer.length,
    bufferStartHex:
      audioBuffer.length > 20
        ? Array.from(audioBuffer.subarray(0, 20))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(' ')
        : 'buffer too small',
  });

  try {
    // Try all possible endpoint formats
    const endpoints = [
      // Primary endpoint - from official docs
      `https://${speechRegion}.api.cognitive.microsoft.com/speaker/verification/v2.0/text-independent/profiles/${profileId}/verify`,
      // Alternative endpoints
      `https://${speechRegion}.speaker.speech.microsoft.com/speaker/verification/text-independent/cognitiveservices/v1/verify/${profileId}`,
      `https://${speechRegion}.api.cognitive.microsoft.com/speaker/identification/v2.0/text-independent/profiles/${profileId}/verify`,
    ];

    logAzure('Will try verification at the following endpoints:');
    endpoints.forEach((ep, i) => logAzure(`Endpoint ${i + 1}: ${ep}`));

    // Detect audio format from buffer
    let contentType = 'audio/wav';

    // Check for WebM magic number
    if (
      audioBuffer.length > 4 &&
      audioBuffer[0] === 0x1a &&
      audioBuffer[1] === 0x45 &&
      audioBuffer[2] === 0xdf &&
      audioBuffer[3] === 0xa3
    ) {
      logAzure('Detected WebM format from magic number');
      contentType = 'audio/webm';
    }
    // Check for WAV header
    else if (
      audioBuffer.length > 12 &&
      audioBuffer[0] === 0x52 && // R
      audioBuffer[1] === 0x49 && // I
      audioBuffer[2] === 0x46 && // F
      audioBuffer[3] === 0x46 && // F
      audioBuffer[8] === 0x57 && // W
      audioBuffer[9] === 0x41 && // A
      audioBuffer[10] === 0x56 && // V
      audioBuffer[11] === 0x45
    ) {
      // E
      logAzure('Detected WAV format from header');
      contentType = 'audio/wav';
    }
    // Check for MP3 header
    else if (
      audioBuffer.length > 3 &&
      ((audioBuffer[0] === 0x49 && // I
        audioBuffer[1] === 0x44 && // D
        audioBuffer[2] === 0x33) || // 3
        (audioBuffer[0] === 0xff && (audioBuffer[1] & 0xe0) === 0xe0))
    ) {
      logAzure('Detected MP3 format from header');
      contentType = 'audio/mpeg';
    }

    logAzure(`Using content type: ${contentType}`);

    // Try each endpoint in sequence
    let lastError: AxiosError | Error | null = null;

    for (const url of endpoints) {
      try {
        logAzure(`Trying endpoint: ${url}`);

        // Log the full request details (redact key)
        logAzure('Sending verification request with details:', {
          method: 'POST',
          url: url,
          headers: {
            'Ocp-Apim-Subscription-Key': '[REDACTED]',
            'Content-Type': contentType,
          },
          dataSize: audioBuffer.length,
          timeout: 30000,
        });

        // Start timer for diagnostics
        const startTime = Date.now();

        const response = await axios({
          method: 'POST',
          url: url,
          headers: {
            'Ocp-Apim-Subscription-Key': speechKey,
            'Content-Type': contentType,
          },
          data: audioBuffer,
          timeout: 30000, // 30 second timeout
          maxContentLength: Infinity, // No size limit
          maxBodyLength: Infinity, // No size limit
        });

        const duration = Date.now() - startTime;
        logAzure(`Verification completed in ${duration}ms with status: ${response.status}`);

        // If we got here, it worked!
        return {
          recognitionResult: response.data.recognitionResult,
          score: response.data.score || 0,
          errorDetails: response.data.errorDetails,
        };
      } catch (err) {
        const error = err as AxiosError;
        lastError = error;
        logAzure(`Endpoint ${url} failed:`, {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          message: error.message,
        });

        // Continue to next endpoint
        logAzure('Trying next endpoint...');
      }
    }

    // If we get here, all endpoints failed
    logAzure('All endpoints failed!');

    // Extract error details from last error
    let errorDetails = 'Unknown error occurred during verification';

    if (lastError) {
      if (isAxiosError(lastError) && lastError.response?.data) {
        const responseData = lastError.response.data;
        errorDetails =
          typeof responseData === 'object' ? JSON.stringify(responseData) : String(responseData);
      } else if (lastError.message) {
        errorDetails = lastError.message;
      }
    }

    return {
      recognitionResult: 'Reject',
      score: 0,
      errorDetails: `All endpoints failed: ${errorDetails}`,
    };
  } catch (err) {
    // This catches any errors outside the endpoint loop
    const error = err as Error;
    logAzure('Unhandled exception in verification:', {
      message: error.message,
      stack: error.stack,
    });

    return {
      recognitionResult: 'Reject',
      score: 0,
      errorDetails: `Exception: ${error.message || 'Unknown error'}`,
    };
  }
}

// Type guard to check if an error is an AxiosError
function isAxiosError(error: unknown): error is AxiosError {
  return (
    error !== null &&
    typeof error === 'object' &&
    'isAxiosError' in error &&
    (error as AxiosError).isAxiosError === true
  );
}
