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
    [key: string]: unknown;
  };
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

  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [audioData, setAudioData] = useState<VoiceVerificationDataFormat | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<VoiceVerificationResult | null>(
    null,
  );
  const [verificationError, setVerificationError] = useState<string | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const timerStartRef = useRef<number>(0);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (audioStream) {
      audioStream.getTracks().forEach((track) => track.stop());
      setAudioStream(null);
    }

    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      setRecorder(null);
    }
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
      const formData = new FormData();
      formData.append('audioData', audioBlob);

      if (userId) {
        formData.append('userId', userId.toString());
      }

      console.log('🔒 Sending audio to verification API...');
      const response = await fetch('/api/voice-verification', {
        method: 'POST',
        body: formData,
      });

      console.log('🔒 Verification API response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errorData.message || 'Verification failed');
      }

      const result = await response.json();
      console.log('🔒 Verification result:', result);

      const verificationResult: VoiceVerificationResult = {
        verified: result.verified,
        score: result.score,
        threshold: result.threshold,
        details: result.details || {},
      };

      setVerificationResult(verificationResult);
      onVerificationComplete?.(verificationResult);

      return verificationResult;
    } catch (error) {
      console.error('🔒 Voice verification error:', error);

      const errorMessage =
        error instanceof Error ? error.message : 'An error occurred during voice verification';

      setVerificationError(errorMessage);

      const failedResult: VoiceVerificationResult = {
        verified: false,
        score: 0,
        threshold: 0.5,
        details: { error: errorMessage },
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
    try {
      setRecordingError(null);
      setRecordingDuration(0);
      setVerificationResult(null);
      setVerificationError(null);

      console.log('🎙️ Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setAudioStream(stream);

      const mimeType = MediaRecorder.isTypeSupported('audio/wav')
        ? 'audio/wav'
        : MediaRecorder.isTypeSupported('audio/mp3')
          ? 'audio/mp3'
          : 'audio/webm';

      console.log(`🎙️ Using media recorder with MIME type: ${mimeType}`);
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      setRecorder(mediaRecorder);

      const audioChunks: Blob[] = [];

      mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      });

      mediaRecorder.addEventListener('start', () => {
        console.log('🎙️ Recording started');
        timerStartRef.current = Date.now();
        setIsRecording(true);
      });

      mediaRecorder.addEventListener('stop', () => {
        console.log('🎙️ Recording stopped');
        const actualDuration = Math.floor((Date.now() - timerStartRef.current) / 1000);
        const safeDuration = Math.max(1, actualDuration);

        const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });

        console.log('🎙️ Audio recording complete:', {
          size: audioBlob.size,
          type: audioBlob.type,
          duration: safeDuration,
        });

        const safeAudioData: VoiceVerificationDataFormat = {
          audioBlob,
          duration: safeDuration,
        };

        setAudioData(safeAudioData);
        setIsRecording(false);
        timerStartRef.current = 0;

        // Start verification process
        const verificationPromise = verifyVoice(audioBlob);

        safeAudioData.verificationPromise = verificationPromise;

        // Update state with promise
        setAudioData(safeAudioData);
      });

      console.log('🎙️ Starting media recorder');
      mediaRecorder.start();
    } catch (error) {
      console.error('🎙️ Error accessing microphone:', error);
      setRecordingError(
        _(msg`Microphone access denied. Please grant permission to use the microphone.`),
      );
    }
  };

  const stopRecording = () => {
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (audioStream) {
      audioStream.getTracks().forEach((track) => track.stop());
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
              {verificationResult.verified
                ? _(
                    msg`Your voice has been verified with a confidence of ${Math.round(verificationResult.score * 100)}%.`,
                  )
                : _(msg`We couldn't verify your voice. Please try again or contact support.`)}
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
