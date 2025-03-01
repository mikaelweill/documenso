'use server';

import { DateTime } from 'luxon';
import { match } from 'ts-pattern';

import { validateCheckboxField } from '@documenso/lib/advanced-fields-validation/validate-checkbox';
import { validateDropdownField } from '@documenso/lib/advanced-fields-validation/validate-dropdown';
import { validateNumberField } from '@documenso/lib/advanced-fields-validation/validate-number';
import { validateRadioField } from '@documenso/lib/advanced-fields-validation/validate-radio';
import { validateTextField } from '@documenso/lib/advanced-fields-validation/validate-text';
import { fromCheckboxValue } from '@documenso/lib/universal/field-checkbox';
import { prisma } from '@documenso/prisma';
import { DocumentStatus, FieldType, RecipientRole, SigningStatus } from '@documenso/prisma/client';

import { DEFAULT_DOCUMENT_DATE_FORMAT } from '../../constants/date-formats';
import { DEFAULT_DOCUMENT_TIME_ZONE } from '../../constants/time-zones';
import { DOCUMENT_AUDIT_LOG_TYPE } from '../../types/document-audit-logs';
import type { TRecipientActionAuth } from '../../types/document-auth';
import {
  ZCheckboxFieldMeta,
  ZDropdownFieldMeta,
  ZNumberFieldMeta,
  ZRadioFieldMeta,
  ZTextFieldMeta,
} from '../../types/field-meta';
import type { RequestMetadata } from '../../universal/extract-request-metadata';
import { createDocumentAuditLogData } from '../../utils/document-audit-logs';
import { validateFieldAuth } from '../document/validate-field-auth';

export type SignFieldWithTokenOptions = {
  token: string;
  fieldId: number;
  value: string;
  isBase64?: boolean;
  metadata?: string;
  userId?: number;
  authOptions?: TRecipientActionAuth;
  requestMetadata?: RequestMetadata;
};

/**
 * Please read.
 *
 * Content within this function has been duplicated in the
 * createDocumentFromDirectTemplate file.
 *
 * Any update to this should be reflected in the other file if required.
 *
 * Todo: Extract common logic.
 */
