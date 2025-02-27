'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Trans, msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';
import { MicIcon, Pause, Play, Square, Upload } from 'lucide-react';

import { cn } from '../../lib/utils';
import { Button } from '../button';
import { Card, CardContent } from '../card';

export type VoiceSignatureDataFormat = {
  audioBlob: Blob;
  duration: number;
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

  const startRecording = async () => {
    try {
      setRecordingError(null);
      setRecordingDuration(0);

      // Request microphone access
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
        timerStartRef.current = Date.now();
        setIsRecording(true);
      });

      mediaRecorder.addEventListener('stop', () => {
        // Calculate actual duration based on recording time
        const actualDuration = Math.floor((Date.now() - timerStartRef.current) / 1000);
        // Ensure we have at least 1 second minimum for valid display
        const safeDuration = Math.max(1, actualDuration);
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });

        // Set reliable duration immediately
        const safeAudioData = { audioBlob, duration: safeDuration };
        setAudioData(safeAudioData);
        onChange?.(safeAudioData);

        // Clean up resources
        setIsRecording(false);
        timerStartRef.current = 0;
      });

      // Start recording
      mediaRecorder.start();
    } catch (error) {
      console.error('Error accessing microphone:', error);
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

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (file) {
      // Handle audio file upload
      if (!file.type.startsWith('audio/')) {
        setRecordingError(_(msg`Please upload an audio file.`));
        return;
      }

      const audio = new Audio();
      const url = URL.createObjectURL(file);

      audio.src = url;
      audio.onloadedmetadata = () => {
        // Get duration with fallback for invalid values
        let duration = 0;

        try {
          // Try to get audio duration, default to 10 seconds if not available
          duration =
            Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration) : 10;
        } catch (e) {
          duration = 10; // Fallback duration
        }

        // Ensure we have a reasonable duration value
        const safeDuration = Math.max(1, Math.min(600, duration));
        const audioBlob = file;

        setAudioData({ audioBlob, duration: safeDuration });
        onChange?.({ audioBlob, duration: safeDuration });

        URL.revokeObjectURL(url);
      };

      audio.onerror = () => {
        setRecordingError(_(msg`Invalid audio file. Please try another file.`));
        URL.revokeObjectURL(url);
      };

      // Add a fallback if metadata doesn't load
      setTimeout(() => {
        if (!audioData) {
          const fallbackDuration = 10;
          setAudioData({ audioBlob: file, duration: fallbackDuration });
          onChange?.({ audioBlob: file, duration: fallbackDuration });
          URL.revokeObjectURL(url);
        }
      }, 1000);
    }
  };

  return (
    <div className={cn('w-full', containerClassName)}>
      <Card className={cn('relative overflow-hidden', className)}>
        <CardContent className="flex items-center justify-between p-4">
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
                  <Trans>Click to record or upload</Trans>
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

                <div className="relative">
                  <Button size="sm" variant="outline" disabled={disabled} asChild>
                    <label>
                      <Upload className="mr-2 h-4 w-4" />
                      <Trans>Upload</Trans>
                      <input
                        type="file"
                        accept="audio/*"
                        className="absolute inset-0 cursor-pointer opacity-0"
                        onChange={handleFileUpload}
                        disabled={disabled}
                      />
                    </label>
                  </Button>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
