# Voice Verification Debugging

## Issue Overview

We're encountering a consistent error when attempting to verify user voices with Azure's Speaker Recognition service. The client-side recording and API communication appear to be working correctly, but the verification itself fails with a `"fetch failed"` error.

## Current Behavior

1. Audio recording successfully captures audio from the user (WebM format with Opus codec)
2. Audio is properly converted to base64 and sent to our internal API
3. Our API (`/api/voice-verification`) successfully receives the request and responds with a 200 status
4. However, the verification result contains: `{verified: false, score: 0, threshold: 0.5, error: 'fetch failed'}`
5. This indicates a failure in the communication between our server and the Azure Speaker Recognition service

## Error Logs

```
voice-verification.tsx:262 🎙️ Received audio chunk: 501 bytes
voice-verification.tsx:262 🎙️ Received audio chunk: 541 bytes
voice-verification.tsx:262 🎙️ Received audio chunk: 548 bytes
voice-verification.tsx:262 🎙️ Received audio chunk: 527 bytes
voice-verification.tsx:262 🎙️ Received audio chunk: 555 bytes
voice-verification.tsx:353 🎙️ Stopping recording...
voice-verification.tsx:365 🎙️ Stopping recording, elapsed time: 5
voice-verification.tsx:368 🎙️ Recording stopped
voice-verification.tsx:377 🎙️ Final recording duration: 5
voice-verification.tsx:381 🎙️ Audio tracks stopped
voice-verification.tsx:262 🎙️ Received audio chunk: 411 bytes
voice-verification.tsx:274 🎙️ Recording stopped
voice-verification.tsx:291 🎙️ Audio recording complete: {size: 11567, type: 'audio/webm;codecs=opus', duration: 1}
voice-verification.tsx:109 🔒 Starting voice verification for audio blob {size: 11567, type: 'audio/webm;codecs=opus'}
voice-verification.tsx:124 🔒 Audio converted to base64, length: 15459, first 50 chars: data:audio/webm;codecs=opus;base64,GkXfo59ChoEBQve...
voice-verification.tsx:136 🔒 Preparing to send audio data, base64 length: 15459
voice-verification.tsx:163 🔒 Sending audio to verification API...
voice-verification.tsx:175 🔒 Verification API response status: 200
voice-verification.tsx:184 🔒 Verification result: {verified: false, score: 0, threshold: 0.5, error: 'fetch failed'}
voice-signature-field.tsx:316 Voice verification complete: {verified: false, score: 0, threshold: 0.5, error: 'fetch failed'}
```

## Important Findings

1. **Profile Creation Works**: We can successfully create voice profiles, which confirms our Azure credentials are valid and the basic connection works.

2. **Audio Format Issue**: The browser records in WebM/Opus format, but Azure may require WAV format for verification. We've implemented audio conversion but it might not be working correctly.

3. **Endpoint URL Discrepancy**: There are multiple formats for the Azure verification endpoint, and we might be using an incorrect or deprecated format.

4. **Network Connectivity**: The "fetch failed" error could indicate network issues, CORS problems, or Azure service outages.

## Updated Findings (NEW)

### 1. Profile Not Fully Enrolled

The latest logs show a critical issue that explains our verification failures:

```
[2025-03-04T02:37:33.327Z] [Azure Speaker Recognition] Profile is not properly enrolled! Status: Enrolling
```

Azure Speaker Recognition has different profile states:
- **Enrolling**: The profile needs more voice data before it can be used for verification
- **Enrolled**: The profile has enough voice data and is ready for verification

Our issue is that verification is failing because:
1. The profile is created successfully
2. Initial enrollment happens
3. But the profile remains in "Enrolling" state (needs more audio)
4. Verification attempts fail due to incomplete enrollment

The logs specifically show:
```
"enrollmentStatus": "Enrolling",
"remainingEnrollmentsSpeechLength": 5.32,
"enrollmentsSpeechLength": 14.68
```

This indicates we need about 5.32 more seconds of speech to reach the required ~20 seconds total.

### 2. FFmpeg Missing for Audio Conversion

The logs also show that the audio conversion is failing:

```
[2025-03-04T02:37:33.251Z] [Voice Profile Service] FFmpeg error: Cannot find ffmpeg
```

This means the system can't convert WebM to WAV format because FFmpeg isn't installed or accessible. Without proper conversion, Azure might have difficulty processing our audio.

