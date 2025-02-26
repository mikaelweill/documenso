'use client';

import { useEffect, useId, useLayoutEffect, useState } from 'react';

import { Trans, msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';
import { LucideChevronDown, LucideChevronUp } from 'lucide-react';

import { useThrottleFn } from '@documenso/lib/client-only/hooks/use-throttle-fn';
import { validateFieldsInserted } from '@documenso/lib/utils/fields';
import type { DocumentMeta, TemplateMeta } from '@documenso/prisma/client';
import {
  type DocumentData,
  type Field,
  FieldType,
  RecipientRole,
  SigningStatus,
} from '@documenso/prisma/client';
import type { RecipientWithFields } from '@documenso/prisma/types/recipient-with-fields';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Label } from '@documenso/ui/primitives/label';
import { LazyPDFViewer } from '@documenso/ui/primitives/lazy-pdf-viewer';
import { RadioGroup, RadioGroupItem } from '@documenso/ui/primitives/radio-group';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { useRequiredSigningContext } from '~/app/(signing)/sign/[token]/provider';
import { RecipientProvider } from '~/app/(signing)/sign/[token]/recipient-context';
import { RejectDocumentDialog } from '~/app/(signing)/sign/[token]/reject-document-dialog';

import { EmbedClientLoading } from '../../client-loading';
import { EmbedDocumentCompleted } from '../../completed';
import { EmbedDocumentRejected } from '../../rejected';
import { injectCss } from '../../util';
import { ZSignDocumentEmbedDataSchema } from './schema';

export type EmbedSignDocumentClientPageProps = {
  token: string;
  documentId: number;
  documentData: DocumentData;
  recipient: RecipientWithFields;
  fields: Field[];
  metadata?: DocumentMeta | TemplateMeta | null;
  isCompleted?: boolean;
  hidePoweredBy?: boolean;
  allowWhitelabelling?: boolean;
  allRecipients?: RecipientWithFields[];
};

