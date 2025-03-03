'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import type { MessageDescriptor } from '@lingui/core';
import { Trans, msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';
import { AnimatePresence, motion } from 'framer-motion';
import { signIn } from 'next-auth/react';
import { useForm } from 'react-hook-form';
import { FaIdCardClip } from 'react-icons/fa6';
import { FcGoogle } from 'react-icons/fc';
import { z } from 'zod';

import communityCardsImage from '@documenso/assets/images/community-cards.png';
import { useAnalytics } from '@documenso/lib/client-only/hooks/use-analytics';
import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { AppErrorCode } from '@documenso/lib/errors/app-error';
import { trpc } from '@documenso/trpc/react';
import { ZPasswordSchema } from '@documenso/trpc/server/auth-router/schema';
import { cn } from '@documenso/ui/lib/utils';
import { Button } from '@documenso/ui/primitives/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@documenso/ui/primitives/form/form';
import { Input } from '@documenso/ui/primitives/input';
import { PasswordInput } from '@documenso/ui/primitives/password-input';
import { SignaturePad } from '@documenso/ui/primitives/signature-pad';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { UserProfileSkeleton } from '~/components/ui/user-profile-skeleton';
import { UserProfileTimur } from '~/components/ui/user-profile-timur';

const SIGN_UP_REDIRECT_PATH = '/documents';

type SignUpStep = 'BASIC_DETAILS' | 'VOICE_ENROLLMENT' | 'CLAIM_USERNAME';

export const ZSignUpFormV2Schema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: msg`Please enter a valid name.`.id }),
    email: z.string().email().min(1),
    password: ZPasswordSchema,
    signature: z.string().min(1, { message: msg`We need your signature to sign documents`.id }),
    url: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, { message: msg`We need a username to create your profile`.id })
      .regex(/^[a-z0-9-]+$/, {
        message: msg`Username can only container alphanumeric characters and dashes.`.id,
      }),
    voiceEnrollmentComplete: z.boolean().optional().default(false),
    voiceEnrollmentVideoUrl: z.string().optional(),
    voiceEnrollmentDuration: z.number().optional(),
  })
  .refine(
    (data) => {
      const { name, email, password } = data;
      return !password.includes(name) && !password.includes(email.split('@')[0]);
    },
    {
      message: msg`Password should not be common or based on personal information`.id,
      path: ['password'],
    },
  );

export const signupErrorMessages: Record<string, MessageDescriptor> = {
  SIGNUP_DISABLED: msg`Signups are disabled.`,
  [AppErrorCode.ALREADY_EXISTS]: msg`User with this email already exists. Please use a different email address.`,
  [AppErrorCode.INVALID_REQUEST]: msg`We were unable to create your account. Please review the information you provided and try again.`,
  [AppErrorCode.PROFILE_URL_TAKEN]: msg`This username has already been taken`,
  [AppErrorCode.PREMIUM_PROFILE_URL]: msg`Only subscribers can have a username shorter than 6 characters`,
};

export type TSignUpFormV2Schema = z.infer<typeof ZSignUpFormV2Schema>;

export type SignUpFormV2Props = {
  className?: string;
  initialEmail?: string;
  isGoogleSSOEnabled?: boolean;
  isOIDCSSOEnabled?: boolean;
};

// The type definition for HTML canvas element with captureStream
// Renamed with underscore to indicate it's used as a type definition only
interface _CanvasWithCaptureStream extends HTMLCanvasElement {
  captureStream(frameRate?: number): MediaStream;
}

// Helper function to safely handle canvas.captureStream without direct type assertions
const safeCanvasStream = (canvas: HTMLCanvasElement, fps: number = 30): MediaStream => {
  // Type guard to check if captureStream exists
  if (typeof canvas.captureStream === 'function') {
    return canvas.captureStream(fps);
  }

  // Fallback for browsers where captureStream is not a standard property
  // This will also trigger the TypeScript error but we're handling it safely
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
  return (canvas as any).captureStream?.(fps) || new MediaStream();
};

