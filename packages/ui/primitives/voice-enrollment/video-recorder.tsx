'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Trans, msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';
import { Camera, CheckCircle, Square, Video } from 'lucide-react';

import { cn } from '../../lib/utils';
import { Button } from '../button';
import { Card, CardContent } from '../card';

export type VideoRecorderDataFormat = {
  videoBlob: Blob;
  duration: number;
  previewUrl: string;
};

export interface VideoRecorderProps {
  className?: string;
  disabled?: boolean;
  containerClassName?: string;
  onChange?: (data: VideoRecorderDataFormat | null) => void;
  onValidityChange?: (valid: boolean) => void;
  requiredPhrase?: string;
}

export const VideoRecorder = ({
  className,
  disabled = false,
  containerClassName,
  onChange,
  onValidityChange,
  requiredPhrase,
}: VideoRecorderProps) => {
  const { _ } = useLingui();

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [videoData, setVideoData] = useState<VideoRecorderDataFormat | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const timerStartRef = useRef<number>(0);
  const chunksRef = useRef<Blob[]>([]);

  // Cleanup function for stopping streams and recorders
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch (error) {
        console.error('Error stopping recorder:', error);
      }
    }
  }, [stream, recorder]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // Setup camera access - wrap in useCallback to avoid dependency issues
  const setupCamera = useCallback(async () => {
    try {
      if (disabled) {
        return;
      }

      setIsInitializing(true);
      setPermissionDenied(false);
      setError('');

      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        setStream(videoStream);

        if (videoRef.current) {
          videoRef.current.srcObject = videoStream;
          await videoRef.current.play();
        }

        setIsInitialized(true);

        if (onValidityChange) {
          onValidityChange(false);
        }
      } catch (error) {
        console.error('Error accessing media devices:', error);
        setError(
          `Camera access error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        setPermissionDenied(true);
      } finally {
        setIsInitializing(false);
      }
    } catch (error) {
      console.error('Error in setupCamera:', error);
      setIsInitializing(false);
    }
  }, [disabled, onValidityChange]);

  // Start recording
  const startRecording = useCallback(() => {
    if (!stream || !isCameraReady) {
      console.error('📹 Stream or camera not ready');
      return;
    }

    try {
      setRecordingDuration(0);
      chunksRef.current = [];

      const mimeType = 'video/webm;codecs=vp8,opus';
      console.log(`📹 Using media recorder with MIME type: ${mimeType}`);

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      setRecorder(mediaRecorder);

      mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });

      mediaRecorder.addEventListener('start', () => {
        console.log('📹 Recording started');
        timerStartRef.current = Date.now();
        setIsRecording(true);

        // Setup timer for duration
        timerRef.current = setInterval(() => {
          const elapsed = Math.floor((Date.now() - timerStartRef.current) / 1000);
          setRecordingDuration(elapsed);
        }, 500);
      });

      mediaRecorder.addEventListener('stop', () => {
        console.log('📹 Recording stopped');

        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        const actualDuration = Math.floor((Date.now() - timerStartRef.current) / 1000);
        const safeDuration = Math.max(1, actualDuration);

        const videoBlob = new Blob(chunksRef.current, { type: mimeType });
        const previewUrl = URL.createObjectURL(videoBlob);

        console.log('📹 Video recording complete:', {
          size: videoBlob.size,
          type: videoBlob.type,
          duration: safeDuration,
        });

        const safeVideoData: VideoRecorderDataFormat = {
          videoBlob,
          duration: safeDuration,
          previewUrl,
        };

        setVideoData(safeVideoData);
        onChange?.(safeVideoData);
        setIsRecording(false);
        timerStartRef.current = 0;

        if (previewRef.current) {
          previewRef.current.src = previewUrl;
          previewRef.current.controls = true;
        }
      });

      console.log('📹 Starting media recorder');
      mediaRecorder.start();
    } catch (error) {
      console.error('📹 Error starting recording:', error);
      setRecordingError(_(msg`Failed to start recording. Please try again.`));
    }
  }, [stream, isCameraReady, onChange, _]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (recorder && recorder.state !== 'inactive') {
      console.log('📹 Stopping recording');
      recorder.stop();
    }
  }, [recorder]);

  // Reset recording
  const reset = async () => {
    if (videoRef.current) {
      if (videoRef.current.srcObject) {
        // Safe because we know srcObject is a MediaStream in this context
        const videoStream = videoRef.current.srcObject;
        if (videoStream instanceof MediaStream) {
          videoStream.getTracks().forEach((track) => track.stop());
        }
        videoRef.current.srcObject = null;
      }
    }

    if (previewRef.current) {
      if (previewRef.current.src) {
        URL.revokeObjectURL(previewRef.current.src);
      }
      previewRef.current.src = '';
      previewRef.current.controls = false;
    }

    // Use the null assertion for onChange to fix TypeScript error
    onChange?.(null);

    // Await the setupCamera call or handle the promise explicitly
    try {
      await setupCamera();
    } catch (error) {
      console.error('Error setting up camera after reset:', error);
    }
  };

  // Format time display
  const formatTime = (seconds: number) => {
    if (!seconds || !Number.isFinite(seconds) || seconds < 0) {
      return '0:00';
    }

    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Initialize camera on first render
  useEffect(() => {
    let mounted = true;

    if (!disabled) {
      // Use void to explicitly ignore the promise
      void setupCamera().catch((error) => {
        if (mounted) {
          console.error('Error setting up camera on mount:', error);
        }
      });
    }

    return () => {
      mounted = false;
      cleanup();
    };
  }, [setupCamera, disabled, cleanup]);

  // Update validity when videoData changes
  useEffect(() => {
    if (onValidityChange) {
      onValidityChange(!!videoData && videoData.duration > 3);
    }
  }, [videoData, onValidityChange]);

  return (
    <div className={cn('w-full', containerClassName)}>
      <Card className={cn('relative overflow-hidden', className)}>
        <CardContent className="flex flex-col p-4">
          <div className="flex flex-col gap-4">
            {requiredPhrase && (
              <div className="bg-muted rounded-md p-3 text-sm">
                <p className="mb-1 font-medium">
                  <Trans>Please say the following phrase:</Trans>
                </p>
                <p className="italic">"{requiredPhrase}"</p>
              </div>
            )}

            <div className="relative aspect-video w-full overflow-hidden rounded-md bg-gray-100">
              {!videoData ? (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={cn(
                      'absolute inset-0 h-full w-full object-cover',
                      !isCameraReady && 'opacity-0',
                    )}
                  />

                  {!isCameraReady && !recordingError && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-t-2 border-gray-900"></div>
                    </div>
                  )}
                </>
              ) : (
                <video
                  ref={previewRef}
                  playsInline
                  className="absolute inset-0 h-full w-full object-cover"
                />
              )}

              {isRecording && (
                <div className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-red-500 px-2 py-1 text-xs font-medium text-white">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-white" />
                  <span>
                    <Trans>REC</Trans> {formatTime(recordingDuration)}
                  </span>
                </div>
              )}
            </div>

            {recordingError && <div className="text-destructive text-sm">{recordingError}</div>}

            <div className="mt-2 flex justify-between gap-2">
              {!videoData ? (
                <>
                  {isRecording ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={stopRecording}
                      disabled={disabled || !isCameraReady}
                    >
                      <Square className="mr-2 h-4 w-4" />
                      <Trans>Stop</Trans>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={startRecording}
                      disabled={disabled || !isCameraReady}
                    >
                      <Camera className="mr-2 h-4 w-4" />
                      <Trans>Record</Trans>
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Button size="sm" variant="secondary" onClick={reset} disabled={disabled}>
                    <Video className="mr-2 h-4 w-4" />
                    <Trans>Retake</Trans>
                  </Button>

                  <Button size="sm" variant="default" disabled={disabled}>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    <Trans>Use this recording</Trans>
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