export const EmbedSignDocumentClientPage = ({
  token,
  documentId,
  documentData,
  recipient,
  fields,
  metadata,
  isCompleted,
  hidePoweredBy = false,
  allowWhitelabelling = false,
  allRecipients = [],
}: EmbedSignDocumentClientPageProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();

  const {
    fullName,
    email,
    signature,
    signatureValid,
    setFullName,
    setSignature,
    setSignatureValid,
  } = useRequiredSigningContext();

  const [hasFinishedInit, setHasFinishedInit] = useState(false);
  const [hasDocumentLoaded, setHasDocumentLoaded] = useState(false);
  const [hasCompletedDocument, setHasCompletedDocument] = useState(isCompleted);
  const [hasRejectedDocument, setHasRejectedDocument] = useState(
    recipient.signingStatus === SigningStatus.REJECTED,
  );
  const [selectedSignerId, setSelectedSignerId] = useState<number | null>(
    allRecipients.length > 0 ? allRecipients[0].id : null,
  );

  const [isExpanded, setIsExpanded] = useState(false);
  const [isNameLocked, setIsNameLocked] = useState(false);
  const [showPendingFieldTooltip, setShowPendingFieldTooltip] = useState(false);

  const [allowDocumentRejection, setAllowDocumentRejection] = useState(false);

  const selectedSigner = allRecipients.find((r) => r.id === selectedSignerId);
  const isAssistantMode = recipient.role === RecipientRole.ASSISTANT;

  const [throttledOnCompleteClick, isThrottled] = useThrottleFn(() => void onCompleteClick(), 500);

  const [pendingFields, _completedFields] = [
    fields.filter((field) => field.recipientId === recipient.id && !field.inserted),
    fields.filter((field) => field.inserted),
  ];

  const { mutateAsync: completeDocumentWithToken, isPending: isSubmitting } =
    trpc.recipient.completeDocumentWithToken.useMutation();

  const hasSignatureField = fields.some((field) => field.type === FieldType.SIGNATURE);

  const assistantSignersId = useId();

  const onNextFieldClick = () => {
    validateFieldsInserted(fields);

    setShowPendingFieldTooltip(true);
    setIsExpanded(false);
  };

  const onCompleteClick = async () => {
    try {
      if (hasSignatureField && !signatureValid) {
        return;
      }

      const valid = validateFieldsInserted(fields);

      if (!valid) {
        setShowPendingFieldTooltip(true);
        return;
      }

      await completeDocumentWithToken({
        documentId,
        token,
      });

      if (window.parent) {
        window.parent.postMessage(
          {
            action: 'document-completed',
            data: {
              token,
              documentId,
              recipientId: recipient.id,
            },
          },
          '*',
        );
      }

      setHasCompletedDocument(true);
    } catch (err) {
      if (window.parent) {
        window.parent.postMessage(
          {
            action: 'document-error',
            data: null,
          },
          '*',
        );
      }

      toast({
        title: _(msg`Something went wrong`),
        description: _(
          msg`We were unable to submit this document at this time. Please try again later.`,
        ),
        variant: 'destructive',
      });
    }
  };

  const onDocumentRejected = (reason: string) => {
    if (window.parent) {
      window.parent.postMessage(
        {
          action: 'document-rejected',
          data: {
            token,
            documentId,
            recipientId: recipient.id,
            reason,
          },
        },
        '*',
      );
    }

    setHasRejectedDocument(true);
  };

  useLayoutEffect(() => {
    const hash = window.location.hash.slice(1);

    try {
      const data = ZSignDocumentEmbedDataSchema.parse(JSON.parse(decodeURIComponent(atob(hash))));

      if (!isCompleted && data.name) {
        setFullName(data.name);
      }

      // Since a recipient can be provided a name we can lock it without requiring
      // a to be provided by the parent application, unlike direct templates.
      setIsNameLocked(!!data.lockName);
      setAllowDocumentRejection(!!data.allowDocumentRejection);

      if (data.darkModeDisabled) {
        document.documentElement.classList.add('dark-mode-disabled');
      }

      if (allowWhitelabelling) {
        injectCss({
          css: data.css,
          cssVars: data.cssVars,
        });
      }
    } catch (err) {
      console.error(err);
    }

    setHasFinishedInit(true);

    // !: While the two setters are stable we still want to ensure we're avoiding
    // !: re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hasFinishedInit && hasDocumentLoaded && window.parent) {
      window.parent.postMessage(
        {
          action: 'document-ready',
          data: null,
        },
        '*',
      );
    }
  }, [hasFinishedInit, hasDocumentLoaded]);

  if (hasRejectedDocument) {
    return <EmbedDocumentRejected name={fullName} />;
  }

  if (hasCompletedDocument) {
    return (
      <EmbedDocumentCompleted
        name={fullName}
        signature={
          {
            id: 1,
            fieldId: 1,
            recipientId: 1,
            created: new Date(),
            signatureImageAsBase64: signature?.startsWith('data:') ? signature : null,
            typedSignature: signature?.startsWith('data:') ? null : signature,
            voiceSignatureUrl: null,
            voiceSignatureTranscript: null,
            voiceSignatureMetadata: null,
            voiceSignatureCreatedAt: null,
            voiceEnrollmentId: null,
          } as Signature
        }
      />
    );
  }

  return (
    <RecipientProvider recipient={recipient} targetSigner={selectedSigner ?? null}>
      <div className="embed--Root relative mx-auto flex min-h-[100dvh] max-w-screen-lg flex-col items-center justify-center p-6">
        {(!hasFinishedInit || !hasDocumentLoaded) && <EmbedClientLoading />}

        {allowDocumentRejection && (
          <div className="embed--Actions mb-4 flex w-full flex-row-reverse items-baseline justify-between">
            <RejectDocumentDialog
              document={{ id: documentId }}
              token={token}
              onRejected={onDocumentRejected}
            />
          </div>
        )}

        <div className="embed--DocumentContainer relative flex w-full flex-col gap-x-6 gap-y-12 md:flex-row">
          {/* Viewer */}
          <div className="embed--DocumentViewer flex-1">
            <LazyPDFViewer
              documentData={documentData}
              onDocumentLoad={() => setHasDocumentLoaded(true)}
            />
          </div>

          {/* Widget */}
          <div
            key={isExpanded ? 'expanded' : 'collapsed'}
            className="embed--DocumentWidgetContainer group/document-widget fixed bottom-8 left-0 z-50 h-fit w-full flex-shrink-0 px-6 md:sticky md:top-4 md:z-auto md:w-[350px] md:px-0"
            data-expanded={isExpanded || undefined}
          >
            <div className="embed--DocumentWidget border-border bg-widget flex w-full flex-col rounded-xl border px-4 py-4 md:py-6">
              {/* Header */}
              <div className="embed--DocumentWidgetHeader">
                <div className="flex items-center justify-between gap-x-2">
                  <h3 className="text-foreground text-xl font-semibold md:text-2xl">
                    {isAssistantMode ? (
                      <Trans>Assist with signing</Trans>
                    ) : (
                      <Trans>Sign document</Trans>
                    )}
                  </h3>

                  <Button variant="outline" className="h-8 w-8 p-0 md:hidden">
                    {isExpanded ? (
                      <LucideChevronDown
                        className="text-muted-foreground h-5 w-5"
                        onClick={() => setIsExpanded(false)}
                      />
                    ) : (
                      <LucideChevronUp
                        className="text-muted-foreground h-5 w-5"
                        onClick={() => setIsExpanded(true)}
                      />
                    )}
                  </Button>
                </div>
              </div>

              <div className="embed--DocumentWidgetContent hidden group-data-[expanded]/document-widget:block md:block">
                <p className="text-muted-foreground mt-2 text-sm">
                  {isAssistantMode ? (
                    <Trans>Help complete the document for other signers.</Trans>
                  ) : (
                    <Trans>Sign the document to complete the process.</Trans>
                  )}
                </p>

                <hr className="border-border mb-8 mt-4" />
              </div>

              {/* Form */}
              <div className="embed--DocumentWidgetForm -mx-2 hidden px-2 group-data-[expanded]/document-widget:block md:block">
                <div className="flex flex-1 flex-col gap-y-4">
                  {isAssistantMode && (
                    <div>
                      <Label>
                        <Trans>Signing for</Trans>
                      </Label>

                      <fieldset className="dark:bg-background border-border mt-2 rounded-2xl border bg-white p-3">
                        <RadioGroup
                          className="gap-0 space-y-3 shadow-none"
                          value={selectedSignerId?.toString()}
                          onValueChange={(value) => setSelectedSignerId(Number(value))}
                        >
                          {allRecipients
                            .filter((r) => r.fields.length > 0)
                            .map((r) => (
                              <div
                                key={`${assistantSignersId}-${r.id}`}
                                className="flex items-center gap-x-1.5"
                              >
                                <RadioGroupItem
                                  className="h-4 w-4 shrink-0"
                                  value={r.id.toString()}
                                  id={`signer-${r.id}`}
                                />

                                <Label htmlFor={`signer-${r.id}`} className="text-sm">
                                  {r.name} ({r.email})
                                </Label>
                              </div>
                            ))}
                        </RadioGroup>
                      </fieldset>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </RecipientProvider>
  );
};
