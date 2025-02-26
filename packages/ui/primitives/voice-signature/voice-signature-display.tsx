'use client';

import { useEffect, useRef, useState } from 'react';

import { Trans } from '@lingui/macro';
import { Pause, Play } from 'lucide-react';

import { cn } from '@documenso/ui/lib/utils';
import { Button } from '@documenso/ui/primitives/button';

export type VoiceSignatureDisplayProps = {
  audioUrl: string;
  transcript?: string;
  className?: string;
};

export const VoiceSignatureDisplay = ({
  audioUrl,
  transcript,
  className,
}: VoiceSignatureDisplayProps) => {
  const $audioElement = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const togglePlayback = () => {
    if ($audioElement.current) {
      if (isPlaying) {
        $audioElement.current.pause();
      } else {
        void $audioElement.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  // Handle audio playback ended event
  useEffect(() => {
    const handleEnded = () => {
      setIsPlaying(false);
    };

    if ($audioElement.current) {
      $audioElement.current.addEventListener('ended', handleEnded);
    }

    return () => {
      if ($audioElement.current) {
        $audioElement.current.removeEventListener('ended', handleEnded);
      }
    };
  }, []);

  return (
    <div className={cn('flex w-full flex-col items-center justify-center gap-2 p-2', className)}>
      {/* Audio player (hidden) */}
      <audio ref={$audioElement} src={audioUrl} className="hidden" />

      {/* Voice signature visualization */}
      <div className="flex h-8 w-full items-center justify-center">
        <div className="bg-primary/20 flex h-4 w-full rounded-md">
          {/* Simple representation of audio waveform - static in this case */}
          <div className="border-primary flex w-full items-end justify-around p-0.5">
            {Array(20)
              .fill(0)
              .map((_, i) => {
                const height = Math.abs(Math.sin((i + 1) * 0.5)) * 100;
                return (
                  <div
                    key={`bar-${i}`}
                    className="bg-primary mx-[1px] w-[2px]"
                    style={{ height: `${height}%` }}
                  />
                );
              })}
          </div>
        </div>
      </div>

      {/* Playback control */}
      <Button type="button" variant="secondary" size="sm" onClick={togglePlayback} className="mt-1">
        {isPlaying ? (
          <>
            <Pause className="mr-1 h-3 w-3" />
            <Trans>Pause</Trans>
          </>
        ) : (
          <>
            <Play className="mr-1 h-3 w-3" />
            <Trans>Play Voice</Trans>
          </>
        )}
      </Button>

      {/* Transcript if available */}
      {transcript && (
        <div className="text-muted-foreground mt-1 max-h-10 w-full overflow-y-auto text-center text-xs">
          "{transcript}"
        </div>
      )}
    </div>
  );
};
