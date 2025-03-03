'use client';

import { useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Check, Loader2 } from 'lucide-react';
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
  const { data: _session } = useSession();
  const { toast } = useToast();
  const _router = useRouter();

  const [_isRecording, _setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recordingData, setRecordingData] = useState<VideoRecorderDataFormat | null>(null);
  const [enrollmentComplete, setEnrollmentComplete] = useState(false);
  const [processingStep, setProcessingStep] = useState<
    'idle' | 'uploading' | 'extracting' | 'creating_profile' | 'complete'
  >('idle');
  const [processingMessage, setProcessingMessage] = useState('');

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
    setProcessingStep('uploading');
    setProcessingMessage('Uploading your voice enrollment...');

    try {
      console.log('Starting voice enrollment upload, blob size:', recordingData.videoBlob.size);

      // Create FormData with the video and metadata
      const formData = new FormData();
      formData.append('file', recordingData.videoBlob, 'enrollment.webm');
      formData.append('duration', String(recordingData.duration));
      formData.append('isAudioOnly', 'false');

      console.log('FormData created, sending to API...');

      // Include credentials to ensure session cookies are sent
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
        setProcessingStep('extracting');
        setProcessingMessage('Processing your voice sample...');

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
            const extractData = await extractResponse.json();

            if (extractData.success && extractData.readyForProfile) {
              setProcessingStep('creating_profile');
              setProcessingMessage('Creating your voice profile...');

              // The audio extraction endpoint now automatically triggers profile creation,
              // but we can still show the user the progress
              setProcessingStep('complete');
              setEnrollmentComplete(true);

              toast({
                title: 'Voice enrollment complete',
                description: 'Your voice has been successfully enrolled for verification.',
              });
            }
          } else {
            console.error('Audio extraction failed:', await extractResponse.json());
            // ... existing error handling ...
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
  if (_session === null) {
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
  if (_session === undefined) {
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
          <CardContent className="flex flex-col items-center space-y-4">
            <div className="bg-primary/10 text-primary flex h-20 w-20 items-center justify-center rounded-full">
              <Check className="h-10 w-10" />
            </div>
            <p className="text-muted-foreground text-center">
              Your voice has been successfully enrolled and your voice profile has been created. You
              can now use voice verification when signing documents.
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

  // If processing but not complete yet, show loading state
  if (isUploading && !enrollmentComplete) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-center">Processing Voice Enrollment</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center space-y-4">
            <div className="mx-auto flex h-20 w-20 items-center justify-center">
              <Loader2 className="text-primary h-10 w-10 animate-spin" />
            </div>
            <p className="text-muted-foreground text-center">{processingMessage}</p>
            <div className="w-full max-w-xs">
              <div className="bg-muted-foreground/20 h-2 w-full rounded-full">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-500"
                  style={{
                    width:
                      processingStep === 'uploading'
                        ? '33%'
                        : processingStep === 'extracting'
                          ? '66%'
                          : processingStep === 'creating_profile'
                            ? '90%'
                            : '100%',
                  }}
                />
              </div>
            </div>
          </CardContent>
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
            Record your voice to enable voice verification when signing documents. For accurate
            verification, please speak for at least 20 seconds.
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
            <br />
            <span className="mt-2 inline-block font-medium">
              For accurate verification, please speak for at least 20 seconds.
            </span>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
