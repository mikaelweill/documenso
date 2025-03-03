'use client';

import { useState } from 'react';

import Link from 'next/link';

import { Trans, msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';
import { AlertTriangle, Check, Loader2, Mic } from 'lucide-react';

import { cn } from '@documenso/ui/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@documenso/ui/primitives/alert';
import { Badge } from '@documenso/ui/primitives/badge';
import { Button } from '@documenso/ui/primitives/button';
import { toast } from '@documenso/ui/primitives/use-toast';
import { VoiceEnrollmentDisplay as VoiceDisplay } from '@documenso/ui/primitives/voice-enrollment';

export interface VoiceEnrollmentDisplayProps {
  className?: string;
  videoUrl?: string | null;
  audioUrl?: string | null;
  duration?: number | null;
  enrollmentId?: string;
  voiceProfileId?: string | null;
  processingStatus?: string | null;
}

export const VoiceEnrollmentDisplay = ({
  className,
  videoUrl,
  audioUrl,
  duration,
  enrollmentId,
  voiceProfileId,
  processingStatus,
}: VoiceEnrollmentDisplayProps) => {
  const { _ } = useLingui();
  const hasEnrollment = Boolean(videoUrl || audioUrl);
  const hasProfile = Boolean(voiceProfileId);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);

  // Handle creating a voice profile
  const handleCreateProfile = async () => {
    if (!enrollmentId) {
      toast({
        title: 'Error',
        description: 'No enrollment ID provided',
        variant: 'destructive',
      });
      return;
    }

    setIsCreatingProfile(true);

    try {
      console.log(`Creating voice profile for enrollment ID: ${enrollmentId}`);

      const response = await fetch('/api/voice-enrollment/create-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enrollmentId }),
      });

      // Log response status for debugging
      console.log(`API response status: ${response.status}`);

      // Parse response data
      const data = await response.json();
      console.log('API response data:', data);

      if (!response.ok) {
        const errorMessage = data.message || data.error || 'Failed to create voice profile';
        console.error(`API error: ${errorMessage}`);
        throw new Error(errorMessage);
      }

      toast({
        title: 'Success',
        description: data.message || 'Voice profile created successfully',
      });

      // Reload the page to reflect the updated profile status
      window.location.reload();
    } catch (error) {
      console.error('Error creating voice profile:', error);

      // More detailed error message
      let errorMessage = 'Failed to create voice profile';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (error && typeof error === 'object' && 'toString' in error) {
        errorMessage = error.toString();
      }

      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsCreatingProfile(false);
    }
  };

  // Render profile status badge
  const renderStatusBadge = () => {
    if (!hasEnrollment) return null;

    if (hasProfile) {
      return (
        <Badge variant="secondary" className="mb-4 bg-green-100 text-green-800 hover:bg-green-100">
          <Check className="mr-1 h-3 w-3" />
          Verified
        </Badge>
      );
    }

    if (processingStatus === 'AUDIO_EXTRACTED') {
      return (
        <Badge variant="secondary" className="mb-4">
          Ready for verification
        </Badge>
      );
    }

    if (processingStatus?.includes('ERROR')) {
      return (
        <Badge variant="destructive" className="mb-4">
          Error
        </Badge>
      );
    }

    return (
      <Badge variant="secondary" className="mb-4">
        {processingStatus || 'Processing'}
      </Badge>
    );
  };

  return (
    <div className={cn('w-full', className)}>
      {renderStatusBadge()}

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
        <div className="mt-4 flex flex-wrap items-center gap-4">
          {/* Show profile creation button if there's audio but no profile */}
          {hasEnrollment && !hasProfile && audioUrl && (
            <Button onClick={handleCreateProfile} disabled={isCreatingProfile} variant="default">
              {isCreatingProfile ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating profile...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Get Verified
                </>
              )}
            </Button>
          )}

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
