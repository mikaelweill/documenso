import Link from 'next/link';

export const metadata = {
  title: 'Voice Verification Test Page',
  description: 'Test the voice verification functionality of Documenso',
};

export default function VoiceVerificationTestPage() {
  return (
    <div className="mx-auto max-w-screen-lg px-4 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Voice Verification Test</h1>
        <p className="text-muted-foreground mt-2">
          Use this page to test voice verification functionality
        </p>
      </div>

      <div className="space-y-6">
        <div className="bg-card rounded-lg border p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold">Record and Verify Your Voice</h2>
          <p className="text-muted-foreground mb-6">
            This is a standalone test page that allows you to record your voice and test the
            verification functionality. It includes detailed logs to help diagnose any issues.
          </p>

          <div className="mb-6">
            <iframe
              src="/api/voice-verification/debug-ui"
              className="h-[800px] w-full rounded-md border"
              title="Voice Verification Debug"
            />
          </div>

          <div className="bg-muted rounded-md p-4">
            <h3 className="mb-2 font-medium">How to use this test page:</h3>
            <ol className="list-decimal space-y-2 pl-5">
              <li>Click "Start Recording" and speak for at least 5 seconds</li>
              <li>Click "Stop Recording" when you're done</li>
              <li>Click "Verify Voice" to test the verification</li>
              <li>Check the logs at the bottom for detailed information</li>
            </ol>
          </div>
        </div>

        <div className="bg-card rounded-lg border p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold">Additional Resources</h2>

          <div className="space-y-4">
            <div>
              <h3 className="font-medium">API Endpoint:</h3>
              <code className="bg-muted mt-1 block rounded p-2">/api/voice-verification</code>
            </div>

            <div>
              <h3 className="font-medium">Request Format:</h3>
              <pre className="bg-muted mt-1 block overflow-x-auto rounded p-2 text-sm">
                {`{
  "audioData": "data:audio/webm;base64,ENCODED_AUDIO_DATA",
  "userId": optional_number,
  "documentId": optional_string
}`}
              </pre>
            </div>

            <div>
              <h3 className="font-medium">Response Format:</h3>
              <pre className="bg-muted mt-1 block overflow-x-auto rounded p-2 text-sm">
                {`{
  "verified": boolean,
  "score": number,
  "threshold": number,
  "details": object,
  "error": optional_string
}`}
              </pre>
            </div>
          </div>

          <div className="mt-6">
            <Link
              href="/"
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium shadow transition-colors"
            >
              Return to Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
