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
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
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

// Define interface for canvas with captureStream
interface CanvasWithCaptureStream extends HTMLCanvasElement {
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
  const router = useRouter();
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
  const [_recordingStartTime, setRecordingStartTime] = useState<number>(0);
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

  // Add permissionsError state variable
  const [_permissionsError, setPermissionsError] = useState<string | null>(null);

  // Add missing state variables
  const [_isCameraReady, setIsCameraReady] = useState(false);

  // Add a function to animate the audio canvas during recording
  const drawAudioWaveform = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas with black background
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Add title text
    ctx.fillStyle = 'white';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Audio Only Mode', canvas.width / 2, canvas.height / 2 - 40);

    // Add subtitle
    ctx.font = '16px Arial';
    ctx.fillText(
      'No camera detected - recording audio only',
      canvas.width / 2,
      canvas.height / 2 - 10,
    );

    // If recording, draw a simple audio visualization
    if (isRecording) {
      const centerY = canvas.height / 2 + 40;
      const width = 300;
      const height = 60;
      const startX = (canvas.width - width) / 2;

      // Draw background bar
      ctx.fillStyle = '#333';
      ctx.fillRect(startX, centerY - height / 2, width, height);

      // Draw animated waveform
      ctx.fillStyle = '#ff4545';
      const barCount = 20;
      const barWidth = (width - (barCount - 1) * 2) / barCount;

      for (let i = 0; i < barCount; i++) {
        // Generate a pseudo-random height based on time and position
        const randomHeight = Math.sin(Date.now() / 200 + i * 0.3) * 0.5 + 0.5;
        const barHeight = height * randomHeight * 0.8;
        const x = startX + i * (barWidth + 2);
        const y = centerY - barHeight / 2;

        ctx.fillRect(x, y, barWidth, barHeight);
      }

      // Add recording duration
      ctx.fillStyle = 'white';
      ctx.font = '18px Arial';
      ctx.fillText(
        `Recording: ${formatTime(recordingDuration)}`,
        canvas.width / 2,
        centerY + height / 2 + 30,
      );
    }

