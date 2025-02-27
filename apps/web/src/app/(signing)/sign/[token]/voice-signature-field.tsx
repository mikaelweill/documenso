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

  const { mutateAsync: signFieldWithToken, isPending: isSignFieldWithTokenLoading } =
    trpc.field.signFieldWithToken.useMutation(DO_NOT_INVALIDATE_QUERY_ON_MUTATION);

  const {
    mutateAsync: removeSignedFieldWithToken,
    isPending: isRemoveSignedFieldWithTokenLoading,
  } = trpc.field.removeSignedFieldWithToken.useMutation(DO_NOT_INVALIDATE_QUERY_ON_MUTATION);

  const isLoading = isSignFieldWithTokenLoading || isRemoveSignedFieldWithTokenLoading || isPending;

  const handleSignField = useCallback(async () => {
    if (!voiceData) {
      return;
    }

    try {
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

      // Create metadata object with transcript
      const metadata = {
        transcript: voiceData.transcript || '',
        duration: voiceData.duration,
      };

      // Convert metadata to string for storage
      const metadataValue = JSON.stringify(metadata);

      // Debug logging
      console.log('🔍 Metadata being saved:', {
        metadataValue: metadataValue.substring(0, 50), // Log first 50 chars
        metadataLength: metadataValue.length,
        parsedBack: JSON.parse(metadataValue),
      });

      if (onSignField) {
        await onSignField({
          token,
          fieldId: field.id,
          value: base64,
          isBase64: true,
          metadata: metadataValue, // Add metadata with transcript
        });
      } else {
        await signFieldWithToken({
          token,
          fieldId: field.id,
          value: base64,
          isBase64: true,
          metadata: metadataValue, // Add metadata with transcript
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
    }
  }, [_, field.id, onSignField, router, signFieldWithToken, toast, token, voiceData]);

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
          <div className="flex h-full flex-col items-center justify-center text-center">
            <MicIcon className="text-primary mb-1 h-6 w-6" />
            <span className="text-muted-foreground text-xs">
              <Trans>Voice Recorded</Trans>
            </span>
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
                // Track transcription state from the child component
                setIsTranscribing(data?.transcript === undefined && data !== null);
              }}
              onValidityChange={setIsValid}
              containerClassName="w-full"
            />
          </div>

          {/* Info about saving with or without transcript */}
          {voiceData && isTranscribing && (
            <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-900">
              <p className="flex items-start gap-2">
                <span className="mt-0.5 flex-shrink-0">ℹ️</span>
                <Trans>
                  You can save your voice signature now, or wait for the transcription to complete.
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
              <Trans>Save</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
