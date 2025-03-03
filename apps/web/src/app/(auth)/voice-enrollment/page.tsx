'use client';

import { useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useSession } from 'next-auth/react';

import { Button } from '@documenso/ui/primitives/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@documenso/ui/primitives/card';
import { useToast } from '@documenso/ui/primitives/use-toast';
import type { VideoRecorderDataFormat } from '@documenso/ui/primitives/voice-enrollment/video-recorder';
import { VideoRecorder } from '@documenso/ui/primitives/voice-enrollment/video-recorder';

export default function VoiceEnrollmentPage() {
  const { data: session, status } = useSession();
  const { toast } = useToast();
  const router = useRouter();

  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recordingData, setRecordingData] = useState<{ videoBlob: Blob; duration: number } | null>(
    null,
  );
  const [enrollmentComplete, setEnrollmentComplete] = useState(false);

  const uploadVoiceEnrollment = async () => {
    if (!recordingData) {
      toast({
        title: 'No recording',
        description: 'Please record your voice first.',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);

    try {
      console.log('Starting voice enrollment upload, blob size:', recordingData.videoBlob.size);

      // Create FormData with the video and metadata
      const formData = new FormData();
      formData.append('file', recordingData.videoBlob, 'enrollment.webm');
      formData.append('duration', String(recordingData.duration));
      formData.append('isAudioOnly', 'false');

      console.log('FormData created, sending to API...');

      // Include credentials to ensure cookies are sent
      const response = await fetch('/api/voice-enrollment', {
        method: 'POST',
        body: formData,
        credentials: 'include', // Important for session cookies
      });

      console.log('API response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Voice enrollment API error:', errorData);

        // Handle authentication issues
        if (response.status === 401) {
          toast({
            title: 'Authentication Error',
            description:
              'You need to be logged in to complete enrollment. Please sign in and try again.',
            variant: 'destructive',
          });
          return;
        }

        // Handle other errors
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      console.log('Voice enrollment successful:', data);

      // If we got an enrollment ID, we can proceed with audio extraction
      if (data.enrollmentId) {
        setEnrollmentComplete(true);

        toast({
          title: 'Voice enrollment complete',
          description: 'Your voice has been successfully recorded for verification.',
        });

        // Optionally extract audio (can be a separate step)
        try {
          const extractResponse = await fetch('/api/voice-enrollment/extract-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enrollmentId: data.enrollmentId }),
            credentials: 'include', // Important for session cookies
          });

          if (extractResponse.ok) {
            console.log('Audio extraction initiated successfully');
          } else {
            console.error('Audio extraction failed:', await extractResponse.json());
          }
        } catch (extractError) {
          console.error('Error during audio extraction:', extractError);
          // Non-critical error, don't show to user as enrollment is still successful
        }
      }
    } catch (error) {
      console.error('Error uploading voice enrollment:', error);
      toast({
        title: 'Voice Enrollment Failed',
        description:
          error instanceof Error
            ? error.message
            : 'Could not upload voice recording. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Handle recording data change
  const handleRecordingChange = (data: VideoRecorderDataFormat | null) => {
    setRecordingData(data);
  };

  // If not authenticated, show sign-in message
  if (status === 'unauthenticated') {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-center">Voice Enrollment</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-center">
              You need to be signed in to enroll your voice.
            </p>
          </CardContent>
          <CardFooter className="flex justify-center">
            <Button asChild>
              <Link href="/signin">Sign In</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // If still loading session, show loading
  if (status === 'loading') {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-center">Loading...</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-center">
              Please wait while we load your session.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // If enrollment is complete, show completion card
  if (enrollmentComplete) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-center">Voice Enrollment Complete</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-center">
              Your voice has been successfully enrolled.
            </p>
          </CardContent>
          <CardFooter className="flex justify-center">
            <Button asChild>
              <Link href="/dashboard">Go to Dashboard</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-center">Voice Enrollment</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4 text-center">
            Record your voice to enable voice verification when signing documents.
          </p>

          <VideoRecorder
            onChange={handleRecordingChange}
            disabled={isUploading}
            requiredPhrase="I agree to the terms and conditions of Documenso."
          />
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button
            onClick={uploadVoiceEnrollment}
            disabled={!recordingData || isUploading}
            className="w-full"
            loading={isUploading}
          >
            {isUploading ? 'Uploading...' : 'Complete Enrollment'}
          </Button>

          <p className="text-muted-foreground text-center text-xs">
            By completing voice enrollment, you agree to Documenso's voice data processing terms.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
