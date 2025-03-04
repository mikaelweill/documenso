#!/usr/bin/env node

/**
 * Test Script for Azure Speaker Recognition
 *
 * This script tests direct communication with Azure's Speaker Recognition service
 * to help isolate "fetch failed" errors in voice verification.
 *
 * Usage:
 * 1. Place a test WAV file in the same directory or specify path
 * 2. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION environment variables
 * 3. Run: node test-azure-voice.js [optional-profile-id]
 *
 * Enhanced logging for detailed diagnostics:
 * - HTTP request/response headers
 * - Profile enrollment status verification
 * - Audio format validation
 * - Binary data inspection
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios'); // You might need to install: npm install axios
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

// Helper for logging with timestamps
function logWithTime(message, data) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data) {
    if (typeof data === 'object') {
      console.log(`[${timestamp}] Data:`, JSON.stringify(data, null, 2));
    } else {
      console.log(`[${timestamp}] Data: ${data}`);
    }
  }
}

// Create a debug-friendly version of axios
const debugAxios = axios.create();

// Add request interceptor for detailed logging
debugAxios.interceptors.request.use((request) => {
  logWithTime(`🔍 REQUEST: ${request.method.toUpperCase()} ${request.url}`);

  // Log headers (redact sensitive info)
  const safeHeaders = { ...request.headers };
  if (safeHeaders['Ocp-Apim-Subscription-Key']) {
    safeHeaders['Ocp-Apim-Subscription-Key'] = '[REDACTED]';
  }

  logWithTime('🔍 Request Headers:', safeHeaders);

  // For binary data, log size and first bytes
  if (request.data instanceof Buffer) {
    const buffer = request.data;
    const bufferInfo = {
      size: buffer.length,
      mimeType: request.headers['Content-Type'],
      firstBytes: Array.from(buffer.slice(0, 32))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' '),
    };
    logWithTime('🔍 Binary Request Body Info:', bufferInfo);

    // Try to detect audio format from buffer
    detectAudioFormat(buffer);
  } else if (request.data) {
    logWithTime('🔍 Request Body:', request.data);
  }

  return request;
});

// Add response interceptor for detailed logging
debugAxios.interceptors.response.use(
  (response) => {
    logWithTime(
      `✅ RESPONSE: ${response.status} ${response.statusText} from ${response.config.url}`,
    );
    logWithTime('✅ Response Headers:', response.headers);

    if (response.data) {
      // Check for binary response
      if (response.data instanceof Buffer) {
        logWithTime('✅ Binary Response (Buffer)', {
          size: response.data.length,
          firstBytes: Array.from(response.data.slice(0, 32))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(' '),
        });
      } else {
        logWithTime('✅ Response Body:', response.data);
      }
    }

    return response;
  },
  (error) => {
    if (error.response) {
      logWithTime(`❌ ERROR RESPONSE: ${error.response.status} from ${error.config.url}`);
      logWithTime('❌ Error Response Headers:', error.response.headers);
      logWithTime('❌ Error Response Body:', error.response.data);
    } else if (error.request) {
      logWithTime('❌ ERROR: No response received', {
        url: error.config.url,
        message: error.message,
      });
    } else {
      logWithTime('❌ ERROR: Request setup failed', error.message);
    }

    return Promise.reject(error);
  },
);

// Helper function to detect audio format from buffer
function detectAudioFormat(buffer) {
  const formats = [];

  // Check for WAV header (RIFF....WAVE)
  if (
    buffer.length > 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x41 &&
    buffer[10] === 0x56 &&
    buffer[11] === 0x45
  ) {
    formats.push('WAV');

    // Extract more WAV info
    try {
      // Get format info from WAV header
      const formatChunk = buffer.indexOf('fmt ', 0, 'ascii');
      if (formatChunk > 0) {
        const audioFormat = buffer.readUInt16LE(formatChunk + 8);
        const numChannels = buffer.readUInt16LE(formatChunk + 10);
        const sampleRate = buffer.readUInt32LE(formatChunk + 12);
        const bitsPerSample = buffer.readUInt16LE(formatChunk + 22);

        logWithTime('🔍 WAV Format Details:', {
          audioFormat: audioFormat === 1 ? 'PCM' : `Other (${audioFormat})`,
          channels: numChannels,
          sampleRate: `${sampleRate} Hz`,
          bitDepth: `${bitsPerSample} bits`,
        });
      }
    } catch (e) {
      logWithTime('Could not parse WAV header details', e.message);
    }
  }

  // Check for WebM magic number
  if (
    buffer.length > 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    formats.push('WebM');
  }

  // Check for MP3 header
  if (
    buffer.length > 3 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) || // ID3
      (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0))
  ) {
    // MPEG frame
    formats.push('MP3');
  }

  // Check for Ogg/Opus
  if (
    buffer.length > 4 &&
    buffer[0] === 0x4f &&
    buffer[1] === 0x67 &&
    buffer[2] === 0x67 &&
    buffer[3] === 0x53
  ) {
    formats.push('Ogg');
    // Check for 'OpusHead' signature
    const opusHead = buffer.indexOf('OpusHead', 0, 'ascii');
    if (opusHead > 0) {
      formats.push('Opus');
    }
  }

  if (formats.length > 0) {
    logWithTime(`🔍 Detected audio format(s): ${formats.join(', ')}`);
  } else {
    logWithTime('🔍 Unknown or unsupported audio format');
  }
}

// Verify if a profile exists and check its enrollment status
async function checkProfileEnrollmentStatus(profileId) {
  const url = `https://${AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/speaker/verification/v2.0/text-independent/profiles/${profileId}`;

  logWithTime(`Checking profile enrollment status: ${profileId}`);

  try {
    const response = await debugAxios({
      method: 'GET',
      url: url,
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
      },
      timeout: 10000,
    });

    logWithTime(`Profile status check successful:`, response.data);
    return {
      exists: true,
      enrolled: response.data.enrollmentStatus === 'Enrolled',
      status: response.data.enrollmentStatus,
      details: response.data,
    };
  } catch (error) {
    if (error.response) {
      logWithTime(
        `Profile status check failed with ${error.response.status}:`,
        error.response.data,
      );
      return {
        exists: error.response.status !== 404,
        enrolled: false,
        status: 'Error',
        error: error.response.data,
      };
    } else {
      logWithTime(`Profile status check error:`, error.message);
      return {
        exists: false,
        enrolled: false,
        status: 'Error',
        error: error.message,
      };
    }
  }
}

// Get Azure credentials from environment
const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION || 'eastus';

if (!AZURE_SPEECH_KEY) {
  console.error('Error: AZURE_SPEECH_KEY environment variable is required');
  console.error('Set it using: export AZURE_SPEECH_KEY=your_key_here');
  process.exit(1);
}

// Test audio file path - you can override this
const TEST_AUDIO_FILE = process.argv[3] || path.join(__dirname, 'test-voice.wav');

// Get profile ID from command line or create a new one
const profileId = process.argv[2];

// Analyze audio file using ffmpeg
async function analyzeAudioFile(filePath) {
  try {
    logWithTime(`Analyzing audio file: ${filePath}`);

    // Run ffprobe to get detailed information
    const { stdout } = await exec(
      `ffprobe -v error -show_entries stream=codec_name,channels,sample_rate,duration -of json "${filePath}"`,
    );
    const info = JSON.parse(stdout);

    logWithTime('Audio file analysis results:', info);
    return info;
  } catch (error) {
    logWithTime('Error analyzing audio file:', error.message);
    return null;
  }
}

// Main function
async function main() {
  try {
    logWithTime(`=== Azure Speaker Recognition Test ===`);
    logWithTime(`Using Azure region: ${AZURE_SPEECH_REGION}`);
    logWithTime(`Key exists: ${Boolean(AZURE_SPEECH_KEY)}`);

    // Check if test audio file exists
    if (!fs.existsSync(TEST_AUDIO_FILE)) {
      logWithTime(`Error: Test audio file not found at: ${TEST_AUDIO_FILE}`);
      logWithTime('Please provide a WAV file for testing');
      process.exit(1);
    }

    const audioBuffer = fs.readFileSync(TEST_AUDIO_FILE);
    logWithTime(`Loaded test audio: ${TEST_AUDIO_FILE} (${audioBuffer.length} bytes)`);

    // Analyze the audio file
    const audioAnalysis = await analyzeAudioFile(TEST_AUDIO_FILE);

    // Create a profile if none provided
    let testProfileId = profileId;
    if (!testProfileId) {
      testProfileId = await createProfile();
      logWithTime(`Created new profile: ${testProfileId}`);

      // Enroll the profile
      await enrollProfile(testProfileId, audioBuffer);
      logWithTime(`Enrolled profile with test audio`);
    } else {
      logWithTime(`Using existing profile: ${testProfileId}`);

      // Verify if the profile exists and check enrollment status
      const profileStatus = await checkProfileEnrollmentStatus(testProfileId);
      logWithTime('Profile status check results:', profileStatus);

      if (!profileStatus.exists) {
        logWithTime('⚠️ WARNING: The specified profile does not exist!');

        // Ask if we should create a new profile
        logWithTime('Creating a new profile instead...');
        testProfileId = await createProfile();
        logWithTime(`Created new profile: ${testProfileId}`);

        // Enroll the new profile
        await enrollProfile(testProfileId, audioBuffer);
        logWithTime(`Enrolled profile with test audio`);
      } else if (!profileStatus.enrolled) {
        logWithTime('⚠️ WARNING: The specified profile exists but is not enrolled!');

        // Enroll the profile
        logWithTime('Enrolling the profile...');
        await enrollProfile(testProfileId, audioBuffer);
        logWithTime(`Enrolled existing profile with test audio`);
      }
    }

    // Verify using the profile
    const verificationResult = await verifyVoice(testProfileId, audioBuffer);
    logWithTime(`Verification completed!`, verificationResult);

    // Clean up if we created a new profile
    if (!profileId) {
      await deleteProfile(testProfileId);
      logWithTime(`Deleted test profile: ${testProfileId}`);
    }
  } catch (error) {
    logWithTime(`Error: ${error.message}`, {
      stack: error.stack,
      response: error.response?.data || 'No response data',
      status: error.response?.status || 'No status code',
    });
  }
}

// Create a voice profile
async function createProfile() {
  const url = `https://${AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/speaker/verification/v2.0/text-independent/profiles`;

  logWithTime(`Creating profile at: ${url}`);

  try {
    const response = await debugAxios({
      method: 'POST',
      url: url,
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
        'Content-Type': 'application/json',
      },
      data: {
        locale: 'en-us',
      },
      timeout: 10000, // 10 second timeout
    });

    return response.data.profileId;
  } catch (error) {
    logWithTime('Profile creation failed', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
    throw new Error(`Failed to create profile: ${error.message}`);
  }
}

// Enroll a profile with audio
async function enrollProfile(profileId, audioBuffer) {
  const url = `https://${AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/speaker/verification/v2.0/text-independent/profiles/${profileId}/enrollments`;

  logWithTime(`Enrolling profile at: ${url}`);

  try {
    const response = await debugAxios({
      method: 'POST',
      url: url,
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
        'Content-Type': 'audio/wav',
      },
      data: audioBuffer,
      timeout: 30000, // 30 second timeout
    });

    return response.data;
  } catch (error) {
    logWithTime('Profile enrollment failed', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
    throw new Error(`Failed to enroll profile: ${error.message}`);
  }
}

// Verify voice against a profile
async function verifyVoice(profileId, audioBuffer) {
  // First, log all the endpoints we're going to try
  const endpoints = [
    `https://${AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/speaker/verification/v2.0/text-independent/profiles/${profileId}/verify`,
    `https://${AZURE_SPEECH_REGION}.speaker.speech.microsoft.com/speaker/verification/text-independent/cognitiveservices/v1/verify/${profileId}`,
    `https://${AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/speaker/identification/v2.0/text-independent/profiles/${profileId}/verify`,
  ];

  logWithTime('Will try verification at the following endpoints:');
  endpoints.forEach((ep, i) => logWithTime(`Endpoint ${i + 1}: ${ep}`));

  // Check profile status before verification
  const profileStatus = await checkProfileEnrollmentStatus(profileId);
  logWithTime('Pre-verification profile status check:', profileStatus);

  if (!profileStatus.exists) {
    throw new Error(`Profile ${profileId} does not exist. Cannot verify.`);
  }

  if (!profileStatus.enrolled) {
    throw new Error(`Profile ${profileId} exists but is not enrolled. Cannot verify.`);
  }

  // Try the first (official) endpoint
  const url = endpoints[0];
  logWithTime(`Verifying voice at primary endpoint: ${url}`);

  try {
    // Start timer for diagnostics
    const startTime = Date.now();

    const response = await debugAxios({
      method: 'POST',
      url: url,
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
        'Content-Type': 'audio/wav',
      },
      data: audioBuffer,
      timeout: 30000, // 30 second timeout
    });

    const duration = Date.now() - startTime;
    logWithTime(`Verification completed in ${duration}ms with status: ${response.status}`);

    return response.data;
  } catch (error) {
    logWithTime('Voice verification failed', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    // If the first endpoint failed, try the alternatives
    logWithTime('First endpoint failed, trying alternatives...');

    // Try the other endpoints
    for (let i = 1; i < endpoints.length; i++) {
      try {
        logWithTime(`Trying alternative endpoint ${i + 1}: ${endpoints[i]}`);

        const response = await debugAxios({
          method: 'POST',
          url: endpoints[i],
          headers: {
            'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
            'Content-Type': 'audio/wav',
          },
          data: audioBuffer,
          timeout: 30000,
        });

        logWithTime(`Alternative endpoint ${i + 1} succeeded!`);
        return response.data;
      } catch (altError) {
        logWithTime(`Alternative endpoint ${i + 1} also failed`, {
          status: altError.response?.status,
          data: altError.response?.data,
          message: altError.message,
        });
      }
    }

    throw new Error(`All endpoints failed. Primary error: ${error.message}`);
  }
}

// Delete a profile
async function deleteProfile(profileId) {
  const url = `https://${AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/speaker/verification/v2.0/text-independent/profiles/${profileId}`;

  try {
    const response = await debugAxios({
      method: 'DELETE',
      url: url,
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
      },
      timeout: 10000,
    });

    return response.status === 200 || response.status === 204;
  } catch (error) {
    logWithTime('Profile deletion failed', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    // Not throwing here, just log the error
    return false;
  }
}

// Run the main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
