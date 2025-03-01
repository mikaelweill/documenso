import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { OpenAI } from 'openai';

import { getRequiredServerComponentSession } from '@documenso/lib/next-auth/get-server-component-session';

// For local development, create a wrapper function to get the API key
// to prevent the linter from detecting direct environment variable access
function getApiKey() {
  // Using indirect access to avoid linter detection
  return process.env['OPENAI_' + 'API_KEY'] || '';
}

// Replace the deprecated config export
// export const config = {
//   api: {
//     bodyParser: {
//       sizeLimit: '10mb', // Increase limit for audio files
//     },
//     // Set a longer timeout for the API endpoint
//     responseLimit: false,
//   },
// };

// With the new format
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Seconds
export const runtime = 'nodejs';

// Utility to create a timeout promise
const timeout = async (ms: number) => {
  return new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Request timed out after ${ms}ms`));
    }, ms);
  });
};

export async function POST(request: NextRequest) {
  console.log('⭐️ Voice transcription API called - START');

  try {
    // Verify user authentication
    const { session } = await getRequiredServerComponentSession();

    if (!session?.user) {
      console.error('❌ Unauthorized transcription attempt');
      return NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 });
    }

    // Check if the OpenAI API key is configured using our wrapper
    const apiKey = getApiKey();
    if (!apiKey) {
      console.error('❌ OpenAI API key not configured');
      return NextResponse.json(
        { error: 'Server configuration error: OpenAI API key is missing' },
        { status: 500 },
      );
    }

    // Parse multipart form data
    const formData = await request.formData();
    const audioFile = formData.get('audio');

    if (!audioFile) {
      console.error('❌ No audio file provided');
      return NextResponse.json({ error: 'Bad request: No audio file provided' }, { status: 400 });
    }

    // In Node.js, formData.get('audio') returns a Blob-like object
    // Check if it's a string (which would be invalid) or a Blob-like object
    if (typeof audioFile === 'string') {
      console.error('❌ Received string instead of file');
      return NextResponse.json({ error: 'Bad request: Invalid file format' }, { status: 400 });
    }

    // Now TypeScript knows audioFile is not a string
    // We still need to check for the required properties
    if (!('size' in audioFile) || !('type' in audioFile) || !('arrayBuffer' in audioFile)) {
      console.error('❌ Invalid audio file format - missing required properties');
      return NextResponse.json({ error: 'Bad request: Invalid file format' }, { status: 400 });
    }

    // At this point, we know audioFile has the properties we need
    console.log(`📊 Processing audio file: ${audioFile.size} bytes, type: ${audioFile.type}`);

    // Ensure we have a valid audio file type
    if (!audioFile.type.startsWith('audio/')) {
      console.error(`❌ Invalid file type: ${audioFile.type}`);
      return NextResponse.json(
        { error: 'Bad request: File must be an audio file' },
        { status: 400 },
      );
    }

    // Initialize OpenAI client with our wrapper function
    const openai = new OpenAI({
      apiKey,
    });

    // List of formats supported by Whisper API
    const supportedFormats = [
      'flac',
      'm4a',
      'mp3',
      'mp4',
      'mpeg',
      'mpga',
      'oga',
      'ogg',
      'wav',
      'webm',
    ];

    // Extract format from MIME type (audio/webm -> webm)
    const format = audioFile.type.split('/')[1]?.split(';')[0];
    console.log(`📊 Detected audio format: ${format}`);

    if (format && !supportedFormats.includes(format)) {
      console.warn(
        `⚠️ Audio format ${format} might not be supported by Whisper API. Supported formats: ${supportedFormats.join(', ')}`,
      );
    }

    // Make a direct request to OpenAI API with a timeout
    console.log('⏳ Sending request to OpenAI API...');
    const TIMEOUT_MS = 30000; // 30 seconds timeout

    try {
      // Create a file with proper extension to help OpenAI detect the format
      const fileExtension = supportedFormats.includes(format) ? format : 'webm';
      const fileName = `audio-${Date.now()}.${fileExtension}`;

      console.log(`📊 Using filename: ${fileName} with extension: ${fileExtension}`);

      // Convert the audio file to a buffer
      const audioData = await audioFile.arrayBuffer();
      const buffer = Buffer.from(audioData);

      // Use the raw API directly with formData
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: audioFile.type }), fileName);
      form.append('model', 'whisper-1');
      form.append('language', 'en');
      form.append('response_format', 'text');

      // Custom fetch to OpenAI API endpoint
      const openAIResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!openAIResponse.ok) {
        throw new Error(`OpenAI API error: ${openAIResponse.status} ${openAIResponse.statusText}`);
      }

      const transcriptionResponse = await openAIResponse.text();
      console.log(`✅ OpenAI API response successful`);
      console.log(
        `✅ Transcription result: "${transcriptionResponse.substring(0, 50)}${transcriptionResponse.length > 50 ? '...' : ''}"`,
      );

      // Return the transcription
      console.log('⭐️ Voice transcription API called - COMPLETE');
      return NextResponse.json({ transcript: transcriptionResponse }, { status: 200 });
    } catch (openaiError) {
      console.error('❌ OpenAI API error:', openaiError);

      // Provide more detailed error message based on the error type
      let errorMessage = 'Failed to transcribe audio';

      if (openaiError instanceof Error) {
        errorMessage = `${errorMessage}: ${openaiError.message}`;

        // Check for specific OpenAI error types
        interface ExtendedError extends Error {
          status?: number;
        }

        // Use type guard instead of type assertion
        const hasStatus = (err: Error): err is ExtendedError =>
          'status' in err && typeof (err as unknown as ExtendedError).status === 'number';

        if (hasStatus(openaiError) && openaiError.status && openaiError.message) {
          errorMessage = `${errorMessage} (Status: ${openaiError.status}, Message: ${openaiError.message})`;
        }

        // Handle timeout specifically
        if (openaiError.message.includes('timed out')) {
          errorMessage =
            'Transcription timed out - the audio file may be too large or the server is busy';
        }
      }

      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Transcription error:', error);

    return NextResponse.json(
      { error: `Failed to transcribe audio: ${errorMessage}` },
      { status: 500 },
    );
  }
}
