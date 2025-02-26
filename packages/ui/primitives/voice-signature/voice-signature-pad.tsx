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
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup function for timers and media resources
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

      mediaRecorder.addEventListener('stop', () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        const duration = recordingDuration;

        setAudioData({ audioBlob, duration });
        onChange?.({ audioBlob, duration });
        setIsRecording(false);
      });

      // Start recording
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);

      // Start duration timer
      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
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

    const audio = audioRef.current;
    const url = URL.createObjectURL(audioData.audioBlob);

    audio.src = url;
    audio.onended = () => {
      setIsPlaying(false);
      URL.revokeObjectURL(url);
    };

    void audio.play();
    setIsPlaying(true);
  };

  const pauseAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
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
        const duration = Math.round(audio.duration);
        const audioBlob = file;

        setAudioData({ audioBlob, duration });
        onChange?.({ audioBlob, duration });

        URL.revokeObjectURL(url);
      };

      audio.onerror = () => {
        setRecordingError(_(msg`Invalid audio file. Please try another file.`));
        URL.revokeObjectURL(url);
      };
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
                  <Trans>Voice Recording</Trans> ({formatTime(audioData.duration)})
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
