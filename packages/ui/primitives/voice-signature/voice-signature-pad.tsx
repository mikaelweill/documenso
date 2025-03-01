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
  transcriptionPromise?: Promise<string>;
};

export interface VoiceSignaturePadProps {
  className?: string;
  disabled?: boolean;
  containerClassName?: string;
  onChange?: (data: VoiceSignatureDataFormat | null) => void;
  onValidityChange?: (valid: boolean) => void;
  onTranscriptionStatusChange?: (isTranscribing: boolean) => void;
  transcribeAudioFn?: (audioBlob: Blob) => Promise<string>;
  transcript?: string | null;
  transcriptionError?: string | null;
}

export const VoiceSignaturePad = ({
  className,
  disabled = false,
  containerClassName,
  onChange,
  onValidityChange,
  onTranscriptionStatusChange,
  transcribeAudioFn,
  transcript: parentTranscript = null,
  transcriptionError: parentTranscriptionError = null,
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

  const [isTranscribing, setIsTranscribing] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const timerStartRef = useRef<number>(0);
  const playbackTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  useEffect(() => {
    if (isPlaying && audioRef.current) {
      setPlaybackPosition(0);

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

  useEffect(() => {
    if (onValidityChange) {
      onValidityChange(!!audioData && audioData.duration > 1);
    }
  }, [audioData, onValidityChange]);

  const handleTranscribeAudio = (blob: Blob) => {
    console.log('🎙️ Child: Starting background transcription');
    setIsTranscribing(true);
    onTranscriptionStatusChange?.(true);

    if (transcribeAudioFn) {
      transcribeAudioFn(blob)
        .then(() => {
          console.log('🎙️ Child: Transcription completed via parent function');
          setIsTranscribing(false);
          onTranscriptionStatusChange?.(false);
        })
        .catch((err: unknown) => {
          console.error('🎙️ Child: Transcription error via parent function:', err);
          setIsTranscribing(false);
          onTranscriptionStatusChange?.(false);
        });
    } else {
      console.warn('🎙️ No parent transcription function provided');
      setIsTranscribing(false);
      onTranscriptionStatusChange?.(false);
    }
  };

  const startRecording = async () => {
    try {
      setRecordingError(null);
      setRecordingDuration(0);

      console.log('🎙️ Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setAudioStream(stream);

      const mimeType = MediaRecorder.isTypeSupported('audio/mp3')
        ? 'audio/mp3'
        : MediaRecorder.isTypeSupported('audio/wav')
          ? 'audio/wav'
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

        const safeAudioData: VoiceSignatureDataFormat = {
          audioBlob,
          duration: safeDuration,
        };
        setAudioData(safeAudioData);
        onChange?.(safeAudioData);

        setIsRecording(false);
        timerStartRef.current = 0;

        handleTranscribeAudio(audioBlob);
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

  const playAudio = () => {
    if (!audioData || !audioRef.current) return;

    setPlaybackPosition(0);

    const audio = audioRef.current;
    const url = URL.createObjectURL(audioData.audioBlob);

    audio.src = url;

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
    if (seconds === 0) {
      return '0:00';
    }

    if (!seconds || !Number.isFinite(seconds) || seconds < 0) {
      return '0:04';
    }

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

          {isTranscribing && (
            <div className="bg-muted mt-4 rounded-md px-4 py-2">
              <p className="animate-pulse text-sm font-medium">
                <Trans>Transcribing your voice...</Trans>
              </p>
            </div>
          )}

          {parentTranscriptionError && (
            <div className="bg-destructive/10 mt-4 flex items-start gap-2 rounded-md px-4 py-2">
              <AlertCircle className="text-destructive mt-0.5 h-4 w-4 flex-shrink-0" />
              <p className="text-destructive text-sm">{parentTranscriptionError}</p>
            </div>
          )}

          {parentTranscript && (
            <div className="bg-accent/20 mt-4 rounded-md px-4 py-3">
              <p className="text-accent-foreground/70 mb-1 text-xs font-semibold uppercase">
                <Trans>Transcript</Trans>
              </p>
              <p className="text-sm">{parentTranscript}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
