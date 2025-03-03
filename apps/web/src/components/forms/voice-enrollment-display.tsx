'use client';

import Link from 'next/link';

import { Trans, msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';
import { AlertTriangle, Mic } from 'lucide-react';

import { cn } from '@documenso/ui/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@documenso/ui/primitives/alert';
import { Button } from '@documenso/ui/primitives/button';
import { VoiceEnrollmentDisplay as VoiceDisplay } from '@documenso/ui/primitives/voice-enrollment';

export interface VoiceEnrollmentDisplayProps {
  className?: string;
  videoUrl?: string | null;
  audioUrl?: string | null;
  duration?: number | null;
}

export const VoiceEnrollmentDisplay = ({
  className,
  videoUrl,
  audioUrl,
  duration,
}: VoiceEnrollmentDisplayProps) => {
  const { _ } = useLingui();
  const hasEnrollment = Boolean(videoUrl || audioUrl);

  return (
    <div className={cn('w-full', className)}>
      <VoiceDisplay videoUrl={videoUrl} audioUrl={audioUrl} duration={duration} className="mb-4" />

      {!hasEnrollment ? (
        <Alert variant="warning" className="mt-2">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            <Trans>No voice enrollment found</Trans>
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-4">
            <p>
              <Trans>
                You haven't completed voice enrollment yet. Voice enrollment helps verify your
                identity when signing documents with voice signatures.
              </Trans>
            </p>

            <Button asChild className="w-fit">
              <Link href="/voice-enrollment">
                <Mic className="mr-2 h-4 w-4" />
                {_(msg`Complete Voice Enrollment`)}
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="mt-4 flex justify-end">
          <Button asChild variant="outline">
            <Link href="/voice-enrollment">
              <Mic className="mr-2 h-4 w-4" />
              {_(msg`Update Voice Enrollment`)}
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
};