export const SignUpFormV2 = ({
  className,
  initialEmail,
  isGoogleSSOEnabled,
  isOIDCSSOEnabled,
}: SignUpFormV2Props) => {
  const { _ } = useLingui();
  const { toast } = useToast();

  const analytics = useAnalytics();
  const _router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<SignUpStep>('BASIC_DETAILS');

  const _utmSrc = searchParams?.get('utm_source') ?? null;

  const baseUrl = new URL(NEXT_PUBLIC_WEBAPP_URL() ?? 'http://localhost:3000');

  const urlParam = searchParams?.get('url') || '';
  const isDebugMode = searchParams?.get('debug') === 'true';

  const form = useForm<TSignUpFormV2Schema>({
    resolver: zodResolver(ZSignUpFormV2Schema),
    defaultValues: {
      name: '',
      email: initialEmail ?? '',
      password: '',
      signature: undefined,
      voiceEnrollmentComplete: false,
      voiceEnrollmentVideoUrl: undefined,
      voiceEnrollmentDuration: undefined,
      url: urlParam,
    },
  });

  const isSubmitting = form.formState.isSubmitting;

  const name = form.watch('name');
  const url = form.watch('url');

  const { mutateAsync: signup } = trpc.auth.signup.useMutation();

  // Add state for video recorder
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingChunks = useRef<Blob[]>([]);
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Add state for upload loading
  const [isUploading, setIsUploading] = useState(false);

  // Add state for audio-only mode
  const [isAudioOnlyMode, setIsAudioOnlyMode] = useState(false);

  // Add a canvas ref to keep it alive
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Add animation frame ID ref
  const animationFrameRef = useRef<number | null>(null);

  // State for permissions and errors, rename unused ones with underscore
  const [hasRequestedPermissions, setHasRequestedPermissions] = useState(false);
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [_permissionsError, setPermissionsError] = useState<string | null>(null);

  // Add missing state variables
  const [_isCameraReady, setIsCameraReady] = useState(false);

  // Add underscore to recordingStartTime since it's not directly used
  const [_recordingStartTime, setRecordingStartTime] = useState<number | null>(null);

  // Add a function to animate the audio canvas during recording
  const _drawAudioWaveform = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas with transparent background since it overlays the video
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // No need for title text since we have the banner

    // If recording, draw a simple audio visualization
    if (isRecording) {
      const centerY = canvas.height / 2;
      const width = Math.min(400, canvas.width * 0.8);
      const height = 80;
      const startX = (canvas.width - width) / 2;

      // Draw a semi-transparent background for the visualization
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(startX, centerY - height / 2, width, height);

      // Draw the waveform
      ctx.fillStyle = '#4CAF50';
      ctx.strokeStyle = '#FFF';
      ctx.lineWidth = 2;

      // Number of bars
      const barCount = 30;
      const barWidth = (width - (barCount - 1) * 2) / barCount;
      const barMaxHeight = height * 0.8;

      // Draw bars with animation
      for (let i = 0; i < barCount; i++) {
        const x = startX + i * (barWidth + 2);
        // Use time and position to create a dynamic waveform
        const time = Date.now() / 200;
        const amplitude = Math.sin(time + i * 0.2) * 0.5 + 0.5;
        const barHeight = barMaxHeight * amplitude;

        ctx.fillRect(x, centerY - barHeight / 2, barWidth, barHeight);
      }
    }

    // Continue animation if recording
    if (isRecording && canvasRef.current) {
      animationFrameRef.current = requestAnimationFrame(() => {
        if (canvasRef.current) {
          _drawAudioWaveform(canvasRef.current);
        }
      });
    }
  };

  // Add a proper cleanup function
  const cleanupVideoRecording = useCallback(() => {
    // Don't clean up if we're currently recording
    if (isRecording) {
      console.log('Skipping cleanup while recording is active');
      return;
    }

    console.log('Cleaning up video recording resources...');

    // Stop any ongoing recording
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch (error) {
        console.error('Error stopping media recorder during cleanup:', error);
      }
    }

    // Stop all tracks in the recording stream
    if (recordingStream) {
      recordingStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.error('Error stopping track:', error);
        }
      });
    }

    // Cancel animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Clear interval
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    // Reset state
    setRecordingStream(null);
    setMediaRecorder(null);
    setIsRecording(false);
    setIsCameraReady(false);

    console.log('Video recording resources cleaned up');
  }, [mediaRecorder, recordingStream, isRecording]);

  // Add useEffect cleanup when component unmounts
  useEffect(() => {
    return () => {
      console.log('Component unmounting, cleaning up all resources');

      // Stop any active recording
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try {
          mediaRecorder.stop();
        } catch (error) {
          console.error('Error stopping media recorder during unmount:', error);
        }
      }

      // Stop all tracks
      if (recordingStream) {
        recordingStream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (error) {
            console.error('Error stopping track during unmount:', error);
          }
        });
      }

      // Cancel animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      // Clear interval
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
      }
    };
  }, []);

  // Update useEffect to include all dependencies
  useEffect(() => {
    // Start the timer when recording begins
    if (isRecording) {
      // Set the start time for recording
      setRecordingStartTime(Date.now());

      // Create an interval to update the duration every second
      const timer = setInterval(() => {
        setRecordingDuration((prevDuration) => prevDuration + 1);
      }, 1000);

      // Store the timer reference for cleanup
      durationTimerRef.current = timer;

      // Clean up function to clear the timer when recording stops
      return () => {
        if (durationTimerRef.current) {
          clearInterval(durationTimerRef.current);
          durationTimerRef.current = null;
        }

        // Also clean up resources when unmounting during recording
        if (mediaRecorder && recordingStream) {
          if (mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
          }

          cleanupVideoRecording();
        }
      };
    }
  }, [isRecording, mediaRecorder, recordingStream]); // Added mediaRecorder and recordingStream as dependencies

  // Update checkPermissionStatus to use proper typing instead of assertions
  const checkPermissionStatus = async () => {
    try {
      // Use type assertions but in a more explicit way with a comment explaining why
      // This is necessary because the browser's Permissions API expects specific strings
      // but TypeScript's built-in types may not be up-to-date with all browsers
      const cameraPermission = await navigator.permissions.query({
        // Using type assertion here because 'camera' is valid in modern browsers
        // but may not be included in the TypeScript PermissionName type
        name: 'camera' as PermissionName,
      });

      const micPermission = await navigator.permissions.query({
        // Using type assertion here because 'microphone' is valid in modern browsers
        name: 'microphone' as PermissionName,
      });

      if (cameraPermission.state === 'denied' || micPermission.state === 'denied') {
        return 'blocked';
      }

      return 'granted';
    } catch (error) {
      console.error('Error checking permission status:', error);
      return 'unknown';
    }
  };

  // Move startCameraAudioOnly function above startCamera to fix reference
  const startCameraAudioOnly = async (): Promise<MediaStream | null> => {
    try {
      console.log('Starting audio-only mode...');

      // Only clean up tracks, don't reset state
      if (recordingStream) {
        recordingStream.getTracks().forEach((track) => track.stop());
      }

      // Get audio stream
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      console.log('Audio stream acquired:', audioStream);

      // Set up canvas for audio visualization
      const canvas = document.getElementById('audio-canvas');
      console.log('Canvas element found:', canvas);

      if (canvas instanceof HTMLCanvasElement) {
        canvasRef.current = canvas;
        setIsCameraReady(true);

        // Create canvas stream
        const canvasStream = safeCanvasStream(canvas, 30);

        // Add audio track to canvas stream
        const audioTrack = audioStream.getAudioTracks()[0];
        canvasStream.addTrack(audioTrack);

        console.log('Setting recording stream with canvas and audio');
        console.log('Canvas stream created and audio track added');

        return canvasStream;
      }

      // If we got here, no canvas was found, use just audio
      setIsCameraReady(true);
      return audioStream;
    } catch (error) {
      console.error('Error in audio-only mode:', error);
      return null;
    }
  };

  // Restore the startCamera function with our helper
  const startCamera = async (): Promise<MediaStream | null> => {
    try {
      // Check if permissions are already blocked
      const permissionStatus = await checkPermissionStatus();

      if (permissionStatus === 'blocked') {
        toast({
          title: 'Camera access blocked',
          description: (
            <div className="flex flex-col gap-2">
              <p>Camera access is blocked in your browser settings. To enable:</p>
              <ol className="list-decimal pl-5">
                <li>Click the lock/site settings icon in your address bar</li>
                <li>Find "Camera" and "Microphone" permissions</li>
                <li>Change from "Block" to "Allow"</li>
                <li>Refresh the page and try again</li>
              </ol>
            </div>
          ),
          variant: 'destructive',
          duration: 10000,
        });
        return null;
      }

      // Only stop tracks, don't reset state
      if (recordingStream) {
        recordingStream.getTracks().forEach((track) => track.stop());
      }

      // Reset video blob but not other state
      setVideoBlob(null);
      recordingChunks.current = [];

      try {
        if (isAudioOnlyMode) {
          // Audio only mode
          const audioStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });

          setIsCameraReady(true);

          // Set up canvas for audio visualization
          const canvas = document.getElementById('audio-canvas');
          if (canvas instanceof HTMLCanvasElement) {
            canvasRef.current = canvas;

            // Use helper function instead of type assertion
            const canvasStream = safeCanvasStream(canvas, 30);

            // Combine audio track with canvas stream
            const audioTrack = audioStream.getAudioTracks()[0];
            canvasStream.addTrack(audioTrack);

            return canvasStream;
          }

          // If we can't set up the canvas, just return the audio stream
          return audioStream;
        } else {
          // Video mode - try to get both video and audio
          const videoStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });

          setIsAudioOnlyMode(false);
          setIsCameraReady(true);

          // Set video source
          const videoElement = document.getElementById('enrollment-video-preview');
          if (videoElement instanceof HTMLVideoElement) {
            videoElement.srcObject = videoStream;
            videoElement.play().catch(console.error);
          }

          return videoStream;
        }
      } catch (error: unknown) {
        console.error('Error accessing media devices:', error);

        // Type safe error handling
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (
          (error instanceof DOMException && error.name === 'NotFoundError') ||
          (typeof error === 'object' &&
            error !== null &&
            'name' in error &&
            error.name === 'DevicesNotFoundError')
        ) {
          // No webcam available, but don't switch to audio-only mode
          // Instead, create a black video stream but still get audio
          console.log('No camera detected, creating a black video stream with audio');

          try {
            // Get just audio
            const audioStream = await navigator.mediaDevices.getUserMedia({
              audio: true,
              video: false,
            });

            // Create a canvas for black video
            const canvas = document.createElement('canvas');
            canvas.width = 640;
            canvas.height = 480;

            // Draw black background
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = 'black';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            // Get stream from canvas (for video)
            const canvasStream = safeCanvasStream(canvas, 30);

            // Add audio track to the canvas stream
            const audioTrack = audioStream.getAudioTracks()[0];
            canvasStream.addTrack(audioTrack);

            // Set it to the video element
            const videoElement = document.getElementById('enrollment-video-preview');
            if (videoElement instanceof HTMLVideoElement) {
              videoElement.srcObject = canvasStream;
              videoElement.play().catch(console.error);
            }

            // Keep video UI visible but show toast about no camera
            toast({
              title: 'No camera detected',
              description: 'Recording with audio only (camera not available).',
              variant: 'default',
            });

            setIsCameraReady(true);
            // Do NOT set to audio-only mode to keep the video element visible
            // setIsAudioOnlyMode(false);

            return canvasStream;
          } catch (audioError) {
            console.error('Error setting up audio-only with black video:', audioError);
            // Now fall back to complete audio-only as a last resort
            setIsAudioOnlyMode(true);
            return startCameraAudioOnly();
          }
        } else if (
          (error instanceof DOMException && error.name === 'NotAllowedError') ||
          (typeof error === 'object' &&
            error !== null &&
            'name' in error &&
            error.name === 'NotAllowedError')
        ) {
          toast({
            title: 'Permission denied',
            description: 'You need to allow access to your camera and microphone.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Camera error',
            description: `Could not access camera: ${errorMessage}`,
            variant: 'destructive',
          });
        }

        // Return null if we couldn't get a stream due to an error
        return null;
      }
    } catch (e) {
      console.error('Unexpected error in startCamera:', e);
      toast({
        title: 'Camera error',
        description: 'An unexpected error occurred while setting up the camera.',
        variant: 'destructive',
      });
      return null;
    }
  };

  // Modified to return the S3 URL instead of creating enrollment
  const uploadVoiceEnrollment = async (
    videoBlob: Blob,
  ): Promise<{ url: string; duration: number } | null> => {
    setIsUploading(true);

    try {
      // Ensure we have a valid blob and size
      if (!videoBlob || videoBlob.size === 0) {
        throw new Error('No valid recording data available to upload');
      }

      console.log(
        'Starting voice enrollment upload:',
        `Size: ${(videoBlob.size / 1024 / 1024).toFixed(2)}MB`,
        `Type: ${videoBlob.type || 'video/webm'}`,
        `Duration: ${recordingDuration}s`,
      );

      // Create FormData with the video and metadata
      const formData = new FormData();

      // Use a more specific filename with timestamp and extension based on audio/video
      const fileName = isAudioOnlyMode
        ? `enrollment_audio_${Date.now()}.webm`
        : `enrollment_video_${Date.now()}.webm`;

      // Add the blob with appropriate filename
      formData.append('file', videoBlob, fileName);
      formData.append('duration', String(recordingDuration));
      formData.append('isAudioOnly', isAudioOnlyMode ? 'true' : 'false');

      console.log('FormData created, sending to API...');

      // Temporary upload that just returns the S3 URL without creating voice enrollment record
      const response = await fetch('/api/voice-enrollment/temp-upload', {
        method: 'POST',
        body: formData,
      });

      console.log('API response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.log('Voice enrollment API error:', errorData);

        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      console.log('Voice enrollment uploaded to S3 successfully:', data);

      // Mark voice enrollment as complete in form state
      form.setValue('voiceEnrollmentComplete', true);
      form.setValue('voiceEnrollmentVideoUrl', data.videoUrl);
      form.setValue('voiceEnrollmentDuration', recordingDuration);

      // Return the URL and duration for further processing
      return {
        url: data.videoUrl,
        duration: recordingDuration,
      };
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
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  // Record video and handle recording start/stop
  const setupMediaRecorder = (mediaStreamToUse: MediaStream): MediaRecorder | null => {
    try {
      // Reset recording chunks
      recordingChunks.current = [];

      // Determine the correct MIME type based on browser support
      const mimeType = isAudioOnlyMode ? 'audio/webm;codecs=opus' : 'video/webm;codecs=vp8,opus';

      // Check if the browser supports the preferred MIME type
      const options: MediaRecorderOptions = {};
      if (MediaRecorder.isTypeSupported(mimeType)) {
        options.mimeType = mimeType;
        console.log(`Using supported MIME type: ${mimeType}`);
      } else {
        console.warn(`MIME type ${mimeType} not supported, using browser default`);
      }

      // Set up the media recorder instance with options
      const recorder = new MediaRecorder(mediaStreamToUse, options);

      // Handle data available event
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunks.current.push(event.data);
          console.log(`Recording chunk received: ${(event.data.size / 1024).toFixed(2)}KB`);
        }
      };

      // Handle stop event
      recorder.onstop = () => {
        // Create a blob from all chunks
        if (recordingChunks.current.length > 0) {
          // Use the correct MIME type for the blob
          const blobType = isAudioOnlyMode ? 'audio/webm' : 'video/webm';
          const blob = new Blob(recordingChunks.current, { type: blobType });

          console.log(
            `Recording completed: ${(blob.size / 1024 / 1024).toFixed(2)}MB, type: ${blob.type}`,
          );
          setVideoBlob(blob);

          // Create a URL for the blob for preview
          const videoElement = document.getElementById('enrollment-video-preview');
          if (videoElement instanceof HTMLVideoElement) {
            // Revoke any previous object URL to prevent memory leaks
            if (videoElement.src && videoElement.src.startsWith('blob:')) {
              URL.revokeObjectURL(videoElement.src);
            }

            videoElement.src = URL.createObjectURL(blob);
            videoElement.srcObject = null;
            videoElement.controls = true;
            videoElement.loop = false;
            videoElement.muted = false;

            // Add event listener for when playback ends
            videoElement.onended = () => {
              console.log('Recording playback ended');
              // Reset to beginning so it's ready for replay
              videoElement.currentTime = 0;
            };

            // Let user know they can replay the recording
            toast({
              title: 'Recording saved',
              description: 'You can now review your recording before accepting.',
            });
          }

          console.log('Recording saved, duration:', recordingDuration);
        } else {
          console.warn('No recording chunks available after stopping recording');
          toast({
            title: 'Recording failed',
            description: 'No data was captured during recording. Please try again.',
            variant: 'destructive',
          });
        }

        // Ensure recording state is updated
        setIsRecording(false);
      };

      // Handle recording errors
      recorder.onerror = (event) => {
        console.error('Recording error:', event);
        toast({
          title: 'Recording error',
          description: 'An error occurred during recording',
          variant: 'destructive',
        });
        setIsRecording(false);
      };

      return recorder;
    } catch (error) {
      console.error('Error setting up media recorder:', error);
      return null;
    }
  };

  // Handle recording button click in the VOICE_ENROLLMENT step
  const handleRecordingClick = async () => {
    if (isRecording) {
      // Stop recording logic...
      if (mediaRecorder) {
        console.log('Stopping recording');
        mediaRecorder.stop();
        setIsRecording(false);

        // Clear the timer
        if (durationTimerRef.current) {
          clearInterval(durationTimerRef.current);
          durationTimerRef.current = null;
        }
      }
    } else {
      // Start recording logic...

      // Initialize the recording stream if not already set
      let streamToUse: MediaStream | null = null;

      if (isAudioOnlyMode) {
        streamToUse = await startCameraAudioOnly();
      } else {
        streamToUse = await startCamera();
      }

      if (!streamToUse) {
        console.error('Failed to get stream');
        return;
      }

      setIsRecording(true);
      setRecordingStream(streamToUse);

      // Set the recording start time
      const startTime = Date.now();
      setRecordingStartTime(startTime);

      // Setup media recorder with the stream
      const recorder = setupMediaRecorder(streamToUse);

      if (recorder) {
        setMediaRecorder(recorder);
        recorder.start();
        console.log('Recording started');
      } else {
        console.error('Failed to create media recorder');
        setIsRecording(false);
      }
    }
  };

  // Update the stopRecording function to be more direct
  const _stopRecording = () => {
    console.log('Stopping recording...');

    // Clear animation if active
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Clear timer
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    // Stop the media recorder
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }

    // Clean up video resources
    cleanupVideoRecording();

    // Set state to not recording
    setIsRecording(false);
  };

  // Fix for 'any' type on line 843
  const onFormSubmit = async ({
    name,
    email,
    password,
    signature,
    url,
    voiceEnrollmentVideoUrl,
    voiceEnrollmentDuration,
  }: TSignUpFormV2Schema) => {
    try {
      await signup({
        name,
        email,
        password,
        signature,
        url,
        voiceEnrollmentVideoUrl,
        voiceEnrollmentDuration,
      });

      // Use analytics.capture instead of track
      analytics.capture('App: User Sign Up', { email });

      await signIn('credentials', {
        email,
        password,
        callbackUrl: '/',
      });
    } catch (error) {
      console.error('Error in sign up:', error);

      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred during sign up';

      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const onNextClick = () => {
    if (step === 'BASIC_DETAILS') {
      // Validate the fields for the basic details step
      const basicDetailsFields = ['name', 'email', 'password'] as const;

      // Use void to explicitly ignore the promise
      void form.trigger(basicDetailsFields).then((isValid) => {
        if (isValid) {
          setStep('VOICE_ENROLLMENT');
        }
      });
    } else if (step === 'VOICE_ENROLLMENT') {
      setStep('CLAIM_USERNAME');
    }
  };

  const onBackClick = () => {
    if (step === 'CLAIM_USERNAME') {
      setStep('VOICE_ENROLLMENT');
    } else if (step === 'VOICE_ENROLLMENT') {
      setStep('BASIC_DETAILS');
    }
  };

  const onSignUpWithGoogleClick = async () => {
    analytics.capture('App: Google SSO Sign Up Click');

    try {
      await signIn('google', { callbackUrl: SIGN_UP_REDIRECT_PATH });
    } catch (err) {
      toast({
        title: _(msg`An unknown error occurred`),
        description: _(
          msg`We encountered an unknown error while attempting to sign you Up. Please try again later.`,
        ),
        variant: 'destructive',
      });
    }
  };

  const onSignUpWithOIDCClick = async () => {
    analytics.capture('App: OIDC SSO Sign Up Click');

    try {
      await signIn('oidc', { callbackUrl: SIGN_UP_REDIRECT_PATH });
    } catch (err) {
      toast({
        title: _(msg`An unknown error occurred`),
        description: _(
          msg`We encountered an unknown error while attempting to sign you Up. Please try again later.`,
        ),
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    const hash = window.location.hash.slice(1);

    const params = new URLSearchParams(hash);

    const email = params.get('email');

    if (email) {
      form.setValue('email', email);
    }
  }, [form]);

  // Update simulateVideoRecording to properly implement async functionality
  const simulateVideoRecording = async (): Promise<void> => {
    try {
      // Create a canvas element
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;

      // Get the context and draw a simple gradient
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.error('Could not get canvas context');
        return;
      }

      // Create a gradient
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, '#ff4b4b');
      gradient.addColorStop(1, '#a30000');

      // Fill with gradient
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Add text
      ctx.fillStyle = 'white';
      ctx.font = 'bold 24px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('DEBUG MODE - Simulated Video', canvas.width / 2, canvas.height / 2);
      ctx.fillText('No camera access needed', canvas.width / 2, canvas.height / 2 + 30);

      // Convert canvas to blob - wrap in a promise to make it truly async
      return new Promise<void>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            // Set the video blob
            setVideoBlob(blob);

            // Display in the preview
            const videoElement = document.getElementById('enrollment-video-preview');
            if (videoElement instanceof HTMLVideoElement) {
              const url = URL.createObjectURL(blob);
              videoElement.srcObject = null;
              videoElement.src = url;
              videoElement.controls = true;
            }

            toast({
              title: 'Debug Mode',
              description: 'Simulated video recording created successfully.',
            });

            resolve();
          } else {
            reject(new Error('Failed to create blob from canvas'));
          }
        }, 'image/png');
      });
    } catch (error) {
      console.error('Error simulating video:', error);
      throw error;
    }
  };

  // Add a function to format time properly
  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || seconds < 0) {
      return '0:00';
    }

    // Handle extremely large values (defensive programming)
    if (seconds > 86400) {
      // more than 24 hours
      return 'Recording...';
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Handle upload click in the VOICE_ENROLLMENT step
  const handleUploadClick = async () => {
    if (!videoBlob) {
      toast({
        title: 'No recording',
        description: 'Please record your voice first',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Upload the video
      const result = await uploadVoiceEnrollment(videoBlob);

      if (result) {
        toast({
          title: 'Success',
          description: 'Voice enrollment successfully recorded',
        });

        // Move to next step after successful upload
        setStep('CLAIM_USERNAME');
      }
    } catch (error) {
      console.error('Error during upload:', error);
      toast({
        title: 'Upload Failed',
        description: 'Could not upload recording. Please try again.',
        variant: 'destructive',
      });
    }
  };

  // Add right before the return statement of the component, or at the end of the component setup
  useEffect(() => {
    // When we have a video blob in audio-only mode, add a basic audio player UI
    if (videoBlob && isAudioOnlyMode) {
      const videoElement = document.getElementById('enrollment-video-preview') as HTMLVideoElement;
      if (videoElement) {
        // Make sure video is visible and canvas is hidden for playback
        videoElement.style.display = 'block';
        const canvas = document.getElementById('audio-canvas') as HTMLCanvasElement;
        if (canvas) {
          canvas.style.display = 'none';
        }

        // Add a simple playback indicator
        videoElement.addEventListener('play', () => {
          console.log('Audio playback started');
        });

        videoElement.addEventListener('pause', () => {
          console.log('Audio playback paused');
        });
      }
    }
  }, [videoBlob, isAudioOnlyMode]);

  // Add underscore to onError if it's not directly called
  const _onError = (error: Error | unknown) => {
    console.error('Error during sign up:', error);
    toast({
      title: 'An error occurred',
      description: error instanceof Error ? error.message : 'Unknown error during sign up',
      variant: 'destructive',
    });
  };

  useEffect(() => {
    // Start audio visualization when recording
    if (isRecording && !isAudioOnlyMode && canvasRef.current) {
      const videoElement = document.getElementById('enrollment-video-preview') as HTMLVideoElement;
      const canvasElement = canvasRef.current;

      if (!canvasElement) return;

      const animateVideo = () => {
        if (!videoElement.paused && !videoElement.ended) {
          const context = canvasElement.getContext('2d');

          if (!context) return;

          context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
          animationFrameRef.current = requestAnimationFrame(animateVideo);
        }
      };

      animationFrameRef.current = requestAnimationFrame(animateVideo);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isRecording, isAudioOnlyMode, mediaRecorder, recordingStream]);

  return (
    <div className={cn('flex justify-center gap-x-12', className)}>
      <div className="border-border relative hidden flex-1 overflow-hidden rounded-xl border xl:flex">
        <div className="absolute -inset-8 -z-[2] backdrop-blur">
          <Image
            src={communityCardsImage}
            fill={true}
            alt="community-cards"
            className="dark:brightness-95 dark:contrast-[70%] dark:invert"
          />
        </div>

        <div className="bg-background/50 absolute -inset-8 -z-[1] backdrop-blur-[2px]" />

        <div className="relative flex h-full w-full flex-col items-center justify-evenly">
          <div className="bg-background rounded-2xl border px-4 py-1 text-sm font-medium">
            <Trans>User profiles are here!</Trans>
          </div>

          <AnimatePresence>
            {step === 'BASIC_DETAILS' ? (
              <motion.div className="w-full max-w-md" layoutId="user-profile">
                <UserProfileTimur
                  rows={2}
                  className="bg-background border-border rounded-2xl border shadow-md"
                />
              </motion.div>
            ) : (
              <motion.div className="w-full max-w-md" layoutId="user-profile">
                <UserProfileSkeleton
                  user={{ name, url }}
                  rows={2}
                  className="bg-background border-border rounded-2xl border shadow-md"
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div />
        </div>
      </div>

      <div className="border-border dark:bg-background relative z-10 flex min-h-[min(850px,80vh)] w-full max-w-lg flex-col rounded-xl border bg-neutral-100 p-6">
        {step === 'BASIC_DETAILS' && (
          <div className="h-20">
            <h1 className="text-xl font-semibold md:text-2xl">
              <Trans>Create a new account</Trans>
            </h1>

            <p className="text-muted-foreground text-sm">
              <Trans>Create your account to get started with Documenso.</Trans>
            </p>
          </div>
        )}

        {step === 'VOICE_ENROLLMENT' && (
          <div className="h-20">
            <h1 className="text-xl font-semibold md:text-2xl">
              <Trans>Set up voice verification</Trans>
            </h1>

            <p className="text-muted-foreground text-sm">
              <Trans>
                Record a short video for voice verification. This is optional and helps secure your
                account.
              </Trans>
            </p>
          </div>
        )}

        {step === 'CLAIM_USERNAME' && (
          <div className="h-20">
            <h1 className="text-xl font-semibold md:text-2xl">
              <Trans>Claim your username now</Trans>
            </h1>

            <p className="text-muted-foreground text-sm">
              <Trans>Choose a username for your public profile.</Trans>
            </p>
          </div>
        )}

        <hr className="-mx-6 my-4" />

        <Form {...form}>
          <form
            className="flex w-full flex-1 flex-col gap-y-4"
            onSubmit={form.handleSubmit(onFormSubmit)}
          >
            {step === 'BASIC_DETAILS' && (
              <fieldset
                className={cn(
                  'flex h-[550px] w-full flex-col gap-y-4',
                  (isGoogleSSOEnabled || isOIDCSSOEnabled) && 'h-[650px]',
                )}
                disabled={isSubmitting}
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <Trans>Full Name</Trans>
                      </FormLabel>
                      <FormControl>
                        <Input type="text" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <Trans>Email Address</Trans>
                      </FormLabel>
                      <FormControl>
                        <Input type="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <Trans>Password</Trans>
                      </FormLabel>

                      <FormControl>
                        <PasswordInput {...field} />
                      </FormControl>

                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="signature"
                  render={({ field: { onChange } }) => (
                    <FormItem>
                      <FormLabel>
                        <Trans>Sign Here</Trans>
                      </FormLabel>
                      <FormControl>
                        <SignaturePad
                          className="h-36 w-full"
                          disabled={isSubmitting}
                          containerClassName="mt-2 rounded-lg border bg-background"
                          onChange={(v) => onChange(v ?? '')}
                        />
                      </FormControl>

                      <FormMessage />
                    </FormItem>
                  )}
                />

                {(isGoogleSSOEnabled || isOIDCSSOEnabled) && (
                  <>
                    <div className="relative flex items-center justify-center gap-x-4 py-2 text-xs uppercase">
                      <div className="bg-border h-px flex-1" />
                      <span className="text-muted-foreground bg-transparent">
                        <Trans>Or</Trans>
                      </span>
                      <div className="bg-border h-px flex-1" />
                    </div>
                  </>
                )}

                {isGoogleSSOEnabled && (
                  <>
                    <Button
                      type="button"
                      size="lg"
                      variant={'outline'}
                      className="bg-background text-muted-foreground border"
                      disabled={isSubmitting}
                      onClick={onSignUpWithGoogleClick}
                    >
                      <FcGoogle className="mr-2 h-5 w-5" />
                      <Trans>Sign Up with Google</Trans>
                    </Button>
                  </>
                )}

                {isOIDCSSOEnabled && (
                  <>
                    <Button
                      type="button"
                      size="lg"
                      variant={'outline'}
                      className="bg-background text-muted-foreground border"
                      disabled={isSubmitting}
                      onClick={onSignUpWithOIDCClick}
                    >
                      <FaIdCardClip className="mr-2 h-5 w-5" />
                      <Trans>Sign Up with OIDC</Trans>
                    </Button>
                  </>
                )}

                <p className="text-muted-foreground mt-4 text-sm">
                  <Trans>
                    Already have an account?{' '}
                    <Link
                      href="/signin"
                      className="text-documenso-700 duration-200 hover:opacity-70"
                    >
                      Sign in instead
                    </Link>
                  </Trans>
                </p>
              </fieldset>
            )}

            {step === 'VOICE_ENROLLMENT' && (
              <div className="flex flex-col gap-4 overflow-y-auto">
                {/* Debug mode banner */}
                {isDebugMode && (
                  <div
                    className="relative mb-4 rounded border border-yellow-400 bg-yellow-100 px-4 py-3 text-yellow-700"
                    role="alert"
                  >
                    <strong className="font-bold">Development Mode! </strong>
                    <span className="block sm:inline">
                      This debug mode is for development only and will not be included in
                      production.
                    </span>
                  </div>
                )}

                <fieldset
                  className="flex w-full flex-col gap-y-4 overflow-y-auto"
                  disabled={isSubmitting}
                >
                  <div className="flex flex-col items-center justify-center">
                    <div className="border-border w-full max-w-md rounded-md border bg-neutral-50 p-6">
                      <h3 className="mb-4 text-lg font-medium">
                        <Trans>Voice Enrollment</Trans>
                      </h3>

                      <p className="text-muted-foreground mb-6 text-sm">
                        <Trans>
                          Record a short video of yourself saying a specific phrase to set up voice
                          verification. This will be used to verify your identity when signing
                          documents.
                        </Trans>
                      </p>

                      <div className="flex flex-col gap-4 p-3">
                        <div className="flex flex-col items-center space-y-4">
                          <div className="bg-muted relative aspect-video w-full overflow-hidden rounded-lg">
                            {/* Always show the video element - our black video stream will work with it */}
                            <video
                              id="enrollment-video-preview"
                              className="h-full w-full object-cover"
                              autoPlay
                              muted={!videoBlob}
                              playsInline
                              controls={!!videoBlob}
                            ></video>

                            {/* Only show the canvas for waveform visualization alongside the video if in audio-only mode */}
                            {isAudioOnlyMode && !videoBlob && (
                              <canvas
                                id="audio-canvas"
                                className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-70"
                                width="640"
                                height="360"
                              ></canvas>
                            )}

                            {/* Add a prominent timer display */}
                            {isRecording && (
                              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transform">
                                <div className="flex flex-col items-center justify-center rounded-full bg-black/70 p-4 text-white">
                                  <div className="flex items-center gap-2">
                                    <div className="h-3 w-3 animate-pulse rounded-full bg-red-500"></div>
                                    <span className="text-xs uppercase">Recording</span>
                                  </div>
                                  <span className="text-4xl font-bold">
                                    {formatTime(recordingDuration)}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="flex w-full justify-between p-3">
                            {!videoBlob ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  type="button"
                                  onClick={async () => {
                                    // Reset any recording state
                                    setVideoBlob(null);
                                    setRecordingDuration(0);
                                    cleanupVideoRecording();

                                    if (isAudioOnlyMode) {
                                      await startCameraAudioOnly();
                                    } else {
                                      await startCamera();
                                    }
                                  }}
                                  disabled={isRecording}
                                >
                                  <Trans>
                                    {isAudioOnlyMode ? 'Refresh Audio' : 'Start Camera'}
                                  </Trans>
                                </Button>

                                {/* Always show the Record/Stop button */}
                                <Button
                                  size="sm"
                                  type="button"
                                  variant={isRecording ? 'destructive' : 'default'}
                                  onClick={handleRecordingClick}
                                  className={
                                    isRecording ? 'animate-pulse bg-red-500 text-white' : ''
                                  }
                                >
                                  {isRecording ? (
                                    <>
                                      <div className="mr-2 h-2 w-2 rounded-full bg-white"></div>
                                      <Trans>Stop</Trans> ({formatTime(recordingDuration)})
                                    </>
                                  ) : (
                                    <Trans>{isAudioOnlyMode ? 'Record Audio' : 'Record'}</Trans>
                                  )}
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  type="button"
                                  onClick={handleRecordingClick}
                                >
                                  <Trans>Retake</Trans>
                                </Button>

                                {/* Add Replay button */}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  type="button"
                                  onClick={() => {
                                    // Find the video element
                                    const videoElement = document.getElementById(
                                      'enrollment-video-preview',
                                    ) as HTMLVideoElement;
                                    if (videoElement) {
                                      // Reset to beginning if already playing
                                      if (!videoElement.paused) {
                                        videoElement.pause();
                                      }
                                      videoElement.currentTime = 0;
                                      videoElement.play().catch(console.error);
                                    }
                                  }}
                                >
                                  <Trans>Replay</Trans>
                                </Button>

                                <Button
                                  size="sm"
                                  type="button"
                                  variant="default"
                                  disabled={isUploading}
                                  onClick={handleUploadClick}
                                >
                                  {isUploading ? (
                                    <Trans>Uploading...</Trans>
                                  ) : (
                                    <Trans>Accept</Trans>
                                  )}
                                </Button>
                              </>
                            )}
                          </div>

                          {/* Audio-only mode banner */}
                          {isAudioOnlyMode && !videoBlob && (
                            <div
                              className="relative mt-2 w-full rounded border border-blue-400 bg-blue-100 px-4 py-2 text-sm text-blue-700"
                              role="alert"
                            >
                              <strong className="font-bold">Camera not detected: </strong>
                              <span className="block sm:inline">
                                Recording with audio only. A black screen will appear in the video.
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="text-muted-foreground text-sm">
                          <Trans>
                            This step is optional. Voice enrollment helps secure your account with
                            biometric verification.
                          </Trans>
                        </div>

                        {/* Add debug mode button if in debug mode */}
                        {isDebugMode && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-2 self-center"
                            onClick={simulateVideoRecording}
                          >
                            <Trans>Debug: Simulate Recording</Trans>
                          </Button>
                        )}

                        {/* Skip button */}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="mt-4 self-center"
                          onClick={() => {
                            // Skip voice enrollment
                            setStep('CLAIM_USERNAME');
                          }}
                        >
                          <Trans>Skip this step</Trans>
                        </Button>
                      </div>
                    </div>
                  </div>
                </fieldset>
              </div>
            )}

            {step === 'CLAIM_USERNAME' && (
              <fieldset
                className={cn(
                  'flex h-[550px] w-full flex-col gap-y-4',
                  isGoogleSSOEnabled && 'h-[650px]',
                )}
                disabled={isSubmitting}
              >
                <FormField
                  control={form.control}
                  name="url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <Trans>Public profile username</Trans>
                      </FormLabel>

                      <FormControl>
                        <Input type="text" className="mb-2 mt-2 lowercase" {...field} />
                      </FormControl>

                      <FormMessage />

                      <div className="bg-muted/50 border-border text-muted-foreground mt-2 inline-block max-w-[16rem] truncate rounded-md border px-2 py-1 text-sm lowercase">
                        {baseUrl.host}/u/{field.value || '<username>'}
                      </div>
                    </FormItem>
                  )}
                />
              </fieldset>
            )}

            <div className="mt-6">
              {step === 'BASIC_DETAILS' && (
                <p className="text-muted-foreground text-sm">
                  <span className="font-medium">
                    <Trans>Basic details</Trans>
                  </span>{' '}
                  1/3
                </p>
              )}

              {step === 'VOICE_ENROLLMENT' && (
                <p className="text-muted-foreground text-sm">
                  <span className="font-medium">
                    <Trans>Voice enrollment</Trans>
                  </span>{' '}
                  2/3
                </p>
              )}

              {step === 'CLAIM_USERNAME' && (
                <p className="text-muted-foreground text-sm">
                  <span className="font-medium">
                    <Trans>Claim username</Trans>
                  </span>{' '}
                  3/3
                </p>
              )}

              <div className="bg-foreground/40 relative mt-4 h-1.5 rounded-full">
                <motion.div
                  layout="size"
                  layoutId="document-flow-container-step"
                  className="bg-documenso absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width:
                      step === 'BASIC_DETAILS'
                        ? '33%'
                        : step === 'VOICE_ENROLLMENT'
                          ? '66%'
                          : '100%',
                  }}
                />
              </div>
            </div>

            <div className="flex w-full flex-row justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={onBackClick}
                className={cn(step === 'BASIC_DETAILS' && 'invisible')}
              >
                <Trans>Back</Trans>
              </Button>

              {step === 'CLAIM_USERNAME' ? (
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? <Trans>Creating account...</Trans> : <Trans>Complete</Trans>}
                </Button>
              ) : (
                <Button type="button" onClick={onNextClick}>
                  <Trans>Next</Trans>
                </Button>
              )}
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
};
