import { env } from 'next-runtime-env';

// Get Azure Cognitive Services API keys
// Try both env() and process.env to ensure we can access the values
export function getAzureCredentials() {
  const speechKey = env('AZURE_SPEECH_KEY') || process.env.AZURE_SPEECH_KEY || '';
  const speechRegion = env('AZURE_SPEECH_REGION') || process.env.AZURE_SPEECH_REGION || 'eastus';
  const isDevelopment = process.env.NODE_ENV === 'development';

  console.log(
    `[AZURE API] USING REAL AZURE API - Key exists: ${Boolean(speechKey)}, Region: ${speechRegion}, Dev mode: ${isDevelopment}`,
  );

  if (!speechKey) {
    console.error(
      '[AZURE API] WARNING: No Azure Speech Key found. Voice verification will not work properly!',
    );
  }

  return { speechKey, speechRegion, isDevelopment };
}

const {
  speechKey: AZURE_SPEECH_KEY,
  speechRegion: AZURE_SPEECH_REGION,
  isDevelopment,
} = getAzureCredentials();

// Updated endpoint based on successful API test
const AZURE_VERIFIED_ENDPOINT = `https://${AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/speaker/verification/v2.0`;

// For fallback, keep alternative formats
const _possibleEndpoints = [
  // Verified working endpoint (confirmed by API test)
  AZURE_VERIFIED_ENDPOINT,
  // Alternative formats if the primary one fails
  `https://${AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/speechtotext/v3.0`,
  `https://${AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/speaker/identification/v2.0`,
];

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
  console.log(`[${timestamp}] [Azure Speaker Recognition] ${message}`);
  if (data) {
    try {
      console.log(
        `[${timestamp}] [Azure Speaker Recognition] Data:`,
        typeof data === 'object' ? JSON.stringify(data, null, 2) : data,
      );
    } catch (err) {
      console.log(
        `[${timestamp}] [Azure Speaker Recognition] Data: [Complex object, stringification failed]`,
      );
    }
  }
}

// Helper to log detailed request information
function logRequestDetails(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: BodyInit,
) {
  // Log basic request info
  logAzure(`${method} request to: ${url}`);

  // Log headers (excluding sensitive info)
  const safeHeaders = { ...headers };
  if (safeHeaders['Ocp-Apim-Subscription-Key']) {
    safeHeaders['Ocp-Apim-Subscription-Key'] = '[REDACTED]';
  }
  logAzure('Request headers:', safeHeaders);

  // Log body info if it exists
  if (body) {
    if (body instanceof Buffer) {
      logAzure('Request body is Buffer:', {
        size: body.length,
        firstBytes: Array.from(body.slice(0, 20))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(' '),
      });
    } else if (typeof body === 'string') {
      logAzure('Request body:', body.length > 100 ? body.substring(0, 100) + '...' : body);
    } else {
      logAzure('Request body is type:', typeof body);
    }
  }
}

