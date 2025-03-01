'use client';

import { useState } from 'react';

import { Trans } from '@lingui/macro';
import { MicIcon } from 'lucide-react';

import { cn } from '../../lib/utils';
import { Button } from '../button';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';
import { VoiceSignaturePlayer } from '../voice-signature/voice-signature-player';

export interface VoiceSignatureDisplayProps {
  signatureId: string;
  voiceSignatureUrl?: string | null;
  voiceSignatureTranscript?: string | null;
  className?: string;
}

export const VoiceSignatureDisplay = ({
  signatureId,
  voiceSignatureUrl,
  voiceSignatureTranscript,
  className,
}: VoiceSignatureDisplayProps) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!voiceSignatureUrl) {
    return null;
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('flex items-center gap-1', className)}>
          <MicIcon className="h-3 w-3" />
          <Trans>Play Voice</Trans>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <VoiceSignaturePlayer
          voiceSignatureUrl={voiceSignatureUrl}
          voiceSignatureTranscript={voiceSignatureTranscript}
        />
      </PopoverContent>
    </Popover>
  );
};
