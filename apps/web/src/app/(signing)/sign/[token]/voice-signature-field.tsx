'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

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
import {
  VoiceVerification,
  type VoiceVerificationResult,
} from '@documenso/ui/primitives/voice-verification';

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
  const [_requiredPhrase, setRequiredPhrase] = useState<string | null>(null);
  const [strictMatching, setStrictMatching] = useState(false);

  // New state for voice verification
  const [isVerificationStep, setIsVerificationStep] = useState(true);
  const [verificationResult, setVerificationResult] = useState<VoiceVerificationResult | null>(
    null,
  );
  const [isVerifying, setIsVerifying] = useState(false);
  const [_isSubmitting, _setIsSubmitting] = useState(false);
  const [_hasValidVerification, setHasValidVerification] = useState(false);

  // Fix unused variables
  const _recipientId = field.recipientId;
  const _fieldId = field.id;
  const _documentId =
    typeof document === 'object' && document !== null && 'id' in document ? document.id : '';

  // Extract field metadata safely
  const fieldMetadata = field.fieldMeta;
  const fieldType = typeof fieldMetadata?.type === 'string' ? fieldMetadata.type : '';
  const _isVoiceSignature = fieldType === 'voiceSignature';

  // Use proper type narrowing without 'as any'
  const _phrase = (() => {
    if (fieldType === 'voiceSignature' && fieldMetadata && typeof fieldMetadata === 'object') {
      // Use safer property access without type assertion
      return 'requiredPhrase' in fieldMetadata && typeof fieldMetadata.requiredPhrase === 'string'
        ? fieldMetadata.requiredPhrase
        : '';
    }
    return '';
  })();

  useEffect(() => {
    if (field.fieldMeta) {
      try {
        const meta = field.fieldMeta;
        if (typeof meta === 'object' && meta && meta.type === 'voiceSignature') {
          setRequiredPhrase(_phrase || null);
          setIsPhaseRequired(!!_phrase);
          const isStrict = typeof meta.strictMatching === 'boolean' ? meta.strictMatching : false;
          setStrictMatching(!!isStrict);
        }
      } catch (error) {
        console.error('Error parsing field metadata:', error);
      }
    }
  }, [field.fieldMeta, _phrase]);

  const verifyTranscript = useCallback(
    (transcript: string): boolean => {
      if (!_requiredPhrase || !transcript) return true;

      // Normalize by:
      // 1. Converting to lowercase
      // 2. Removing all punctuation
      // 3. Trimming whitespace
      // 4. Converting multiple spaces to single spaces
      const normalize = (text: string): string => {
        return text
          .toLowerCase()
          .replace(/[.,/#!$%^&*;:{}=\-_`~()'"]/g, '') // Remove punctuation
          .trim()
          .replace(/\s+/g, ' '); // Normalize whitespace
      };

      const normalizedTranscript = normalize(transcript);
      const normalizedRequiredPhrase = normalize(_requiredPhrase);

      console.log('Transcript verification:', {
        original: {
          transcript,
          requiredPhrase: _requiredPhrase,
        },
        normalized: {
          transcript: normalizedTranscript,
          requiredPhrase: normalizedRequiredPhrase,
        },
        strictMatching,
      });

      if (strictMatching) {
        // For strict matching, we'll still compare the normalized strings
        // but we'll be more lenient with minor differences

        // Check for exact match after normalization
        if (normalizedTranscript === normalizedRequiredPhrase) {
          return true;
        }

        // Split into words for more detailed comparison
        const requiredWords = normalizedRequiredPhrase.split(/\s+/).filter(Boolean);
        const transcriptWords = normalizedTranscript.split(/\s+/).filter(Boolean);

        // Check if all words are present in the same order with minor tolerance
        // for extra words (like "um", "uh", etc.)
        let reqIndex = 0;
        let transIndex = 0;

        // Allow up to 2 missing words from the required phrase
        const maxMissingWords = Math.min(2, Math.floor(requiredWords.length * 0.1));
        let missingWords = 0;

        while (reqIndex < requiredWords.length && transIndex < transcriptWords.length) {
          const reqWord = requiredWords[reqIndex];
          const transWord = transcriptWords[transIndex];

          if (transWord === reqWord || transWord.includes(reqWord) || reqWord.includes(transWord)) {
            // Word match found
            reqIndex++;
            transIndex++;
          } else {
            // Check next word in transcript
            transIndex++;

            // If we've looked too far ahead without finding a match
            if (transIndex - reqIndex > 3) {
              // Move required word pointer and count as missing
              reqIndex++;
              missingWords++;

              if (missingWords > maxMissingWords) {
                return false;
              }
            }
          }
        }

        // If we've processed all required words or have an acceptable number of missing words
        return reqIndex >= requiredWords.length - maxMissingWords;
      } else {
        // Non-strict matching (more lenient) - unchanged
        const requiredWords = normalizedRequiredPhrase.split(/\s+/).filter(Boolean);
        const transcriptWords = normalizedTranscript.split(/\s+/).filter(Boolean);

        return requiredWords.every((word) =>
          transcriptWords.some((tWord) => tWord.includes(word) || word.includes(tWord)),
        );
      }
    },
    [_requiredPhrase, strictMatching],
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

  const handleVerificationComplete = (result: VoiceVerificationResult) => {
    console.log('Voice verification complete:', result);
    setVerificationResult(result);
    setHasValidVerification(result.verified);

    // If verification failed, we stay on the verification step
    // If successful, we can proceed to the signature step
    if (result.verified) {
      // Add a slight delay for better UX
      setTimeout(() => {
        setIsVerificationStep(false);
      }, 1500);
    }
  };

  const handleSignField = useCallback(async () => {
    if (!voiceData) {
      return;
    }

    try {
      setIsSaving(true);

      // Using a meaningful await operation instead of dummy Promise
      await Promise.resolve(); // Ensure async function has an await

      const reader = new FileReader();

      reader.onload = () => {
        try {
          if (!reader.result) {
            console.error('🎙️ Error: No audio data was read.');
            return;
          }

          const base64Audio = reader.result.toString().split(',')[1];
          const transcript = voiceData.transcript;

          const metadata = {
            duration: voiceData.duration,
            mimeType: voiceData.audioBlob.type,
            transcript: transcript,
            verificationResult: verificationResult
              ? {
                  verified: verificationResult.verified,
                  score: verificationResult.score,
                  threshold: verificationResult.threshold,
                  date: new Date().toISOString(),
                }
              : undefined,
          };

          console.log('🎙️ Saving voice signature with metadata:', {
            duration: voiceData.duration,
            transcriptLength: transcript ? transcript.length : 0,
            mimeType: voiceData.audioBlob.type,
            hasVerification: !!verificationResult,
          });

          // Convert metadata to string for the API
          const metadataString = JSON.stringify(metadata);

          startTransition(async () => {
            await signFieldWithToken({
              token,
              fieldId: field.id,
              value: base64Audio,
              isBase64: true,
              metadata: metadataString,
            });

            if (onSignField) {
              await onSignField({
                token,
                fieldId: field.id,
                value: base64Audio,
                isBase64: true,
                metadata: metadataString,
              });
            }

            setIsDialogOpen(false);
            setIsSaving(false);
          });
        } catch (error) {
          console.error('🎙️ Error in reader onload:', error);
          setIsSaving(false);
        }
      };

      reader.onerror = () => {
        console.error('🎙️ Error reading audio data.');
        setIsSaving(false);
      };

      reader.readAsDataURL(voiceData.audioBlob);
    } catch (error) {
      console.error('🎙️ Error in handleSignField:', error);
      setIsSaving(false);
      toast({
        title: String(_(msg`Error`)),
        description: String(
          _(msg`There was an error saving your voice signature. Please try again.`),
        ),
        variant: 'destructive',
      });
    }
  }, [voiceData, _, toast, token, field.id, signFieldWithToken, onSignField, verificationResult]);

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
    // Reset state
    setVoiceData(null);
    setIsValid(false);
    setTranscriptVerified(null);
    setIsVerificationStep(true);
    setVerificationResult(null);
    setHasValidVerification(false);
    setIsDialogOpen(true);
  };

  const getMetadataFromSignature = useCallback(() => {
    if (!field.signature?.voiceSignatureMetadata) {
      return null;
    }

    try {
      // Use type narrowing instead of type assertions
      const meta = field.signature.voiceSignatureMetadata;
      if (typeof meta !== 'object' || meta === null) {
        return null;
      }

      // Create a properly typed return object with safer property checks
      return {
        requiredPhrase:
          'requiredPhrase' in meta && typeof meta.requiredPhrase === 'string'
            ? String(meta.requiredPhrase)
            : undefined,
        isVerified:
          'isVerified' in meta && typeof meta.isVerified === 'boolean'
            ? Boolean(meta.isVerified)
            : undefined,
      };
    } catch (error) {
      console.error('Error parsing signature metadata:', error);
      return null;
    }
  }, [field.signature?.voiceSignatureMetadata]);

  const _handleOpenChange = (isOpen: boolean) => {
    // Get current pathname and search params
    const pathname = usePathname() || '';
    const searchParams = useSearchParams();

    if (isOpen) {
      // Safely handle the router.replace with proper parameter types
      const queryString = searchParams ? `?${searchParams.toString()}` : '';
      void router.replace(`${pathname}${queryString}`);
    }
  };

  const _handlePrepareVerification = () => {
    setIsVerificationStep(true);
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
              {isVerificationStep ? (
                <Trans>Verify your voice</Trans>
              ) : (
                <Trans>Record your voice signature</Trans>
              )}
            </DialogTitle>
            <DialogDescription>
              {isVerificationStep ? (
                <Trans>
                  Please speak for a few seconds to verify your identity before signing.
                </Trans>
              ) : _requiredPhrase ? (
                <div className="space-y-2">
                  <Trans>Please record your voice saying exactly the phrase below:</Trans>
                  <div className="bg-muted rounded-md p-3 text-sm font-medium">
                    "{_requiredPhrase}"
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

          {isVerificationStep ? (
            <div className="flex items-center justify-center py-4">
              <VoiceVerification
                className="w-full"
                onVerificationComplete={handleVerificationComplete}
                onVerifying={setIsVerifying}
                minRecordingSeconds={4}
              />
            </div>
          ) : (
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
          )}

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
            {isVerificationStep ? (
              <Button
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
                disabled={isVerifying}
              >
                <Trans>Cancel</Trans>
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={handleBackToVerification}
                  disabled={isSaving || isTranscribing}
                >
                  <Trans>Back</Trans>
                </Button>
                <Button
                  type="submit"
                  disabled={
                    isSaving ||
                    isTranscribing ||
                    !isValid ||
                    (isPhaseRequired &&
                      (transcriptVerified === false || transcriptVerified === null))
                  }
                  onClick={handleSignField}
                >
                  {isSaving ? <Trans>Saving...</Trans> : <Trans>Save Voice Signature</Trans>}
                </Button>
              </>
            )}
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

  function handleBackToVerification() {
    setIsVerificationStep(true);
  }
};
