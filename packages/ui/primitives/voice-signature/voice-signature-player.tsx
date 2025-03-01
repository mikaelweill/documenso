'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Trans } from '@lingui/macro';
import { MicIcon, Pause, Play } from 'lucide-react';

import { cn } from '../../lib/utils';
import { Badge } from '../badge';
import { Button } from '../button';
import { Card, CardContent } from '../card';

export interface VoiceSignaturePlayerProps {
  voiceSignatureUrl: string; // Base64 encoded audio data
  voiceSignatureTranscript?: string | null;
  className?: string;
}

export const VoiceSignaturePlayer = ({
  voiceSignatureUrl,
  voiceSignatureTranscript,
  className,
}: VoiceSignaturePlayerProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Handle play/pause toggle
  const togglePlayback = useCallback(() => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      void audioRef.current.play();
    }
  }, [isPlaying]);

  // Update time display during playback
  const startTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
      }
    }, 100);
  }, []);

  // Format time as MM:SS
  const formatTime = useCallback((time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, []);

  // Handle audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setIsLoaded(true);
      setDuration(audio.duration);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      startTimer();
    };

    const handlePause = () => {
      setIsPlaying(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };

    const handleError = () => {
      setError('Failed to load audio');
      setIsPlaying(false);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [startTimer]);

  return (
    <Card className={cn('overflow-hidden border', className)}>
      <CardContent className="p-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-muted/30">
              <MicIcon className="mr-1 h-3 w-3" />
              <Trans>Voice Signature</Trans>
            </Badge>
          </div>

          {voiceSignatureTranscript && (
            <div className="bg-muted/20 mt-2 rounded-md p-3 text-sm italic">
              "{voiceSignatureTranscript}"
            </div>
          )}

          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 rounded-full p-0"
              onClick={togglePlayback}
              disabled={!isLoaded || !!error}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>

            <div className="text-muted-foreground flex-1 text-right text-xs">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          </div>

          {error && <div className="text-destructive mt-1 text-xs">{error}</div>}
        </div>

        <audio ref={audioRef} src={voiceSignatureUrl} preload="metadata" className="hidden" />
      </CardContent>
    </Card>
  );
};
