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
      // Convert audio blob to base64 string
      const reader = new FileReader();

      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const base64data = reader.result as string;
          // Remove the data URL prefix
          const base64 = base64data.split(',')[1];
          resolve(base64);
        };
      });

      reader.readAsDataURL(voiceData.audioBlob);

      const base64 = await base64Promise;

      if (onSignField) {
        await onSignField({
          token,
          fieldId: field.id,
          value: base64,
          isBase64: true,
        });
      } else {
        await signFieldWithToken({
          token,
          fieldId: field.id,
          value: base64,
          isBase64: true,
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
                Please record your voice or upload an audio file to use as your voice signature.
              </Trans>
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-center py-4">
            <VoiceSignaturePad
              className="h-24 w-full"
              onChange={setVoiceData}
              onValidityChange={setIsValid}
              containerClassName="w-full"
            />
          </div>

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
