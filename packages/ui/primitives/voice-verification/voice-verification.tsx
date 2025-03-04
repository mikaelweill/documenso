'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Trans, msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';
import { AlertCircle, MicIcon, ShieldCheck, ShieldX } from 'lucide-react';

import { cn } from '../../lib/utils';
import { Alert, AlertDescription, AlertTitle } from '../alert';
import { Button } from '../button';
import { Card, CardContent } from '../card';
import { Progress } from '../progress';

export type VoiceVerificationResult = {
  verified: boolean;
  score: number;
  threshold: number;
  details?: {
    recognitionResult?: string;
    errorDetails?: string;
    [key: string]: unknown;
  };
  error?: string;
};

export type VoiceVerificationDataFormat = {
  audioBlob: Blob;
  duration: number;
  verificationResult?: VoiceVerificationResult;
  verificationPromise?: Promise<VoiceVerificationResult>;
};

export interface VoiceVerificationProps {
  className?: string;
  disabled?: boolean;
  containerClassName?: string;
  onVerificationComplete?: (result: VoiceVerificationResult) => void;
  onVerifying?: (isVerifying: boolean) => void;
  userId?: number; // Optional: If not provided, will use the current user
  minRecordingSeconds?: number;
}

export const VoiceVerification = ({
  className,
  disabled = false,
  containerClassName,
  onVerificationComplete,
  onVerifying,
  userId,
  minRecordingSeconds = 4,
}: VoiceVerificationProps) => {
  const { _ } = useLingui();

  const [audioData, setAudioData] = useState<VoiceVerificationDataFormat | null>(null);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [verificationResult, setVerificationResult] = useState<VoiceVerificationResult | null>(
    null,
  );
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [_isLoading, setIsLoading] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const timerStartRef = useRef<number>(0);

  const cleanup = useCallback(() => {
    if (audioStream) {
      audioStream.getTracks().forEach((track) => track.stop());
      setAudioStream(null);
    }

    if (recorder) {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      setRecorder(null);
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setIsRecording(false);
    timerStartRef.current = 0;
  }, [audioStream, recorder]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  useEffect(() => {
    if (isRecording && timerStartRef.current > 0) {
      const timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - timerStartRef.current) / 1000);
        setRecordingDuration(elapsed);
      }, 100);

      return () => {
        clearInterval(timerInterval);
      };
    }
  }, [isRecording]);

  const verifyVoice = async (audioBlob: Blob): Promise<VoiceVerificationResult> => {
    console.log('🔒 Starting voice verification for audio blob', {
      size: audioBlob.size,
      type: audioBlob.type,
    });

    setIsVerifying(true);
    onVerifying?.(true);
    setVerificationError(null);

    try {
      // Convert blob to base64 string
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const base64 = reader.result as string;
          console.log(
            `🔒 Audio converted to base64, length: ${base64.length}, first 50 chars: ${base64.substring(0, 50)}...`,
          );
          resolve(base64);
        };
        reader.onerror = (error) => {
          console.error('🔒 Error converting audio to base64:', error);
          resolve(''); // Resolve with empty string on error
        };
      });
      reader.readAsDataURL(audioBlob);
      const base64Data = await base64Promise;

      // Check if the data is too large for a standard JSON API call
      if (base64Data.length > 5000000) {
        // 5MB limit for easy handling in JSON
        console.warn('🔒 Audio data exceeds 5MB, this may cause issues with the API');
        setVerificationError(
          'Audio recording is too large. Try a shorter recording or adjust microphone settings.',
        );

        return {
          verified: false,
          score: 0,
          threshold: 0.5,
          details: {
            error: 'Audio data too large for verification',
            size: base64Data.length,
          },
        };
      }

      // Ensure we have a valid audio MIME type in the data URI
      let processedData = base64Data;
      if (!processedData.startsWith('data:audio/')) {
        console.warn('🔒 Fixing missing audio MIME type in data URI');
        // Add proper audio MIME type prefix if missing
        processedData = `data:audio/webm;base64,${processedData.split(',')[1] || processedData}`;
      }

      // Log the detected MIME type for debugging
      const mimeType = processedData.match(/^data:([^;]+);/)?.[1] || 'unknown';
      console.log('🔒 Detected MIME type:', mimeType);

      // Send the audio to the verification API
      console.log('🔒 Sending audio to verification API...');
      const response = await fetch('/api/voice-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audioData: processedData,
          userId,
        }),
      });

      console.log('🔒 Verification API response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('🔒 Verification API error:', errorData);
        throw new Error(errorData.error || 'Failed to verify voice');
      }

      const result = await response.json();
      console.log('🔒 Verification result:', result);

      setVerificationResult(result);
      onVerificationComplete?.(result);

      return result;
    } catch (error) {
      console.error('🔒 Error verifying voice:', error);

      setVerificationError(error instanceof Error ? error.message : 'Unknown error');

      // Return default failed result
      const failedResult: VoiceVerificationResult = {
        verified: false,
        score: 0,
        threshold: 0.5,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };

      setVerificationResult(failedResult);
      onVerificationComplete?.(failedResult);

      return failedResult;
    } finally {
      setIsVerifying(false);
      onVerifying?.(false);
    }
  };

  const startRecording = async () => {
    if (isRecording || audioData) {
      return;
    }

    try {
      setIsLoading(true);
      setRecordingDuration(0);
      setVerificationResult(null);
      setVerificationError(null);
      setRecordingError(null);

      console.log('🎙️ Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1, // Mono recording for smaller file size
          sampleRate: 16000, // 16kHz as required by Azure
        },
      });
      setAudioStream(stream);

      // For Chrome and other browsers, WAV and MP3 are not typically supported
      // But we still check in case the browser supports them
      const mimeType = MediaRecorder.isTypeSupported('audio/wav')
        ? 'audio/wav'
        : MediaRecorder.isTypeSupported('audio/mp3')
          ? 'audio/mp3'
          : 'audio/webm';

      console.log(`🎙️ Using media recorder with MIME type: ${mimeType}`);

      // Set bitrate to a reasonable value to reduce file size
      const options = {
        mimeType: mimeType,
        audioBitsPerSecond: 16000, // Lower bitrate for smaller file size
      };

      const recorderInstance = new MediaRecorder(stream, options);
      setRecorder(recorderInstance);

      const audioChunks: Blob[] = [];

      recorderInstance.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          console.log(`🎙️ Received audio chunk: ${event.data.size} bytes`);
          audioChunks.push(event.data);
        }
      });

      recorderInstance.addEventListener('start', () => {
        console.log('🎙️ Recording started');
        timerStartRef.current = Date.now();
        setIsRecording(true);
      });

      recorderInstance.addEventListener('stop', () => {
        console.log('🎙️ Recording stopped');

        // Important bug fix: Save duration before resetting timer reference
        const recordingEndTime = Date.now();
        const actualDuration =
          timerStartRef.current > 0
            ? Math.floor((recordingEndTime - timerStartRef.current) / 1000)
            : recordingDuration;

        // Now reset recording state
        setIsRecording(false);
        timerStartRef.current = 0;

        // Use the actual duration or fall back to state value if calculation failed
        const safeDuration = Math.max(1, actualDuration);

        const recordedAudioBlob = new Blob(audioChunks, { type: recorderInstance.mimeType });

        console.log('🎙️ Audio recording complete:', {
          size: recordedAudioBlob.size,
          type: recordedAudioBlob.type,
          duration: safeDuration,
        });

        // Check if the audio is too small (likely a recording error)
        if (recordedAudioBlob.size < 1000) {
          console.warn(
            '🎙️ Audio recording is suspiciously small:',
            recordedAudioBlob.size,
            'bytes',
          );
          setRecordingError(
            'The recording appears to be too short or empty. Please try again with a clearer voice.',
          );
          setIsRecording(false);
          return;
        }

        const recordedAudioData: VoiceVerificationDataFormat = {
          audioBlob: recordedAudioBlob,
          duration: safeDuration,
        };

        setAudioData(recordedAudioData);

        // Automatically verify after recording
        verifyVoice(recordedAudioBlob)
          .then((result) => {
            // Create a new object to ensure React detects the change
            setAudioData({
              audioBlob: recordedAudioBlob,
              duration: safeDuration,
              verificationResult: result,
            });
          })
          .catch((error) => {
            console.error('🎙️ Verification error:', error);
            setVerificationError(error.message || 'Failed to verify voice');
          });
      });

      // Set the recorder to record in small chunks for better performance
      recorderInstance.start(200);
      setIsLoading(false);
    } catch (error) {
      console.error('🎙️ Error starting recording:', error);
      setIsLoading(false);

      // Provide specific error messages based on common issues
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
          setRecordingError(
            'Microphone access was denied. Please allow microphone access and try again.',
          );
        } else if (error.name === 'NotFoundError') {
          setRecordingError('No microphone was found. Please check your device and try again.');
        } else if (error.name === 'NotReadableError') {
          setRecordingError(
            'Your microphone is busy or not functioning properly. Please try again.',
          );
        } else {
          setRecordingError(`Recording error: ${error.message || error.name}`);
        }
      } else {
        setRecordingError(
          `Could not start recording: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }
  };

  const stopRecording = () => {
    console.log('🎙️ Stopping recording...');

    if (!recorder) {
      console.warn('🎙️ No recorder available to stop');
      return;
    }

    try {
      // Save the end time before stopping the recorder
      const recordingEndTime = Date.now();
      const actualDuration = Math.floor((recordingEndTime - timerStartRef.current) / 1000);

      console.log('🎙️ Stopping recording, elapsed time:', actualDuration);

      recorder.stop();
      console.log('🎙️ Recording stopped');

      setIsRecording(false);

      // Reset timer reference AFTER calculating duration
      timerStartRef.current = 0;

      // Use the captured duration rather than calculating it after reset
      const safeDuration = Math.max(1, actualDuration);
      console.log('🎙️ Final recording duration:', safeDuration);

      if (audioStream) {
        audioStream.getTracks().forEach((track) => track.stop());
        console.log('🎙️ Audio tracks stopped');
      }
    } catch (error) {
      console.error('🎙️ Error stopping recording:', error);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleRetry = () => {
    setAudioData(null);
    setVerificationResult(null);
    setVerificationError(null);
    setRecordingError(null);
  };

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-y-4 rounded-lg p-4',
        containerClassName,
      )}
    >
      <div className="w-full max-w-md">
        {recordingError && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{recordingError}</AlertDescription>
          </Alert>
        )}

        {verificationError && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Verification Error</AlertTitle>
            <AlertDescription>{verificationError}</AlertDescription>
          </Alert>
        )}

        {verificationResult && (
          <Alert variant={verificationResult.verified ? 'default' : 'destructive'} className="mb-4">
            {verificationResult.verified ? (
              <ShieldCheck className="h-4 w-4" />
            ) : (
              <ShieldX className="h-4 w-4" />
            )}
            <AlertTitle>
              {verificationResult.verified
                ? _(msg`Voice verified successfully`)
                : _(msg`Voice verification failed`)}
            </AlertTitle>
            <AlertDescription>
              {verificationResult.verified ? (
                _(
                  msg`Your voice has been verified with a confidence of ${Math.round(verificationResult.score * 100)}%.`,
                )
              ) : (
                <div>
                  {verificationResult.details?.errorDetails &&
                  typeof verificationResult.details.errorDetails === 'string' &&
                  verificationResult.details.errorDetails.includes('not properly enrolled') ? (
                    <div className="space-y-1">
                      <p>{_(msg`Your voice profile needs more training.`)}</p>
                      <p className="text-sm">
                        {_(
                          msg`The voice profile is still in the "Enrolling" state. Please complete the enrollment process by recording more speech samples.`,
                        )}
                      </p>
                    </div>
                  ) : (
                    <p>
                      {_(msg`We couldn't verify your voice. Please try again or contact support.`)}
                    </p>
                  )}
                  {verificationResult.details?.errorDetails && (
                    <div className="bg-destructive/10 mt-2 rounded p-2 text-xs">
                      <strong>Technical details:</strong> {verificationResult.details.errorDetails}
                    </div>
                  )}
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Card className={cn('overflow-hidden', className)}>
          <CardContent className="p-4">
            <div className="flex flex-col items-center space-y-4">
              {isRecording ? (
                <div className="flex w-full flex-col items-center space-y-2">
                  <div className="text-center font-medium">
                    <Trans>Recording in progress...</Trans>
                  </div>

                  <div className="text-2xl font-bold">{formatTime(recordingDuration)}</div>

                  <Progress
                    value={Math.min(100, (recordingDuration / minRecordingSeconds) * 100)}
                    className="h-2 w-full"
                  />

                  <div className="text-center text-xs text-gray-500">
                    {recordingDuration < minRecordingSeconds ? (
                      <Trans>
                        Please speak for at least {minRecordingSeconds} seconds to verify your
                        voice.
                      </Trans>
                    ) : recordingDuration < 20 ? (
                      <Trans>
                        Continue speaking to provide more training data. Azure recommends at least
                        20 seconds of speech for complete enrollment.
                      </Trans>
                    ) : (
                      <Trans>You can continue speaking or stop recording now.</Trans>
                    )}
                  </div>

                  <Button
                    variant="destructive"
                    className="mt-2"
                    onClick={stopRecording}
                    disabled={disabled}
                  >
                    <Trans>Stop Recording</Trans>
                  </Button>
                </div>
              ) : (
                <>
                  {isVerifying ? (
                    <div className="flex flex-col items-center space-y-2">
                      <div className="text-center font-medium">
                        <Trans>Verifying your voice...</Trans>
                      </div>
                      <Progress className="h-2 w-full" />
                    </div>
                  ) : (
                    <>
                      {!verificationResult && !audioData && (
                        <div className="flex flex-col items-center space-y-4">
                          <MicIcon className="text-primary h-16 w-16" />
                          <div className="text-center">
                            <Trans>
                              Click the button below to record your voice for verification.
                            </Trans>
                          </div>
                          <Button onClick={startRecording} disabled={disabled}>
                            <MicIcon className="mr-2 h-4 w-4" />
                            <Trans>Start Recording</Trans>
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {verificationResult && (
                <Button onClick={handleRetry} variant="outline" className="mt-2">
                  <Trans>Try Again</Trans>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {!isRecording && !isVerifying && recordingDuration > 0 && !verificationResult && (
          <div className="mt-2 flex justify-center">
            <p className="text-sm text-gray-500">
              <Trans>Recorded for {formatTime(recordingDuration)}</Trans>
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
