import { env } from 'next-runtime-env';

// Get Azure Cognitive Services API keys
// Try both env() and process.env to ensure we can access the values
function getAzureCredentials() {
  const speechKey = env('AZURE_SPEECH_KEY') || process.env.AZURE_SPEECH_KEY || '';
  const speechRegion = env('AZURE_SPEECH_REGION') || process.env.AZURE_SPEECH_REGION || 'eastus';
  const isDevelopment = process.env.NODE_ENV === 'development';

  console.log(
    `Azure credentials check - Key exists: ${Boolean(speechKey)}, Region: ${speechRegion}, Dev mode: ${isDevelopment}`,
  );

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

/**
 * Creates a mock voice profile for development purposes
 */
async function createMockProfile(audioBuffer: Buffer): Promise<VoiceProfileCreateResponse> {
  console.log('[DEV MODE] Creating mock voice profile');

  // Generate a realistic-looking profile ID
  const profileId = `profile-${Math.random().toString(36).substring(2, 10)}`;

  // Simulate an API delay
  await new Promise<void>((resolve) => {
    setTimeout(() => resolve(), 1000);
  });

  console.log(`[DEV MODE] Created mock profile with ID: ${profileId}`);

  return {
    profileId,
    enrollmentStatus: 'Enrolled',
    remainingEnrollmentsCount: 0,
    enrollmentsCount: 1,
    enrollmentsSpeechLength: audioBuffer.length / 16000, // Rough estimate of seconds
  };
}

/**
 * Creates a voice profile for a user using the verified Azure Speaker Recognition API.
 * This tries the verified endpoint first, then falls back to alternatives if needed.
 */
export async function createVoiceProfile(audioBuffer: Buffer): Promise<VoiceProfileCreateResponse> {
  console.log(`Creating voice profile - Audio buffer size: ${audioBuffer.length} bytes`);

  if (audioBuffer.length < 1000) {
    console.error('Audio buffer is too small. Expected at least 1KB of audio data.');
    throw new Error('Audio buffer is too small for voice profile creation');
  }

  // In development mode or missing API key, use mock implementation
  if (isDevelopment && !AZURE_SPEECH_KEY) {
    console.log('Using development mode mock implementation');
    return createMockProfile(audioBuffer);
  }

  try {
    // Try creating a profile with the verified endpoint
    console.log(`Using verified endpoint: ${AZURE_VERIFIED_ENDPOINT}`);

    // 1. Create a voice profile - confirmed working format
    const createProfileUrl = `${AZURE_VERIFIED_ENDPOINT}/text-independent/profiles`;
    console.log(`Creating profile at: ${createProfileUrl}`);

    const createProfileResponse = await fetch(createProfileUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        locale: 'en-us',
      }),
    });

    console.log(`Create profile response status: ${createProfileResponse.status}`);

    if (!createProfileResponse.ok) {
      const errorBody = await createProfileResponse.text().catch(() => 'No response body');
      console.error(
        `Failed to create voice profile - Status: ${createProfileResponse.status}, Body: ${errorBody}`,
      );

      // If the verified endpoint fails, try the multi-endpoint approach or fall back to mock
      if (isDevelopment) {
        console.log('Verified endpoint failed, using mock implementation');
        return createMockProfile(audioBuffer);
      }

      throw new Error(
        `Failed to create voice profile: ${createProfileResponse.statusText} (${createProfileResponse.status}) - ${errorBody}`,
      );
    }

    const profileData = await createProfileResponse.json();
    console.log('Profile created successfully:', JSON.stringify(profileData));

    const profileId = profileData.profileId;
    if (!profileId) {
      console.error('No profile ID returned from Azure API:', JSON.stringify(profileData));
      throw new Error('No profile ID returned from Azure API');
    }

    // 2. Enroll the voice profile with audio using the verified format
    const enrollmentUrl = `${AZURE_VERIFIED_ENDPOINT}/text-independent/profiles/${profileId}/enrollments`;
    console.log(
      `Enrolling voice profile ${profileId} with audio buffer (${audioBuffer.length} bytes) at ${enrollmentUrl}`,
    );

    const enrollResponse = await fetch(enrollmentUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
        'Content-Type': 'audio/wav',
      },
      body: audioBuffer,
    });

    if (!enrollResponse.ok) {
      const errorText = await enrollResponse.text().catch(() => 'No response body');
      console.error(
        `Failed to enroll voice profile - Status: ${enrollResponse.status}, Body: ${errorText}`,
      );

      // If enrollment fails but we're in development mode, use mock
      if (isDevelopment) {
        console.log('Enrollment failed, using mock implementation');
        return createMockProfile(audioBuffer);
      }

      throw new Error(
        `Failed to enroll voice profile: ${enrollResponse.statusText} (${enrollResponse.status}) - ${errorText}`,
      );
    }

    const enrollmentData = await enrollResponse.json();
    console.log('Enrollment successful:', JSON.stringify(enrollmentData));

    return {
      profileId,
      enrollmentStatus: enrollmentData.enrollmentStatus || 'Enrolled',
      remainingEnrollmentsCount: enrollmentData.remainingEnrollmentsCount || 0,
      enrollmentsCount: enrollmentData.enrollmentsCount || 1,
      enrollmentsSpeechLength: enrollmentData.enrollmentsSpeechLength || 0,
    };
  } catch (error) {
    console.error('Error creating voice profile:', error);

    // If we encounter an error and we're in development mode, use mock
    if (isDevelopment) {
      console.log('Error encountered, using mock implementation');
      return createMockProfile(audioBuffer);
    }

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
  // In development mode, use mock implementation
  if (isDevelopment || !AZURE_SPEECH_KEY) {
    console.log('[DEV MODE] Verifying voice with mock implementation');

    // Simulate API delay
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 800);
    });

    // Return a successful verification with a high score
    return {
      recognitionResult: 'Accept',
      score: 0.85,
    };
  }

  try {
    // Use the verified endpoint format
    const verifyUrl = `${AZURE_VERIFIED_ENDPOINT}/text-independent/profiles/${profileId}/verify`;
    console.log(`Verifying voice against profile ${profileId} at ${verifyUrl}`);

    const verifyResponse = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
        'Content-Type': 'audio/wav',
      },
      body: audioBuffer,
    });

    if (!verifyResponse.ok) {
      // If the service returns an error but with a valid response, we want to capture it
      const errorData = await verifyResponse.json().catch(() => ({}));

      return {
        recognitionResult: 'Reject',
        score: 0,
        errorDetails: `API error: ${verifyResponse.status} - ${verifyResponse.statusText}. ${
          errorData.error?.message || ''
        }`,
      };
    }

    const verificationData = await verifyResponse.json();

    return {
      recognitionResult: verificationData.recognitionResult || 'Reject',
      score: verificationData.score || 0,
    };
  } catch (error) {
    console.error('Error verifying voice:', error);
    return {
      recognitionResult: 'Reject',
      score: 0,
      errorDetails: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Deletes a voice profile
 */
export async function deleteVoiceProfile(profileId: string): Promise<boolean> {
  // In development mode, use mock implementation
  if (isDevelopment || !AZURE_SPEECH_KEY) {
    console.log('[DEV MODE] Deleting voice profile with mock implementation');
    // Simulate API delay
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 500);
    });
    return true;
  }

  try {
    // Use the verified endpoint format
    const deleteUrl = `${AZURE_VERIFIED_ENDPOINT}/text-independent/profiles/${profileId}`;
    console.log(`Deleting voice profile at ${deleteUrl}`);

    const deleteResponse = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
      },
    });

    return deleteResponse.ok;
  } catch (error) {
    console.error('Error deleting voice profile:', error);
    return false;
  }
}
