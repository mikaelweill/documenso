'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Trans, msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';
import { MicIcon } from 'lucide-react';
import { CheckCircleIcon, XCircleIcon } from 'lucide-react';

import { DO_NOT_INVALIDATE_QUERY_ON_MUTATION } from '@documenso/lib/constants/trpc';
import { AppError } from '@documenso/lib/errors/app-error';
import type { FieldWithSignature } from '@documenso/prisma/types/field-with-signature';
import { trpc } from '@documenso/trpc/react';
import type {
  TRemovedSignedFieldWithTokenMutationSchema,
  TSignFieldWithTokenMutationSchema,
} from '@documenso/trpc/server/field-router/schema';
import { cn } from '@documenso/ui/lib/utils';
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
  const [transcriptVerified, setTranscriptVerified] = useState<boolean | null>(null);
  const [isPhaseRequired, setIsPhaseRequired] = useState(false);
  const [requiredPhrase, setRequiredPhrase] = useState<string | null>(null);
  const [strictMatching, setStrictMatching] = useState(false);

  useEffect(() => {
    if (field.fieldMeta) {
      try {
        const meta = field.fieldMeta as Record<string, unknown>;
        if (meta.type === 'voiceSignature') {
          const phrase = meta.requiredPhrase as string;
          const isStrict = meta.strictMatching as boolean;

          setRequiredPhrase(phrase || null);
          setIsPhaseRequired(!!phrase);
          setStrictMatching(!!isStrict);
        }
      } catch (error) {
        console.error('Error parsing field metadata:', error);
      }
    }
  }, [field.fieldMeta]);

  const verifyTranscript = useCallback(
    (transcript: string): boolean => {
      if (!requiredPhrase || !transcript) return true;

      const normalizedTranscript = transcript.trim().toLowerCase();
      const normalizedRequiredPhrase = requiredPhrase.trim().toLowerCase();

      if (strictMatching) {
        return normalizedTranscript === normalizedRequiredPhrase;
      } else {
        const requiredWords = normalizedRequiredPhrase.split(/\s+/).filter(Boolean);
        const transcriptWords = normalizedTranscript.split(/\s+/).filter(Boolean);

        return requiredWords.every((word) =>
          transcriptWords.some((tWord) => tWord.includes(word) || word.includes(tWord)),
        );
      }
    },
    [requiredPhrase, strictMatching],
  );

  const transcribeAudio = useCallback(
    async (audioBlob: Blob): Promise<string> => {
      console.log('🔍 Parent: Starting transcription for audio blob', {
        size: audioBlob.size,
        type: audioBlob.type,
      });
      setIsTranscribing(true);

      try {
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

          const isVerified = verifyTranscript(transcript);
          setTranscriptVerified(isVerified);

          await new Promise<void>((resolve) => {
            setVoiceData((currentVoiceData) => {
              if (!currentVoiceData) {
                console.warn('🔍 Cannot update transcript: voiceData is null');
                return currentVoiceData;
              }

              console.log(
                '🔍 Parent: Updating voiceData state with transcript:',
                transcript.substring(0, 50),
              );

              const updatedData = {
                ...currentVoiceData,
                transcript: transcript,
                isVerified: isVerified,
              };

              console.log('🔍 Updated voice data:', {
                hasTranscript: !!updatedData.transcript,
                transcriptLength: updatedData.transcript?.length || 0,
                isVerified: updatedData.isVerified,
              });

              return updatedData;
            });

            setTimeout(resolve, 100);
          });

          console.log('🔍 Parent: Returning transcript from API call function');
          return transcript;
        } else {
          throw new Error('No transcript returned from API');
        }
      } catch (error) {
        console.error('🔍 Parent: Transcription error:', error);
        setTranscriptVerified(false);
        throw error;
      } finally {
        setIsTranscribing(false);
      }
    },
    [verifyTranscript],
  );

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

      if (isTranscribing) {
        console.log('🔍 Waiting for transcription to complete before saving...');

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

      console.log('🔍 Getting current voiceData state');

      console.log('🔍 Voice data before saving:', {
        hasTranscript: !!voiceData.transcript,
        transcriptLength: voiceData.transcript?.length || 0,
        transcript: voiceData.transcript?.substring(0, 50),
        duration: voiceData.duration,
      });

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

      let transcriptValue = voiceData.transcript || '';

      if (!transcriptValue && !isTranscribing) {
        console.warn(
          '⚠️ WARNING: Transcript is missing despite transcription completing successfully!',
        );

        try {
          console.log('🔍 Attempting emergency transcript re-fetch');
          const emergencyTranscript = await transcribeAudio(voiceData.audioBlob);
          transcriptValue = emergencyTranscript;
          console.log('🔍 Emergency transcript obtained:', transcriptValue?.substring(0, 50));
        } catch (e) {
          console.error('🔍 Emergency transcript fetch failed:', e);
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

      if (isPhaseRequired && transcriptVerified === false) {
        toast({
          title: _(msg`Voice verification failed`),
          description: _(
            msg`Your voice recording does not match the required phrase. Please try again.`,
          ),
          variant: 'destructive',
        });
        setIsSaving(false);
        return;
      }

      const metadata = {
        transcript: transcriptValue,
        duration: voiceData.duration,
        requiredPhrase: requiredPhrase,
        isVerified: transcriptVerified,
      };

      let metadataString = JSON.stringify(metadata);

      console.log('🔍 Full metadata being saved:', metadataString);

      console.log('🔍 Metadata being saved:', {
        metadataValue: metadataString.substring(0, 50),
        metadataLength: metadataString.length,
        parsedBack: JSON.parse(metadataString),
      });

      if (!metadataString || metadataString === '{}' || metadataString === 'null') {
        console.error('⚠️ WARNING: Metadata is empty or invalid - creating fallback metadata');
        const fallbackMetadata = JSON.stringify({
          transcript: transcriptValue || 'Audio recording without transcript',
          duration: voiceData.duration || 0,
          isFailbackData: true,
        });

        console.log('🔍 Using fallback metadata:', fallbackMetadata);

        metadataString = fallbackMetadata;
      }

      let finalTranscript: string | undefined;
      try {
        const parsedMetadata = JSON.parse(metadataString);
        finalTranscript = parsedMetadata?.transcript;
      } catch (e) {
        console.error('🔍 Error parsing metadata before sending:', e);
      }

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

      const valueWithTranscript = `${base64}::TRANSCRIPT::${encodeURIComponent(transcriptValue)}`;

      console.log('🔍 Using direct transcript in value:', {
        hasTranscript: !!transcriptValue,
        transcriptLength: transcriptValue.length,
        valueLength: valueWithTranscript.length,
      });

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
    isPhaseRequired,
    transcriptVerified,
    requiredPhrase,
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

  const getMetadataFromSignature = useCallback(() => {
    if (!field.signature?.voiceSignatureMetadata) {
      return null;
    }

    try {
      const meta = field.signature.voiceSignatureMetadata as Record<string, unknown>;
      return {
        requiredPhrase: meta.requiredPhrase as string | undefined,
        isVerified: meta.isVerified as boolean | undefined,
      };
    } catch (error) {
      console.error('Error parsing signature metadata:', error);
      return null;
    }
  }, [field.signature?.voiceSignatureMetadata]);

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
              {requiredPhrase ? (
                <div className="space-y-2">
                  <Trans>Please record your voice saying exactly the phrase below:</Trans>
                  <div className="bg-muted rounded-md p-3 text-sm font-medium">
                    "{requiredPhrase}"
                  </div>
                  {strictMatching && (
                    <div className="text-xs">
                      <Trans>An exact match is required.</Trans>
                    </div>
                  )}
                </div>
              ) : (
                <Trans>
                  Please record your voice signature. Your voice will be automatically transcribed.
                </Trans>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-center py-4">
            <VoiceSignaturePad
              className="h-auto w-full"
              onChange={(data) => {
                setVoiceData(data);
                if (data) {
                  setTranscriptVerified(null);
                }
              }}
              onValidityChange={setIsValid}
              onTranscriptionStatusChange={setIsTranscribing}
              containerClassName="w-full"
              transcribeAudioFn={transcribeAudio}
              transcript={voiceData?.transcript || null}
            />
          </div>

          {voiceData?.transcript && isPhaseRequired && (
            <div
              className={cn(
                'rounded-md p-3 text-sm',
                transcriptVerified === true
                  ? 'bg-green-50 text-green-900'
                  : transcriptVerified === false
                    ? 'bg-red-50 text-red-900'
                    : 'bg-blue-50 text-blue-900',
              )}
            >
              <p className="flex items-start gap-2">
                {transcriptVerified === true ? (
                  <>
                    <CheckCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" />
                    <Trans>
                      Verification successful! Your recording matches the required phrase.
                    </Trans>
                  </>
                ) : transcriptVerified === false ? (
                  <>
                    <XCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                    <Trans>
                      Verification failed. Please try again and make sure to say the exact required
                      phrase.
                    </Trans>
                  </>
                ) : (
                  <>
                    <span className="mt-0.5 flex-shrink-0">ℹ️</span>
                    <Trans>Verifying your recording against the required phrase...</Trans>
                  </>
                )}
              </p>
            </div>
          )}

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
              disabled={!isValid || isLoading || (isPhaseRequired && transcriptVerified === false)}
            >
              {isTranscribing ? <Trans>Wait & Save</Trans> : <Trans>Save</Trans>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            {getMetadataFromSignature()?.requiredPhrase && (
              <div className="rounded-md border p-4">
                <h3 className="mb-2 text-sm font-medium">
                  <Trans>Required Phrase</Trans>
                </h3>
                <p className="text-sm italic">"{getMetadataFromSignature()?.requiredPhrase}"</p>
              </div>
            )}

            {field.signature?.voiceSignatureTranscript && (
              <div className="rounded-md border p-4">
                <h3 className="mb-2 text-sm font-medium">
                  <Trans>Transcript</Trans>
                </h3>
                <p className="text-sm italic">"{field.signature.voiceSignatureTranscript}"</p>
              </div>
            )}

            {getMetadataFromSignature()?.requiredPhrase && (
              <div
                className={cn(
                  'rounded-md p-3',
                  getMetadataFromSignature()?.isVerified
                    ? 'border-green-200 bg-green-50 text-green-900'
                    : 'border-red-200 bg-red-50 text-red-900',
                )}
              >
                <div className="flex items-center gap-2">
                  {getMetadataFromSignature()?.isVerified ? (
                    <>
                      <CheckCircleIcon className="h-5 w-5 text-green-500" />
                      <div>
                        <h3 className="font-medium">
                          <Trans>Verification Successful</Trans>
                        </h3>
                        <p className="text-sm">
                          <Trans>The voice recording matched the required phrase.</Trans>
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <XCircleIcon className="h-5 w-5 text-red-500" />
                      <div>
                        <h3 className="font-medium">
                          <Trans>Verification Failed</Trans>
                        </h3>
                        <p className="text-sm">
                          <Trans>The voice recording did not match the required phrase.</Trans>
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {field.signature?.voiceSignatureUrl && (
              <div>
                <h3 className="mb-2 text-sm font-medium">
                  <Trans>Voice Recording</Trans>
                </h3>
                <audio
                  src={`data:audio/webm;base64,${
                    field.signature.voiceSignatureUrl.split('::TRANSCRIPT::')[0]
                  }`}
                  controls
                  className="w-full"
                  preload="auto"
                />
              </div>
            )}

            {!field.signature?.voiceSignatureUrl && (
              <div className="rounded-md border border-yellow-200 bg-yellow-50 p-4">
                <h3 className="mb-2 text-sm font-medium text-yellow-700">
                  <Trans>Voice Recording</Trans>
                </h3>
                <p className="text-sm text-yellow-700">
                  <Trans>
                    The audio recording could not be found. This might happen if the field was
                    created with an older version of the voice signature feature.
                  </Trans>
                </p>
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
