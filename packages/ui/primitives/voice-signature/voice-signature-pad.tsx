'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Trans, msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';
import { AlertCircle, MicIcon, Pause, Play, Square } from 'lucide-react';

import { cn } from '../../lib/utils';
import { Button } from '../button';
import { Card, CardContent } from '../card';

export type VoiceSignatureDataFormat = {
  audioBlob: Blob;
  duration: number;
  transcript?: string;
};

export interface VoiceSignaturePadProps {
  className?: string;
  disabled?: boolean;
  containerClassName?: string;
  onChange?: (data: VoiceSignatureDataFormat | null) => void;
  onValidityChange?: (valid: boolean) => void;
}

export const VoiceSignaturePad = ({
  className,
  disabled = false,
  containerClassName,
  onChange,
  onValidityChange,
}: VoiceSignaturePadProps) => {
  const { _ } = useLingui();

  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [audioData, setAudioData] = useState<VoiceSignatureDataFormat | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  // New states for transcription
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const timerStartRef = useRef<number>(0);
  const playbackTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup function for timers and media resources
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (playbackTimerRef.current) {
      clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
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

  // Update timer regularly while recording
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

  // Update playback timer when playing
  useEffect(() => {
    if (isPlaying && audioRef.current) {
      // Force playback position to 0 at start
      setPlaybackPosition(0);

      // Update playback position every 100ms
      const playbackInterval = setInterval(() => {
        if (audioRef.current) {
          const position = Math.floor(audioRef.current.currentTime);
          setPlaybackPosition(Number.isFinite(position) ? position : 0);
        }
      }, 100);

      playbackTimerRef.current = playbackInterval;

      return () => {
        if (playbackTimerRef.current) {
          clearInterval(playbackTimerRef.current);
          playbackTimerRef.current = null;
        }
      };
    }
  }, [isPlaying]);

  // Update validity when audio data changes
  useEffect(() => {
    if (onValidityChange) {
      // Audio is valid if it exists and is longer than 1 second
      onValidityChange(!!audioData && audioData.duration > 1);
    }
  }, [audioData, onValidityChange]);

  // New function to transcribe audio using the Whisper API
  const transcribeAudio = async (blob: Blob) => {
    console.log('🎙️ Starting transcription for audio blob', { size: blob.size, type: blob.type });
    setIsTranscribing(true);
    setTranscriptionError(null);

    try {
      // Create form data for the API request
      const formData = new FormData();
      formData.append('audio', blob);

      console.log('🎙️ Sending audio to transcription API...');
      // Send audio to our transcription API
      const response = await fetch('/api/voice-transcription', {
        method: 'POST',
        body: formData,
      });

      console.log('🎙️ Transcription API response status:', response.status);

      if (!response.ok) {
        let errorMessage = `Transcription failed: ${response.statusText}`;

        try {
          const errorData = await response.json();
          console.error('🎙️ Transcription API error:', errorData);
          errorMessage = `${errorMessage}${errorData?.error ? ` - ${errorData.error}` : ''}`;
        } catch (jsonError) {
          console.error('🎙️ Failed to parse error response as JSON:', jsonError);
          // Try to get text content as fallback
          const textContent = await response.text().catch(() => null);
          if (textContent) {
            errorMessage = `${errorMessage} - Raw response: ${textContent.substring(0, 100)}`;
          }
        }

        throw new Error(errorMessage);
      }

      console.log('🎙️ Processing transcription response...');
      let responseData;
      try {
        responseData = await response.json();
      } catch (jsonError) {
        console.error('🎙️ Failed to parse success response as JSON:', jsonError);
        // Try to get text content as fallback
        const textContent = await response.text().catch(() => null);
        throw new Error(
          `Failed to parse transcription response as JSON. Raw response: ${textContent?.substring(0, 100) || 'empty'}`,
        );
      }

      if (responseData.transcript) {
        console.log(
          '🎙️ Transcription successful:',
          responseData.transcript.substring(0, 50) + '...',
        );
        setTranscript(responseData.transcript);

        // Update the audio data with the transcript
        if (audioData) {
          const updatedAudioData = {
            ...audioData,
            transcript: responseData.transcript,
          };

          setAudioData(updatedAudioData);
          onChange?.(updatedAudioData);
        }
      } else {
        console.error('🎙️ No transcript in response data:', responseData);
        throw new Error('No transcript returned from API');
      }
    } catch (error) {
      console.error('🎙️ Transcription error:', error);
      setTranscriptionError(
        _(
          msg`Failed to transcribe audio. Please try again. (${error instanceof Error ? error.message : 'Unknown error'})`,
        ),
      );
    } finally {
      setIsTranscribing(false);
    }
  };

  const startRecording = async () => {
    try {
      setRecordingError(null);
      setRecordingDuration(0);
      setTranscript(null);
      setTranscriptionError(null);

      // Request microphone access
      console.log('🎙️ Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setAudioStream(stream);

      // Create media recorder
      const mediaRecorder = new MediaRecorder(stream);
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
        // Calculate actual duration based on recording time
        const actualDuration = Math.floor((Date.now() - timerStartRef.current) / 1000);
        // Ensure we have at least 1 second minimum for valid display
        const safeDuration = Math.max(1, actualDuration);
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

        console.log('🎙️ Audio recording complete:', {
          size: audioBlob.size,
          type: audioBlob.type,
          duration: safeDuration,
        });

        // Set reliable duration immediately
        const safeAudioData = { audioBlob, duration: safeDuration };
        setAudioData(safeAudioData);
        onChange?.(safeAudioData);

        // Clean up resources
        setIsRecording(false);
        timerStartRef.current = 0;

        // Start transcription in the background without Promise-related errors
        handleTranscribeAudio(audioBlob);
      });

      // Start recording
      console.log('🎙️ Starting media recorder');
      mediaRecorder.start();
    } catch (error) {
      console.error('🎙️ Error accessing microphone:', error);
      setRecordingError(
        _(msg`Microphone access denied. Please grant permission to use the microphone.`),
      );
    }
  };

  // Helper function to handle transcription without async/await in event handlers
  const handleTranscribeAudio = (blob: Blob) => {
    console.log('🎙️ Starting background transcription');
    setIsTranscribing(true);

    transcribeAudio(blob)
      .then(() => {
        console.log('🎙️ Background transcription completed successfully');
      })
      .catch((err: unknown) => {
        console.error('🎙️ Transcription background process error:', err);
        setTranscriptionError(
          _(
            msg`Transcription failed in the background. You can still save your recording, but without a transcript.`,
          ),
        );
      });
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

  const playAudio = () => {
    if (!audioData || !audioRef.current) return;

    // Reset playback position to 0
    setPlaybackPosition(0);

    const audio = audioRef.current;
    const url = URL.createObjectURL(audioData.audioBlob);

    audio.src = url;

    // No need to set duration - we're using a fixed value in the display
    void audio.play();
    setIsPlaying(true);

    audio.onended = () => {
      setIsPlaying(false);
      setPlaybackPosition(0);
      URL.revokeObjectURL(url);

      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
    };
  };

  const pauseAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);

      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
    }
  };

  const formatTime = (seconds: number) => {
    // Special case for playback position - 0 is valid
    if (seconds === 0) {
      return '0:00';
    }

    // Handle invalid cases - NaN, Infinity, negative numbers, etc.
    if (!seconds || !Number.isFinite(seconds) || seconds < 0) {
      return '0:04'; // Default fallback time
    }

    // Cap at a reasonable maximum to prevent weird values
    const secs = Math.min(600, Math.floor(seconds));
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins}:${remainingSecs < 10 ? '0' : ''}${remainingSecs}`;
  };

  return (
    <div className={cn('w-full', containerClassName)}>
      <Card className={cn('relative overflow-hidden', className)}>
        <CardContent className="flex flex-col p-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              {audioData ? (
                <>
                  <span className="font-medium">
                    <Trans>Voice Recording</Trans>
                    {isPlaying
                      ? ` (${formatTime(playbackPosition)}/${formatTime(audioData?.duration)})`
                      : ` (${formatTime(audioData?.duration)})`}
                  </span>
                  <audio ref={audioRef} className="hidden" />
                </>
              ) : (
                <span className="font-medium">
                  {isRecording ? (
                    <Trans>Recording... {formatTime(recordingDuration)}</Trans>
                  ) : (
                    <Trans>Click to record your voice</Trans>
                  )}
                </span>
              )}

              {recordingError && (
                <span className="text-destructive mt-1 text-sm">{recordingError}</span>
              )}
            </div>

            <div className="flex gap-2">
              {audioData ? (
                <>
                  {isPlaying ? (
                    <Button size="sm" variant="outline" onClick={pauseAudio} disabled={disabled}>
                      <Pause className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={playAudio} disabled={disabled}>
                      <Play className="h-4 w-4" />
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setAudioData(null);
                      setPlaybackPosition(0);
                      setTranscript(null);
                      onChange?.(null);
                    }}
                    disabled={disabled}
                  >
                    <Trans>Clear</Trans>
                  </Button>
                </>
              ) : (
                <>
                  {isRecording ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={stopRecording}
                      disabled={disabled}
                    >
                      <Square className="mr-2 h-4 w-4" />
                      <Trans>Stop</Trans>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={startRecording}
                      disabled={disabled}
                    >
                      <MicIcon className="mr-2 h-4 w-4" />
                      <Trans>Record</Trans>
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Transcription UI */}
          {isTranscribing && (
            <div className="bg-muted mt-4 rounded-md px-4 py-2">
              <p className="animate-pulse text-sm font-medium">
                <Trans>Transcribing your voice...</Trans>
              </p>
            </div>
          )}

          {transcriptionError && (
            <div className="bg-destructive/10 mt-4 flex items-start gap-2 rounded-md px-4 py-2">
              <AlertCircle className="text-destructive mt-0.5 h-4 w-4 flex-shrink-0" />
              <p className="text-destructive text-sm">{transcriptionError}</p>
            </div>
          )}

          {transcript && (
            <div className="bg-accent/20 mt-4 rounded-md px-4 py-3">
              <p className="text-accent-foreground/70 mb-1 text-xs font-semibold uppercase">
                <Trans>Transcript</Trans>
              </p>
              <p className="text-sm">{transcript}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
