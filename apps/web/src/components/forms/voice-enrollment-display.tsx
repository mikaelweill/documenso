'use client';

import { useState } from 'react';

import Link from 'next/link';

import { Trans } from '@lingui/macro';
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
  const [isLoading, setIsLoading] = useState(false);
  const [_isCreating, setIsCreating] = useState(false);
  const [diagnosticData, setDiagnosticData] = useState<{
    exists?: boolean;
    details?: string;
    error?: string;
  } | null>(null);

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

  // Add a new function to check profile validity
  const handleCheckProfile = async () => {
    try {
      setDiagnosticData(null);
      setIsLoading(true);

      // Call the new API endpoint to check if the profile exists
      const response = await fetch('/api/voice-verification/check-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          profileId: voiceProfileId,
        }),
      });

      const data = await response.json();
      setDiagnosticData(data);

      if (!data.exists) {
        toast({
          title: _({ id: 'voice-enrollment.profile-check-failed' }),
          description: data.details || _({ id: 'voice-enrollment.profile-not-found' }),
          variant: 'destructive',
        });
      } else {
        toast({
          title: _({ id: 'voice-enrollment.profile-check-success' }),
          description: data.details || _({ id: 'voice-enrollment.profile-valid' }),
        });
      }
    } catch (error) {
      console.error('Error checking profile:', error);
      toast({
        title: _({ id: 'voice-enrollment.check-error' }),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
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

  // Add this right after your renderStatusBadge function
  const renderDiagnostics = () => {
    if (!diagnosticData) return null;

    return (
      <div className="mt-2 text-sm">
        {diagnosticData.exists ? (
          <Alert className="border-green-500 bg-green-50 text-xs text-green-800 dark:border-green-900 dark:bg-green-900/30 dark:text-green-400">
            <Check className="h-3 w-3" />
            <AlertTitle>{_({ id: 'voice-enrollment.profile-exists' })}</AlertTitle>
            <AlertDescription>{diagnosticData.details}</AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive" className="text-xs">
            <AlertTriangle className="h-3 w-3" />
            <AlertTitle>{_({ id: 'voice-enrollment.profile-missing' })}</AlertTitle>
            <AlertDescription>{diagnosticData.details || diagnosticData.error}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  return (
    <div className={cn('flex flex-col', className)}>
      {!videoUrl && !audioUrl ? (
        <div className="bg-muted flex flex-col items-center justify-center rounded-md p-4">
          <div className="bg-muted-foreground/20 mb-4 flex h-16 w-16 items-center justify-center rounded-full">
            <Mic className="text-muted-foreground h-8 w-8" />
          </div>
          <p className="text-muted-foreground mb-4 text-center text-sm">
            <Trans>You haven't enrolled your voice yet.</Trans>
          </p>
          <Button asChild>
            <Link href="/voice-enrollment">
              <Trans>Enroll Your Voice</Trans>
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">
                <Trans>Voice Enrollment</Trans> {renderStatusBadge()}
              </h4>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCheckProfile}
                  disabled={isLoading || _isCreating || !voiceProfileId}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      <span>
                        <Trans>Checking...</Trans>
                      </span>
                    </>
                  ) : (
                    <span>
                      <Trans>Check Profile</Trans>
                    </span>
                  )}
                </Button>

                {(processingStatus === 'AUDIO_EXTRACTED' || processingStatus === 'COMPLETED') &&
                  !voiceProfileId && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleCreateProfile}
                      disabled={isCreatingProfile}
                    >
                      {isCreatingProfile ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          <span>
                            <Trans>Creating...</Trans>
                          </span>
                        </>
                      ) : (
                        <span>
                          <Trans>Create Profile</Trans>
                        </span>
                      )}
                    </Button>
                  )}
              </div>
            </div>
            {diagnosticData && renderDiagnostics()}
          </div>

          <VoiceDisplay videoUrl={videoUrl} audioUrl={audioUrl} duration={duration} />

          {enrollmentId && (
            <div className="text-muted-foreground flex flex-col text-xs">
              <span>ID: {enrollmentId}</span>
              {voiceProfileId && <span>Profile: {voiceProfileId}</span>}
              {processingStatus && <span>Status: {processingStatus}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