export const signFieldWithToken = async ({
  token,
  fieldId,
  value,
  isBase64,
  metadata,
  userId,
  authOptions,
  requestMetadata,
}: SignFieldWithTokenOptions) => {
  const recipient = await prisma.recipient.findFirstOrThrow({
    where: {
      token,
    },
  });

  const field = await prisma.field.findFirstOrThrow({
    where: {
      id: fieldId,
      recipient: {
        ...(recipient.role !== RecipientRole.ASSISTANT
          ? {
              id: recipient.id,
            }
          : {
              signingStatus: {
                not: SigningStatus.SIGNED,
              },
              signingOrder: {
                gte: recipient.signingOrder ?? 0,
              },
            }),
      },
    },
    include: {
      document: {
        include: {
          recipients: true,
        },
      },
      recipient: true,
    },
  });

  const { document } = field;

  if (!document) {
    throw new Error(`Document not found for field ${field.id}`);
  }

  if (!recipient) {
    throw new Error(`Recipient not found for field ${field.id}`);
  }

  if (document.deletedAt) {
    throw new Error(`Document ${document.id} has been deleted`);
  }

  if (document.status !== DocumentStatus.PENDING) {
    throw new Error(`Document ${document.id} must be pending for signing`);
  }

  if (
    recipient.signingStatus === SigningStatus.SIGNED ||
    field.recipient.signingStatus === SigningStatus.SIGNED
  ) {
    throw new Error(`Recipient ${recipient.id} has already signed`);
  }

  if (field.inserted) {
    throw new Error(`Field ${fieldId} has already been inserted`);
  }

  // Unreachable code based on the above query but we need to satisfy TypeScript
  if (field.recipientId === null) {
    throw new Error(`Field ${fieldId} has no recipientId`);
  }

  if (field.type === FieldType.NUMBER && field.fieldMeta) {
    const numberFieldParsedMeta = ZNumberFieldMeta.parse(field.fieldMeta);
    const errors = validateNumberField(value, numberFieldParsedMeta, true);

    if (errors.length > 0) {
      throw new Error(errors.join(', '));
    }
  }

  if (field.type === FieldType.TEXT && field.fieldMeta) {
    const textFieldParsedMeta = ZTextFieldMeta.parse(field.fieldMeta);
    const errors = validateTextField(value, textFieldParsedMeta, true);

    if (errors.length > 0) {
      throw new Error(errors.join(', '));
    }
  }

  if (field.type === FieldType.CHECKBOX && field.fieldMeta) {
    const checkboxFieldParsedMeta = ZCheckboxFieldMeta.parse(field.fieldMeta);
    const checkboxFieldValues: string[] = fromCheckboxValue(value);

    const errors = validateCheckboxField(checkboxFieldValues, checkboxFieldParsedMeta, true);

    if (errors.length > 0) {
      throw new Error(errors.join(', '));
    }
  }

  if (field.type === FieldType.RADIO && field.fieldMeta) {
    const radioFieldParsedMeta = ZRadioFieldMeta.parse(field.fieldMeta);
    const errors = validateRadioField(value, radioFieldParsedMeta, true);

    if (errors.length > 0) {
      throw new Error(errors.join(', '));
    }
  }

  if (field.type === FieldType.DROPDOWN && field.fieldMeta) {
    const dropdownFieldParsedMeta = ZDropdownFieldMeta.parse(field.fieldMeta);
    const errors = validateDropdownField(value, dropdownFieldParsedMeta, true);

    if (errors.length > 0) {
      throw new Error(errors.join(', '));
    }
  }

  const derivedRecipientActionAuth = await validateFieldAuth({
    documentAuthOptions: document.authOptions,
    recipient,
    field,
    userId,
    authOptions,
  });

  const documentMeta = await prisma.documentMeta.findFirst({
    where: {
      documentId: document.id,
    },
  });

  const isSignatureField =
    field.type === FieldType.SIGNATURE || field.type === FieldType.FREE_SIGNATURE;

  const isVoiceSignatureField = field.type === FieldType.VOICE_SIGNATURE;

  let customText = !isSignatureField && !isVoiceSignatureField ? value : undefined;

  const signatureImageAsBase64 = isSignatureField && isBase64 ? value : undefined;
  const typedSignature = isSignatureField && !isBase64 ? value : undefined;
  const voiceSignatureData = isVoiceSignatureField && isBase64 ? value : undefined;

  if (field.type === FieldType.DATE) {
    customText = DateTime.now()
      .setZone(documentMeta?.timezone ?? DEFAULT_DOCUMENT_TIME_ZONE)
      .toFormat(documentMeta?.dateFormat ?? DEFAULT_DOCUMENT_DATE_FORMAT);
  }

  if (isSignatureField && !signatureImageAsBase64 && !typedSignature) {
    throw new Error('Signature field must have a signature');
  }

  if (isVoiceSignatureField && !voiceSignatureData) {
    throw new Error('Voice signature field must have a voice recording');
  }

  if (isSignatureField && !documentMeta?.typedSignatureEnabled && typedSignature) {
    throw new Error('Typed signatures are not allowed. Please draw your signature');
  }

  const assistant = recipient.role === RecipientRole.ASSISTANT ? recipient : undefined;

  return await prisma.$transaction(async (tx) => {
    const updatedField = await tx.field.update({
      where: {
        id: field.id,
      },
      data: {
        customText,
        inserted: true,
      },
    });

    if (isSignatureField) {
      const signature = await tx.signature.upsert({
        where: {
          fieldId: field.id,
        },
        create: {
          fieldId: field.id,
          recipientId: field.recipientId,
          signatureImageAsBase64: signatureImageAsBase64,
          typedSignature: typedSignature,
        },
        update: {
          signatureImageAsBase64: signatureImageAsBase64,
          typedSignature: typedSignature,
        },
      });

      // Dirty but I don't want to deal with type information
      Object.assign(updatedField, {
        signature,
      });
    }

    if (isVoiceSignatureField) {
      // Debug logging before trying to use metadata
      console.log('🔍 Server (pre-upsert): Voice signature metadata check:', {
        hasMetadata: !!metadata,
        metadataType: typeof metadata,
        metadataLength: metadata?.length,
        rawMetadata: metadata?.substring(0, 100), // Log first 100 chars
        isBase64: isBase64,
        valueLength: voiceSignatureData ? voiceSignatureData.length : 0,
      });

      try {
        // Try to parse the metadata to ensure it's valid JSON
        const parsedMetadata = metadata ? JSON.parse(metadata) : null;
        console.log('🔍 Server: Successfully parsed metadata:', {
          hasTranscript: !!parsedMetadata?.transcript,
          transcriptLength: parsedMetadata?.transcript?.length,
          transcriptPreview: parsedMetadata?.transcript?.substring(0, 50),
          duration: parsedMetadata?.duration,
        });
      } catch (error) {
        console.error('🔍 Server: Failed to parse metadata:', error, 'Raw metadata:', metadata);
      }

      const signature = await tx.signature.upsert({
        where: {
          fieldId: field.id,
        },
        create: {
          fieldId: field.id,
          recipientId: field.recipientId,
          voiceSignatureUrl: voiceSignatureData,
          voiceSignatureCreatedAt: new Date(),
          voiceSignatureMetadata: metadata,
          voiceSignatureTranscript: (() => {
            try {
              if (!metadata) return undefined;
              const parsed = JSON.parse(metadata);
              return parsed?.transcript || undefined;
            } catch (e) {
              console.error('🔍 Server: Error parsing metadata for transcript:', e);
              return undefined;
            }
          })(),
        },
        update: {
          voiceSignatureUrl: voiceSignatureData,
          voiceSignatureCreatedAt: new Date(),
          voiceSignatureMetadata: metadata,
          voiceSignatureTranscript: (() => {
            try {
              if (!metadata) return undefined;
              const parsed = JSON.parse(metadata);
              return parsed?.transcript || undefined;
            } catch (e) {
              console.error('🔍 Server: Error parsing metadata for transcript:', e);
              return undefined;
            }
          })(),
        },
      });

      // Add debug logging
      console.log('🔍 Server: Voice signature saved to database:', {
        fieldId: field.id,
        hasMetadata: !!metadata,
        extractedTranscript: (() => {
          try {
            return metadata ? JSON.parse(metadata)?.transcript?.substring(0, 50) : undefined;
          } catch (e) {
            return 'Error parsing transcript';
          }
        })(),
        savedTranscriptField: signature.voiceSignatureTranscript?.substring(0, 50),
        metadataLength: metadata?.length,
        verificationStatus: (() => {
          try {
            if (!metadata) return 'No metadata';
            const parsed = JSON.parse(metadata);
            if (parsed?.requiredPhrase) {
              return parsed?.isVerified === true ? 'Verified' : 'Failed';
            }
            return 'No verification required';
          } catch (e) {
            return 'Error parsing verification status';
          }
        })(),
      });

      // Dirty but I don't want to deal with type information
      Object.assign(updatedField, {
        signature,
      });
    }

    await tx.documentAuditLog.create({
      data: createDocumentAuditLogData({
        type:
          assistant && field.recipientId !== assistant.id
            ? DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_FIELD_PREFILLED
            : DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_FIELD_INSERTED,
        documentId: document.id,
        user: {
          email: assistant?.email ?? recipient.email,
          name: assistant?.name ?? recipient.name,
        },
        requestMetadata,
        data: {
          recipientEmail: recipient.email,
          recipientId: recipient.id,
          recipientName: recipient.name,
          recipientRole: recipient.role,
          fieldId: updatedField.secondaryId,
          field: match(updatedField.type)
            .with(FieldType.SIGNATURE, FieldType.FREE_SIGNATURE, (type) => ({
              type,
              data: signatureImageAsBase64 || typedSignature || '',
            }))
            .with(FieldType.VOICE_SIGNATURE, (type) => ({
              type,
              data: voiceSignatureData || '',
            }))
            .with(
              FieldType.DATE,
              FieldType.EMAIL,
              FieldType.NAME,
              FieldType.TEXT,
              FieldType.INITIALS,
              (type) => ({
                type,
                data: updatedField.customText,
              }),
            )
            .with(
              FieldType.NUMBER,
              FieldType.RADIO,
              FieldType.CHECKBOX,
              FieldType.DROPDOWN,
              (type) => ({
                type,
                data: updatedField.customText,
              }),
            )
            .exhaustive(),
          fieldSecurity: derivedRecipientActionAuth
            ? {
                type: derivedRecipientActionAuth,
              }
            : undefined,
        },
      }),
    });

    return updatedField;
  });
};