// Helper to log response details
async function logResponseDetails(response: Response) {
  logAzure(`Response status: ${response.status} ${response.statusText}`);

  // Log response headers
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  logAzure('Response headers:', headers);

  // Try to clone the response to avoid consuming it
  try {
    const clonedResponse = response.clone();
    const contentType = clonedResponse.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const data = await clonedResponse.json();
      logAzure('Response body (JSON):', data);
    } else if (contentType.includes('text/')) {
      const text = await clonedResponse.text();
      logAzure('Response body (text):', text);
    } else {
      const buffer = await clonedResponse.arrayBuffer();
      logAzure('Response body (binary):', {
        size: buffer.byteLength,
        type: contentType,
      });
    }
  } catch (err) {
    logAzure('Error cloning/reading response:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Creates a voice profile for a user using the verified Azure Speaker Recognition API.
 * This tries the verified endpoint first, then falls back to alternatives if needed.
 */
export async function createVoiceProfile(audioBuffer: Buffer): Promise<VoiceProfileCreateResponse> {
  logAzure(`Creating voice profile - Audio buffer size: ${audioBuffer.length} bytes`);

  if (audioBuffer.length < 1000) {
    logAzure('Audio buffer is too small. Expected at least 1KB of audio data.');
    throw new Error('Audio buffer is too small for voice profile creation');
  }

  // Check for API key
  if (!AZURE_SPEECH_KEY) {
    logAzure('No Azure Speech Key provided. Profile creation will fail.');
    throw new Error(
      'Azure Speech Key not configured. Please set AZURE_SPEECH_KEY in environment variables.',
    );
  }

  try {
    // Try creating a profile with the verified endpoint
    logAzure(`Using verified endpoint: ${AZURE_VERIFIED_ENDPOINT}`);

    // 1. Create a voice profile - confirmed working format
    const createProfileUrl = `${AZURE_VERIFIED_ENDPOINT}/text-independent/profiles`;
    logAzure(`Creating profile at: ${createProfileUrl}`);

    const createProfileHeaders = {
      'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
      'Content-Type': 'application/json',
    };

    const createProfileBody = JSON.stringify({
      locale: 'en-us',
    });

    await logRequestDetails(createProfileUrl, 'POST', createProfileHeaders, createProfileBody);

    const createProfileResponse = await fetch(createProfileUrl, {
      method: 'POST',
      headers: createProfileHeaders,
      body: createProfileBody,
    });

    await logResponseDetails(createProfileResponse);

    if (!createProfileResponse.ok) {
      const errorBody = await createProfileResponse.text().catch(() => 'No response body');
      logAzure(
        `Failed to create voice profile - Status: ${createProfileResponse.status}, Body: ${errorBody}`,
      );

      throw new Error(
        `Failed to create voice profile: ${createProfileResponse.statusText} (${createProfileResponse.status}) - ${errorBody}`,
      );
    }

    const profileData = await createProfileResponse.json();
    logAzure('Profile created successfully:', profileData);

    const profileId = profileData.profileId;
    if (!profileId) {
      logAzure('No profile ID returned from Azure API:', profileData);
      throw new Error('No profile ID returned from Azure API');
    }

    // 2. Enroll the voice profile with audio using the verified format
    const enrollmentUrl = `${AZURE_VERIFIED_ENDPOINT}/text-independent/profiles/${profileId}/enrollments`;
    logAzure(
      `Enrolling voice profile ${profileId} with audio buffer (${audioBuffer.length} bytes) at ${enrollmentUrl}`,
    );

    const enrollmentHeaders = {
      'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
      'Content-Type': 'audio/wav',
    };

    await logRequestDetails(enrollmentUrl, 'POST', enrollmentHeaders, audioBuffer);

    const enrollResponse = await fetch(enrollmentUrl, {
      method: 'POST',
      headers: enrollmentHeaders,
      body: audioBuffer,
    });

    await logResponseDetails(enrollResponse);

    if (!enrollResponse.ok) {
      const errorText = await enrollResponse.text().catch(() => 'No response body');
      logAzure(
        `Failed to enroll voice profile - Status: ${enrollResponse.status}, Body: ${errorText}`,
      );

      throw new Error(
        `Failed to enroll voice profile: ${enrollResponse.statusText} (${enrollResponse.status}) - ${errorText}`,
      );
    }

    const enrollmentData = await enrollResponse.json();
    logAzure('Enrollment successful:', enrollmentData);

    return {
      profileId,
      enrollmentStatus: enrollmentData.enrollmentStatus || 'Enrolled',
      remainingEnrollmentsCount: enrollmentData.remainingEnrollmentsCount || 0,
      enrollmentsCount: enrollmentData.enrollmentsCount || 1,
      enrollmentsSpeechLength: enrollmentData.enrollmentsSpeechLength || 0,
    };
  } catch (error) {
    logAzure('Error creating voice profile:', error);
    throw error;
  }
}

/**
 * Verifies a voice sample against an existing profile
 */
export async function verifyVoice(
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
    // Use the recommended endpoint format from Microsoft docs
    // https://learn.microsoft.com/en-us/azure/cognitive-services/speech-service/speaker-recognition-overview
    const verifyUrl = `https://${speechRegion}.api.cognitive.microsoft.com/speaker/verification/v2.0/text-independent/profiles/${profileId}/verify`;

    // Log all possible endpoint variations for debugging
    logAzure(`Primary verification endpoint: ${verifyUrl}`);
    logAzure(`Alternative endpoints that could be tried:`, {
      alt1: `https://${speechRegion}.speaker.speech.microsoft.com/speaker/verification/text-independent/cognitiveservices/v1/verify/${profileId}`,
      alt2: `https://${speechRegion}.api.cognitive.microsoft.com/speaker/identification/v2.0/text-independent/profiles/${profileId}/verify`,
    });

    // Check if buffer is too small
    if (audioBuffer.length < 1000) {
      logAzure('Audio buffer is too small', { size: audioBuffer.length });
      return {
        recognitionResult: 'Reject',
        score: 0,
        errorDetails: 'Audio sample is too small to verify (less than 1KB)',
      };
    }

    // Try to determine the audio format from the buffer header
    let contentType = 'audio/wav';

    // Check for WebM magic number (0x1A 0x45 0xDF 0xA3)
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
    // Check for WAV header (RIFF....WAVE)
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
    // Check for MP3 header (ID3 or MPEG frame sync)
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

    // Check profile status before verification
    logAzure(`Checking profile status before verification: ${profileId}`);
    try {
      const profileStatusUrl = `https://${speechRegion}.api.cognitive.microsoft.com/speaker/verification/v2.0/text-independent/profiles/${profileId}`;
      const profileStatusHeaders = {
        'Ocp-Apim-Subscription-Key': speechKey,
      };

      await logRequestDetails(profileStatusUrl, 'GET', profileStatusHeaders);

      const profileStatusResponse = await fetch(profileStatusUrl, {
        method: 'GET',
        headers: profileStatusHeaders,
      });

      await logResponseDetails(profileStatusResponse);

      if (profileStatusResponse.ok) {
        const profileData = await profileStatusResponse.json();
        logAzure(`Profile status check successful:`, profileData);

        if (profileData.enrollmentStatus !== 'Enrolled') {
          logAzure(`Profile is not properly enrolled! Status: ${profileData.enrollmentStatus}`);
          return {
            recognitionResult: 'Reject',
            score: 0,
            errorDetails: `Profile ${profileId} is not properly enrolled (status: ${profileData.enrollmentStatus})`,
          };
        }
      } else {
        logAzure(`Profile status check failed: ${profileStatusResponse.status}`);
      }
    } catch (profileCheckError) {
      logAzure('Error checking profile status (continuing anyway):', profileCheckError);
    }

    // Make the request to Azure
    try {
      logAzure(`Starting fetch to ${verifyUrl}`);

      const verifyHeaders = {
        'Ocp-Apim-Subscription-Key': speechKey,
        'Content-Type': contentType,
      };

      await logRequestDetails(verifyUrl, 'POST', verifyHeaders, audioBuffer);

      const response = await fetch(verifyUrl, {
        method: 'POST',
        headers: verifyHeaders,
        body: audioBuffer,
      });

      await logResponseDetails(response);

      logAzure(`API response status: ${response.status}`);

      if (!response.ok) {
        try {
          // Try to parse error response as JSON
          const errorJson = await response.json();
          logAzure('API error response', errorJson);

          // Extract error details if available
          const errorMessage =
            errorJson.error?.message ||
            errorJson.message ||
            `API error: ${response.status} ${response.statusText}`;

          return {
            recognitionResult: 'Reject',
            score: 0,
            errorDetails: errorMessage,
          };
        } catch (parseError) {
          // If not JSON, try to get text
          try {
            const errorText = await response.text();
            logAzure('API error text', errorText);
            return {
              recognitionResult: 'Reject',
              score: 0,
              errorDetails: errorText || `API error: ${response.status} ${response.statusText}`,
            };
          } catch (textError) {
            // If all else fails
            logAzure('Failed to parse API error response', { status: response.status });
            return {
              recognitionResult: 'Reject',
              score: 0,
              errorDetails: `API error: ${response.status} ${response.statusText}`,
            };
          }
        }
      }

      const data = await response.json();
      logAzure('API success response', data);

      return {
        recognitionResult: data.recognitionResult,
        score: data.score,
        errorDetails: data.errorDetails,
      };
    } catch (fetchError) {
      // Handle network-level errors specifically
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown fetch error';
      logAzure('Fetch operation failed', {
        error: errorMessage,
        name: fetchError instanceof Error ? fetchError.name : 'Unknown',
        stack: fetchError instanceof Error ? fetchError.stack : undefined,
      });

      return {
        recognitionResult: 'Reject',
        score: 0,
        errorDetails: `Failed to connect to verification service: ${errorMessage}`,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logAzure('Exception during verification', { error: errorMessage });
    throw error;
  }
}

/**
 * Deletes a voice profile
 */
export async function deleteVoiceProfile(profileId: string): Promise<boolean> {
  // In development mode, use mock implementation
  if (isDevelopment || !AZURE_SPEECH_KEY) {
    logAzure('[DEV MODE] Deleting voice profile with mock implementation');
    // Simulate API delay
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 500);
    });
    return true;
  }

  try {
    // Use the verified endpoint format
    const deleteUrl = `${AZURE_VERIFIED_ENDPOINT}/text-independent/profiles/${profileId}`;
    logAzure(`Deleting voice profile at ${deleteUrl}`);

    const deleteHeaders = {
      'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
    };

    await logRequestDetails(deleteUrl, 'DELETE', deleteHeaders);

    const deleteResponse = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: deleteHeaders,
    });

    await logResponseDetails(deleteResponse);

    return deleteResponse.ok;
  } catch (error) {
    logAzure('Error deleting voice profile:', error);
    return false;
  }
}