## Installation Requirements

To ensure voice verification works properly, the following dependencies are required:

1. **FFmpeg Installation**:

   - **Mac OS**:
     ```bash
     brew install ffmpeg
     ```
   
   - **Ubuntu/Debian**:
     ```bash
     sudo apt update
     sudo apt install ffmpeg
     ```
     
   - **Windows**:
     - Download from https://ffmpeg.org/download.html
     - Add to PATH

2. **Verify FFmpeg Installation**:
   ```bash
   ffmpeg -version
   ```

## Updated Solution Steps

1. **Complete the Enrollment Process**:
   - Ensure users provide at least 20 seconds of total speech during enrollment
   - Consider implementing a re-enrollment process with longer recordings
   - Add user guidance to speak clearly and continuously during enrollment

2. **Install FFmpeg**:
   - Follow the installation steps above
   - Verify FFmpeg is accessible from the command line
   - Ensure the application has permission to execute FFmpeg

3. **Monitor Enrollment Status**:
   - Added UI messages to inform users when their profile needs more training
   - Enhanced logging to show enrollment progress and status

## Debugging Steps Taken

### 1. Enhanced Error Logging

- Added detailed logging for all parts of the voice verification process
- Improved error handling to capture more information about the "fetch failed" error
- Added MIME type detection and logging to better understand the audio format

### 2. API Endpoint URL Verification

- Updated the Azure endpoint URL to match Microsoft's latest documentation
- Added logging of multiple potential endpoint variations to identify the correct one:
  ```
  Primary: https://{region}.api.cognitive.microsoft.com/speaker/verification/v2.0/text-independent/profiles/{profileId}/verify
  Alt1: https://{region}.speaker.speech.microsoft.com/speaker/verification/text-independent/cognitiveservices/v1/verify/{profileId}
  Alt2: https://{region}.api.cognitive.microsoft.com/speaker/identification/v2.0/text-independent/profiles/{profileId}/verify
  ```

### 3. Audio Format Conversion

- Implemented WebM to WAV conversion using ffmpeg
- Added fallback to original format if conversion fails
- Applied audio optimization parameters (mono channel, 16kHz sampling)

### 4. Improved Error Handling

- Enhanced error handling to provide more specific user feedback
- Added specific detection for common error types (network issues, auth problems, format issues)

### 5. Axios Implementation (NEW)

- Created an alternative implementation using Axios instead of fetch
- Added a fallback mechanism to try Axios if fetch fails
- Improved error reporting with more detailed logs

### 6. Standalone Test Script (NEW)

- Created a Node.js script (`scripts/test-azure-voice.js`) to test Azure directly
- Script supports:
  - Creating a new profile
  - Enrolling with a test audio file
  - Verifying against the profile
  - Testing multiple endpoint formats
  - Detailed error reporting

## How to Use the Test Script

1. Install dependencies:
   ```bash
   npm install axios
   ```

2. Prepare a test WAV file (8-16kHz, mono)

3. Run the script:
   ```bash
   export AZURE_SPEECH_KEY=your_key_here
   export AZURE_SPEECH_REGION=eastus
   node scripts/test-azure-voice.js [optional-profile-id] [optional-audio-path]
   ```

4. Analyze the detailed output to determine what's failing

## Remaining Issues to Investigate

1. **Audio Format Compatibility**: 
   - Verify that our audio conversion is actually working
   - Confirm the exact audio format specifications required by Azure

2. **Network Issues**:
   - Check if our server can reach Azure's endpoints (no firewall blocking outbound requests)
   - Verify timeout settings on fetch requests
   - Check if Azure services are experiencing outages

3. **Authentication**:
   - Double check the Speech API key format and validity
   - Verify region settings match our subscription

## Next Steps

1. Run the test script to isolate the issue:
   - If the script works but our app doesn't, it's likely an issue with our implementation
   - If the script also fails, it's likely an issue with Azure configuration or connectivity

2. Test with alternative Azure regions:
   - Try changing the region to see if it resolves connectivity issues
   - Some regions may have different latency or reliability

3. Check Azure account settings:
   - Verify there are no resource constraints or quotas being hit
   - Check if there are any account-specific restrictions

4. Try a simpler WebAPI approach:
   - Consider building a serverless function that handles the verification 
   - This could bypass potential issues with Next.js and its environment 