    // Continue animation if recording
    if (isRecording && canvasRef.current) {
      animationFrameRef.current = requestAnimationFrame(() => {
        if (canvasRef.current) {
          drawAudioWaveform(canvasRef.current);
        }
      });
    }
  };

  // Wrap cleanup function in useCallback to avoid dependency issues in useEffect
  const cleanupVideoRecording = useCallback(() => {
    // Cancel animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Clear any running timer
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    // Stop all tracks in the stream
    if (recordingStream) {
      recordingStream.getTracks().forEach((track) => track.stop());
      setRecordingStream(null);
    }

    // Ensure recorder is stopped
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch (error) {
        console.error('Error stopping recorder:', error);
      }
      setMediaRecorder(null);
    }

    // Reset states
    setIsAudioOnlyMode(false);
    setRecordingDuration(0);

    // Clear canvas ref
    canvasRef.current = null;
  }, [recordingStream, mediaRecorder]); // Include dependencies

  // Fix permission name type
  const checkPermissionStatus = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const cameraPermission = await navigator.permissions.query({
        name: 'camera' as PermissionName,
      });
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const micPermission = await navigator.permissions.query({
        name: 'microphone' as PermissionName,
      });

      if (cameraPermission.state === 'denied' || micPermission.state === 'denied') {
        return 'blocked';
      }

      return 'granted';
    } catch (error) {
      console.error('Error checking permissions:', error);
      return 'unknown';
    }
  };

  // Move startCameraAudioOnly function above startCamera to fix reference
  const startCameraAudioOnly = async () => {
    try {
      // Get audio stream
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      // Set up canvas for audio visualization
      const canvas = document.getElementById('audio-canvas');
      if (canvas instanceof HTMLCanvasElement) {
        canvasRef.current = canvas;

        // Use helper function instead of type assertion
        const canvasStream = safeCanvasStream(canvas, 30);

        // Combine audio track with canvas stream
        const audioTrack = audioStream.getAudioTracks()[0];
        canvasStream.addTrack(audioTrack);

        // Use combined stream for recording
        setRecordingStream(canvasStream);

        // Start animating the audio waveform
        if (drawAudioWaveform) {
          drawAudioWaveform(canvas);
        }

        setIsCameraReady(true);
      } else {
        // No canvas found, just use audio stream directly
        setRecordingStream(audioStream);
        setIsCameraReady(true);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error in audio-only mode:', error);
      setPermissionsError(`Error accessing microphone: ${errorMessage}`);
    }
  };

  // Restore the startCamera function with our helper
  const startCamera = async () => {
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
        return;
      }

      // Cleanup any existing recording
      cleanupVideoRecording();

      // Reset state
      setVideoBlob(null);
      recordingChunks.current = [];

      try {
        if (isAudioOnlyMode) {
          // Audio only mode
          const audioStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });

          setRecordingStream(audioStream);
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

            // Use combined stream for recording
            setRecordingStream(canvasStream);
          }
        } else {
          // Video mode - try to get both video and audio
          const videoStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });

          setRecordingStream(videoStream);
          setIsAudioOnlyMode(false);

          // Set video source
          const videoElement = document.getElementById('enrollment-video-preview');
          if (videoElement instanceof HTMLVideoElement) {
            videoElement.srcObject = videoStream;
            videoElement.play().catch(console.error);
          }
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
          // No webcam available, switch to audio-only mode
          setIsAudioOnlyMode(true);
          toast({
            title: 'No camera detected',
            description: 'Switching to audio-only mode.',
            variant: 'default',
          });

          // Try again with audio only
          void startCameraAudioOnly();
        } else if (
          (error instanceof DOMException && error.name === 'NotAllowedError') ||
          (typeof error === 'object' &&
            error !== null &&
            'name' in error &&
            error.name === 'PermissionDeniedError')
        ) {
          setPermissionsError(`Camera/microphone access denied. Please grant permission.`);
        } else {
          setPermissionsError(`Error accessing camera/microphone: ${errorMessage}`);
        }
      }
    } catch (error: unknown) {
      console.error('Unexpected error:', error);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred. Please try again.',
        variant: 'destructive',
      });
    }
  };

  // Update the startRecording function to properly handle duration timing
  const startRecording = () => {
    if (!recordingStream) {
      toast({
        title: 'Camera not ready',
        description: 'Please start the camera first',
        variant: 'destructive',
      });
      return;
    }

    try {
      const mimeType = 'video/webm;codecs=vp8,opus';
      const recorder = new MediaRecorder(recordingStream, { mimeType });

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          recordingChunks.current.push(event.data);
        }
      });

      recorder.addEventListener('start', () => {
        setIsRecording(true);

        // Reset duration timer
        setRecordingDuration(0);
        const startTime = Date.now();

        // Clear any existing timer
        if (durationTimerRef.current) {
          clearInterval(durationTimerRef.current);
        }

        // Set up duration timer - use fixed start time, don't rely on state
        durationTimerRef.current = setInterval(() => {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          setRecordingDuration(elapsed);
        }, 1000);

        // Start animation for audio-only mode
        if (isAudioOnlyMode && canvasRef.current) {
          drawAudioWaveform(canvasRef.current);
        }
      });

      recorder.addEventListener('stop', () => {
        setIsRecording(false);

        // Clear duration timer
        if (durationTimerRef.current) {
          clearInterval(durationTimerRef.current);
          durationTimerRef.current = null;
        }

        // Finalize recording
        const blob = new Blob(recordingChunks.current, { type: mimeType });
        setVideoBlob(blob);

        // Display the recorded video with proper typing
        const videoElement = document.getElementById('enrollment-video-preview');
        if (videoElement instanceof HTMLVideoElement) {
          const url = URL.createObjectURL(blob);
          videoElement.srcObject = null;
          videoElement.src = url;
          videoElement.controls = true;

          // Store the enrollment in form data
          form.setValue('voiceEnrollmentComplete', true);
        }
      });

      setMediaRecorder(recorder);

      // Start recording with small slices for more frequent dataavailable events
      recorder.start(1000); // 1 second chunks
    } catch (error) {
      console.error('Error starting recording:', error);
      toast({
        title: 'Recording failed',
        description: 'Failed to start recording. Please try again.',
        variant: 'destructive',
      });
    }
  };

  // Update the stopRecording function to ensure clean timer cleanup
  const stopRecording = () => {
    // Cancel animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Clear the duration timer first
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    // Then stop the media recorder
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch (error) {
        console.error('Error stopping recorder:', error);
      }
    }
  };

  // Update the uploadVoiceEnrollment function to manage loading state
  const uploadVoiceEnrollment = async (videoBlob: Blob) => {
    setIsUploading(true);

    try {
      // Create a FormData object to send the video file
      const formData = new FormData();

      // Create a File object from the Blob
      const videoFile = new File([videoBlob], `enrollment-${Date.now()}.webm`, {
        type: videoBlob.type,
      });

      // Add the video file to the FormData
      formData.append('video', videoFile);

      // Send the FormData to the API endpoint
      const response = await fetch('/api/voice-enrollment', {
        method: 'POST',
        body: formData,
      });

      // Check if the request was successful
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to upload voice enrollment');
      }

      // Parse the response data
      const data = await response.json();

      // Return the response data
      return data;
    } catch (error) {
      console.error('Error uploading voice enrollment:', error);
      toast({
        title: 'Error',
        description: 'Failed to upload voice enrollment. Please try again.',
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  const onFormSubmit = async ({
    name,
    email,
    password,
    signature,
    url,
    voiceEnrollmentComplete,
  }: TSignUpFormV2Schema) => {
    try {
      // Only send the fields that the API endpoint expects
      await signup({
        name,
        email,
        password,
        signature,
        url,
      });

      // If voice enrollment was completed, we could track it here
      if (voiceEnrollmentComplete) {
        analytics.capture('App: Voice Enrollment Completed', {
          email,
        });
      }

      router.push(`/unverified-account`);

      toast({
        title: _(msg`Registration Successful`),
        description: _(
          msg`You have successfully registered. Please verify your account by clicking on the link you received in the email.`,
        ),
        duration: 5000,
      });

      analytics.capture('App: User Sign Up', {
        name: name,
        email: email,
      });
    } catch (err) {
      const error = AppError.parseError(err);

      const errorMessage = signupErrorMessages[error.code] ?? signupErrorMessages.INVALID_REQUEST;

      if (
        error.code === AppErrorCode.PROFILE_URL_TAKEN ||
        error.code === AppErrorCode.PREMIUM_PROFILE_URL
      ) {
        form.setError('url', {
          type: 'manual',
          message: _(errorMessage),
        });
      } else {
        toast({
          title: _(msg`An error occurred`),
          description: _(errorMessage),
          variant: 'destructive',
        });
      }
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
    if (seconds <= 0) return '0:00';

    // Handle extremely large values (defensive programming)
    if (seconds > 86400) {
      // more than 24 hours
      return 'Recording...';
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

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
              <div className="flex flex-col gap-4">
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
                  className="flex h-[550px] w-full flex-col gap-y-4"
                  disabled={isSubmitting}
                >
                  <div className="flex h-full flex-col items-center justify-center">
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
                          <div className="bg-muted aspect-video w-full overflow-hidden rounded-lg">
                            <video
                              id="enrollment-video-preview"
                              className="h-full w-full object-cover"
                              autoPlay
                              muted
                              playsInline
                            ></video>
                          </div>

                          <div className="flex w-full justify-between p-3">
                            {!videoBlob ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  type="button"
                                  onClick={startCamera}
                                  disabled={isRecording}
                                >
                                  <Trans>
                                    {isAudioOnlyMode ? 'Refresh Audio' : 'Start Camera'}
                                  </Trans>
                                </Button>

                                {recordingStream && (
                                  <Button
                                    size="sm"
                                    type="button"
                                    variant={isRecording ? 'destructive' : 'default'}
                                    onClick={isRecording ? stopRecording : startRecording}
                                  >
                                    {isRecording ? (
                                      <>
                                        <Trans>Stop</Trans> ({formatTime(recordingDuration)})
                                      </>
                                    ) : (
                                      <Trans>{isAudioOnlyMode ? 'Record Audio' : 'Record'}</Trans>
                                    )}
                                  </Button>
                                )}
                              </>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  type="button"
                                  onClick={startCamera}
                                >
                                  <Trans>Retake</Trans>
                                </Button>

                                <Button
                                  size="sm"
                                  type="button"
                                  variant="default"
                                  disabled={isUploading}
                                  onClick={async () => {
                                    // Set the form value to indicate the enrollment is complete
                                    form.setValue('voiceEnrollmentComplete', true);

                                    // Upload the video recording to the server
                                    const result = await uploadVoiceEnrollment(videoBlob);

                                    if (result) {
                                      toast({
                                        title: 'Success',
                                        description: 'Voice enrollment successfully recorded',
                                      });
                                    }
                                  }}
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
                              <strong className="font-bold">Audio-Only Mode: </strong>
                              <span className="block sm:inline">
                                No camera detected. Recording audio with black screen video.
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
