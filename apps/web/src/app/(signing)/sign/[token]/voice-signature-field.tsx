'use client';

import { useCallback, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Trans, msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';
import { MicIcon } from 'lucide-react';

import { DO_NOT_INVALIDATE_QUERY_ON_MUTATION } from '@documenso/lib/constants/trpc';
import { AppError } from '@documenso/lib/errors/app-error';
import type { FieldWithSignature } from '@documenso/prisma/types/field-with-signature';
import { trpc } from '@documenso/trpc/react';
import type {
  TRemovedSignedFieldWithTokenMutationSchema,
  TSignFieldWithTokenMutationSchema,
} from '@documenso/trpc/server/field-router/schema';
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@documenso/ui/primitives/dialog';
import { useToast } from '@documenso/ui/primitives/use-toast';
import {
  type VoiceSignatureDataFormat,
  VoiceSignaturePad,
} from '@documenso/ui/primitives/voice-signature/voice-signature-pad';

import { useRecipientContext } from './recipient-context';
import { SigningFieldContainer } from './signing-field-container';

export type VoiceSignatureFieldProps = {
  field: FieldWithSignature;
  onSignField?: (value: TSignFieldWithTokenMutationSchema) => Promise<void> | void;
  onUnsignField?: (value: TRemovedSignedFieldWithTokenMutationSchema) => Promise<void> | void;
};

const truncateText = (text: string, maxLength: number): string => {
  if (!text) return '';
  return text.length <= maxLength ? text : `${text.substring(0, maxLength)}...`;
};

export const VoiceSignatureField = ({
  field,
  onSignField,
  onUnsignField,
}: VoiceSignatureFieldProps) => {
  const router = useRouter();
  const { _ } = useLingui();
  const { toast } = useToast();
  const { recipient } = useRecipientContext();

  const token = recipient.token;

  const [isPending, startTransition] = useTransition();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [voiceData, setVoiceData] = useState<VoiceSignatureDataFormat | null>(null);
  const [isValid, setIsValid] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);

  const transcribeAudio = useCallback(async (audioBlob: Blob): Promise<string> => {
    console.log('🔍 Parent: Starting transcription for audio blob', {
      size: audioBlob.size,
      type: audioBlob.type,
    });
    setIsTranscribing(true);

    try {
      // Create form data for the API request
      const formData = new FormData();
      formData.append('audio', audioBlob);

      console.log('🔍 Parent: Sending audio to transcription API...');
      const response = await fetch('/api/voice-transcription', {
        method: 'POST',
        body: formData,
      });

      console.log('🔍 Parent: Transcription API response status:', response.status);

      if (!response.ok) {
        throw new Error(`Transcription failed: ${response.statusText}`);
      }

      const responseData = await response.json();

      if (responseData.transcript) {
        const transcript = responseData.transcript;
        console.log(
          '🔍 Parent: Transcription successful:',
          transcript.substring(0, 50),
          '(full length:',
          transcript.length,
          ')',
        );

        // Use a promise to ensure the state is updated before we return
        await new Promise<void>((resolve) => {
          // CRITICAL FIX: Immediately update voiceData state with the transcript
          setVoiceData((currentVoiceData) => {
            if (!currentVoiceData) {
              console.warn('🔍 Cannot update transcript: voiceData is null');
              return currentVoiceData;
            }

            console.log(
              '🔍 Parent: Updating voiceData state with transcript:',
              transcript.substring(0, 50),
            );

            // Create updated voice data with transcript
            const updatedData = {
              ...currentVoiceData,
              transcript: transcript,
            };

            // Log the updated data
            console.log('🔍 Updated voice data:', {
              hasTranscript: !!updatedData.transcript,
              transcriptLength: updatedData.transcript?.length || 0,
            });

            return updatedData;
          });

          // Small delay to allow React to process the state update
          setTimeout(resolve, 100);
        });

        // State should be updated now, return the transcript
        console.log('🔍 Parent: Returning transcript from API call function');
        return transcript;
      } else {
        throw new Error('No transcript returned from API');
      }
    } catch (error) {
      console.error('🔍 Parent: Transcription error:', error);
      throw error;
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  const { mutateAsync: signFieldWithToken, isPending: isSignFieldWithTokenLoading } =
    trpc.field.signFieldWithToken.useMutation(DO_NOT_INVALIDATE_QUERY_ON_MUTATION);

  const {
    mutateAsync: removeSignedFieldWithToken,
    isPending: isRemoveSignedFieldWithTokenLoading,
  } = trpc.field.removeSignedFieldWithToken.useMutation(DO_NOT_INVALIDATE_QUERY_ON_MUTATION);

  const isLoading =
    isSignFieldWithTokenLoading || isRemoveSignedFieldWithTokenLoading || isPending || isSaving;

  const handleSignField = useCallback(async () => {
    if (!voiceData) {
      return;
    }

    try {
      setIsSaving(true);

      // If transcription is still in progress, wait for it to complete
      if (isTranscribing) {
        console.log('🔍 Waiting for transcription to complete before saving...');

        // Use a timeout to wait for transcription to complete
        await new Promise<void>((resolve) => {
          const checkTranscription = () => {
            if (!isTranscribing) {
              resolve();
            } else {
              setTimeout(checkTranscription, 500);
            }
          };

          checkTranscription();
        });

        console.log('🔍 Transcription completed, continuing with save...');
      }

      // CRITICAL FIX: Get the most up-to-date transcript
      // We need to get a fresh reference to the state since it might have been updated
      console.log('🔍 Getting current voiceData state');

      // Debug logging
      console.log('🔍 Voice data before saving:', {
        hasTranscript: !!voiceData.transcript,
        transcriptLength: voiceData.transcript?.length || 0,
        transcript: voiceData.transcript?.substring(0, 50), // Log first 50 chars
        duration: voiceData.duration,
      });

      // Convert audio blob to base64 string
      const reader = new FileReader();

      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
          } else {
            console.error('Expected string result from FileReader');
            resolve('');
          }
        };
      });

      reader.readAsDataURL(voiceData.audioBlob);

      const base64 = await base64Promise;

      // Get the most up-to-date transcript value
      // First try from the current state
      let transcriptValue = voiceData.transcript || '';

      // If transcript is missing, try to get it from the API again
      if (!transcriptValue && !isTranscribing) {
        console.warn(
          '⚠️ WARNING: Transcript is missing despite transcription completing successfully!',
        );

        // Emergency backup: Re-fetch the transcript if needed
        try {
          console.log('🔍 Attempting emergency transcript re-fetch');
          const emergencyTranscript = await transcribeAudio(voiceData.audioBlob);
          transcriptValue = emergencyTranscript;
          console.log('🔍 Emergency transcript obtained:', transcriptValue?.substring(0, 50));
        } catch (e) {
          console.error('🔍 Emergency transcript fetch failed:', e);
          // If all else fails, add a placeholder so we at least have something
          transcriptValue = 'Audio recording (transcript unavailable)';
        }
      }

      console.log('🔍 Final transcript value for saving:', transcriptValue?.substring(0, 50));

      console.log('🔍 Using transcript:', {
        hasTranscript: !!transcriptValue,
        transcriptLength: transcriptValue.length,
        transcriptPreview:
          transcriptValue.substring(0, 50) + (transcriptValue.length > 50 ? '...' : ''),
      });

      // Create metadata object with transcript
      const metadata = {
        transcript: transcriptValue,
        duration: voiceData.duration,
      };

      // Convert metadata to string for storage
      let metadataString = JSON.stringify(metadata);

      // CRITICAL: Log full metadata to ensure it contains transcript
      console.log('🔍 Full metadata being saved:', metadataString);

      // Debug logging
      console.log('🔍 Metadata being saved:', {
        metadataValue: metadataString.substring(0, 50), // Log first 50 chars
        metadataLength: metadataString.length,
        parsedBack: JSON.parse(metadataString),
      });

      // Added safety check for empty/invalid metadata
      if (!metadataString || metadataString === '{}' || metadataString === 'null') {
        console.error('⚠️ WARNING: Metadata is empty or invalid - creating fallback metadata');
        const fallbackMetadata = JSON.stringify({
          transcript: transcriptValue || 'Audio recording without transcript',
          duration: voiceData.duration || 0,
          isFailbackData: true,
        });

        console.log('🔍 Using fallback metadata:', fallbackMetadata);

        // Use the fallback metadata
        metadataString = fallbackMetadata;
      }

      // Extract transcript again to double-check
      let finalTranscript: string | undefined;
      try {
        const parsedMetadata = JSON.parse(metadataString);
        finalTranscript = parsedMetadata?.transcript;
      } catch (e) {
        console.error('🔍 Error parsing metadata before sending:', e);
      }

      // If after all our efforts we still don't have a transcript, add a fallback
      if (!finalTranscript) {
        console.warn('⚠️ Final transcript check failed - adding fallback transcript');
        metadataString = JSON.stringify({
          transcript: 'Audio recording (transcript unavailable)',
          duration: voiceData.duration || 0,
          isFinalFallback: true,
        });
      }

      console.log('🔍 Final save parameters:', {
        fieldId: field.id,
        hasMetadata: !!metadataString,
        metadataLength: metadataString.length,
        isBase64: true,
      });

      // Format: BASE64_AUDIO::TRANSCRIPT
      const valueWithTranscript = `${base64}::TRANSCRIPT::${encodeURIComponent(transcriptValue)}`;

      console.log('🔍 Using direct transcript in value:', {
        hasTranscript: !!transcriptValue,
        transcriptLength: transcriptValue.length,
        valueLength: valueWithTranscript.length,
      });

      // Use the extracted transcript for saving
      if (onSignField) {
        await onSignField({
          token,
          fieldId: field.id,
          value: valueWithTranscript,
          isBase64: true,
          metadata: metadataString,
        });
      } else {
        await signFieldWithToken({
          token,
          fieldId: field.id,
          value: valueWithTranscript,
          isBase64: true,
          metadata: metadataString,
        });

        startTransition(() => {
          router.refresh();
        });
      }

      setIsDialogOpen(false);
    } catch (err) {
      console.error(err);

      if (err instanceof AppError) {
        toast({
          title: _(msg`Error`),
          description: err.message,
          variant: 'destructive',
        });
      } else {
        toast({
          title: _(msg`Error`),
          description: _(
            msg`An unexpected error occurred while signing the field. Please try again.`,
          ),
          variant: 'destructive',
        });
      }
    } finally {
      setIsSaving(false);
    }
  }, [
    _,
    field.id,
    onSignField,
    router,
    signFieldWithToken,
    toast,
    token,
    voiceData,
    isTranscribing,
    transcribeAudio,
  ]);

  const handleRemoveSignature = useCallback(async () => {
    try {
      if (onUnsignField) {
        await onUnsignField({
          token,
          fieldId: field.id,
        });
      } else {
        await removeSignedFieldWithToken({
          token,
          fieldId: field.id,
        });

        startTransition(() => {
          router.refresh();
        });
      }
    } catch (err) {
      console.error(err);

      if (err instanceof AppError) {
        toast({
          title: _(msg`Error`),
          description: err.message,
          variant: 'destructive',
        });
      } else {
        toast({
          title: _(msg`Error`),
          description: _(
            msg`An unexpected error occurred while removing the signature. Please try again.`,
          ),
          variant: 'destructive',
        });
      }
    }
  }, [_, field.id, onUnsignField, removeSignedFieldWithToken, router, toast, token]);

  const showVoiceSignatureDialog = () => {
    setIsDialogOpen(true);
  };

  return (
    <>
      <SigningFieldContainer
        field={field}
        type="Signature"
        loading={isLoading}
        onSign={showVoiceSignatureDialog}
        onRemove={handleRemoveSignature}
      >
        {field.inserted ? (
          <div
            className="flex h-full cursor-pointer flex-col items-center justify-center text-center"
            onClick={() => field.signature?.voiceSignatureMetadata && setReviewDialogOpen(true)}
          >
            <MicIcon className="text-primary mb-1 h-6 w-6" />
            {field.signature?.voiceSignatureTranscript ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-muted-foreground text-xs">
                  <Trans>Voice Recorded</Trans>
                </span>
                <span className="text-foreground line-clamp-1 text-xs font-light italic">
                  "{truncateText(field.signature.voiceSignatureTranscript, 20)}"
                </span>
                <span className="mt-1 text-xs text-blue-500 hover:underline">
                  <Trans>Click to review</Trans>
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground text-xs">
                <Trans>Voice Recorded</Trans>
              </span>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <MicIcon className="text-muted-foreground mb-1 h-6 w-6" />
            <span className="text-muted-foreground text-xs">
              <Trans>Record Voice</Trans>
            </span>
          </div>
        )}
      </SigningFieldContainer>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              <Trans>Record your voice signature</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>
                Please record your voice signature. Your voice will be automatically transcribed.
              </Trans>
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-center py-4">
            <VoiceSignaturePad
              className="h-auto w-full"
              onChange={(data) => {
                setVoiceData(data);
              }}
              onValidityChange={setIsValid}
              onTranscriptionStatusChange={setIsTranscribing}
              containerClassName="w-full"
              transcribeAudioFn={transcribeAudio}
              transcript={voiceData?.transcript || null}
            />
          </div>

          {/* Info about transcription status */}
          {voiceData && isTranscribing && (
            <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-900">
              <p className="flex items-start gap-2">
                <span className="mt-0.5 flex-shrink-0">ℹ️</span>
                <Trans>
                  Transcription in progress... When you click Save, we'll wait for the transcription
                  to complete first.
                </Trans>
              </p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setIsDialogOpen(false)}>
              <Trans>Cancel</Trans>
            </Button>

            <Button
              type="button"
              onClick={() => void handleSignField()}
              loading={isLoading}
              disabled={!isValid || isLoading}
            >
              {isTranscribing ? <Trans>Wait & Save</Trans> : <Trans>Save</Trans>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Dialog for existing voice signatures */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              <Trans>Voice Signature Review</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>Review your recorded voice signature and transcript.</Trans>
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {field.signature?.voiceSignatureTranscript && (
              <div className="rounded-md border p-4">
                <h3 className="mb-2 text-sm font-medium">
                  <Trans>Transcript</Trans>
                </h3>
                <p className="text-sm italic">"{field.signature.voiceSignatureTranscript}"</p>
              </div>
            )}

            {field.signature?.signatureImageAsBase64 && (
              <div>
                <h3 className="mb-2 text-sm font-medium">
                  <Trans>Voice Recording</Trans>
                </h3>
                <audio
                  src={`data:audio/webm;base64,${field.signature.signatureImageAsBase64}`}
                  controls
                  className="w-full"
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setReviewDialogOpen(false)}>
              <Trans>Close</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
