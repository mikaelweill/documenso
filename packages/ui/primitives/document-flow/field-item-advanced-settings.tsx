'use client';

import { forwardRef, useEffect, useState } from 'react';

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';
import { match } from 'ts-pattern';

import {
  type TBaseFieldMeta as BaseFieldMeta,
  type TCheckboxFieldMeta as CheckboxFieldMeta,
  type TDateFieldMeta as DateFieldMeta,
  type TDropdownFieldMeta as DropdownFieldMeta,
  type TEmailFieldMeta as EmailFieldMeta,
  type TFieldMetaSchema as FieldMeta,
  type TInitialsFieldMeta as InitialsFieldMeta,
  type TNameFieldMeta as NameFieldMeta,
  type TNumberFieldMeta as NumberFieldMeta,
  type TRadioFieldMeta as RadioFieldMeta,
  type TTextFieldMeta as TextFieldMeta,
  type TVoiceSignatureFieldMeta as VoiceSignatureFieldMeta,
  ZFieldMetaSchema,
} from '@documenso/lib/types/field-meta';
import { FieldType } from '@documenso/prisma/client';
import { Checkbox } from '@documenso/ui/primitives/checkbox';
import { Label } from '@documenso/ui/primitives/label';
import { Textarea } from '@documenso/ui/primitives/textarea';
import { useToast } from '@documenso/ui/primitives/use-toast';

import type { FieldFormType } from './add-fields';
import {
  DocumentFlowFormContainerActions,
  DocumentFlowFormContainerContent,
  DocumentFlowFormContainerFooter,
  DocumentFlowFormContainerHeader,
} from './document-flow-root';
import { FieldItem } from './field-item';
import { CheckboxFieldAdvancedSettings } from './field-items-advanced-settings/checkbox-field';
import { DateFieldAdvancedSettings } from './field-items-advanced-settings/date-field';
import { DropdownFieldAdvancedSettings } from './field-items-advanced-settings/dropdown-field';
import { EmailFieldAdvancedSettings } from './field-items-advanced-settings/email-field';
import { InitialsFieldAdvancedSettings } from './field-items-advanced-settings/initials-field';
import { NameFieldAdvancedSettings } from './field-items-advanced-settings/name-field';
import { NumberFieldAdvancedSettings } from './field-items-advanced-settings/number-field';
import { RadioFieldAdvancedSettings } from './field-items-advanced-settings/radio-field';
import { TextFieldAdvancedSettings } from './field-items-advanced-settings/text-field';

export type FieldAdvancedSettingsProps = {
  teamId?: number;
  title: MessageDescriptor;
  description: MessageDescriptor;
  field: FieldFormType;
  fields: FieldFormType[];
  onAdvancedSettings?: () => void;
  isDocumentPdfLoaded?: boolean;
  onSave?: (fieldState: FieldMeta) => void;
};

export type FieldMetaKeys =
  | keyof BaseFieldMeta
  | keyof TextFieldMeta
  | keyof NumberFieldMeta
  | keyof RadioFieldMeta
  | keyof CheckboxFieldMeta
  | keyof DropdownFieldMeta
  | keyof InitialsFieldMeta
  | keyof NameFieldMeta
  | keyof EmailFieldMeta
  | keyof DateFieldMeta;

const VoiceSignatureFieldAdvancedSettings = ({
  fieldMeta,
  onChange,
}: {
  fieldMeta: FieldMeta;
  onChange: (value: FieldMeta) => void;
}) => {
  const { _ } = useLingui();

  // Initialize with default values for voice signature fields
  const defaultValues: VoiceSignatureFieldMeta = {
    type: 'voiceSignature',
    fontSize: 14,
    textAlign: 'left',
    requiredPhrase: '',
    strictMatching: false,
  };

  // Merge default values with any existing fieldMeta
  const voiceFieldMeta = {
    ...defaultValues,
    ...(fieldMeta as VoiceSignatureFieldMeta),
  };

  // Direct controlled component state
  const [requiredPhrase, setRequiredPhrase] = useState(voiceFieldMeta.requiredPhrase || '');
  const [strictMatching, setStrictMatching] = useState(voiceFieldMeta.strictMatching || false);

  // Update local state when fieldMeta changes from outside
  useEffect(() => {
    if (fieldMeta) {
      const typedMeta = fieldMeta as VoiceSignatureFieldMeta;
      if (typedMeta.requiredPhrase !== undefined && typedMeta.requiredPhrase !== requiredPhrase) {
        setRequiredPhrase(typedMeta.requiredPhrase);
      }
      if (typedMeta.strictMatching !== undefined && typedMeta.strictMatching !== strictMatching) {
        setStrictMatching(typedMeta.strictMatching);
      }
    }
  }, [fieldMeta]);

  // Update parent when our state changes
  useEffect(() => {
    console.log('Updating parent with:', { requiredPhrase, strictMatching });
    const updatedMeta = {
      ...voiceFieldMeta,
      requiredPhrase: requiredPhrase,
      strictMatching: strictMatching,
    };

    onChange(updatedMeta);
  }, [requiredPhrase, strictMatching]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="voice-required-phrase">Required phrase</Label>

          <Textarea
            id="voice-required-phrase"
            className="h-24 resize-none"
            placeholder={_(msg`Example: I, [Name], agree to the terms in paragraph 3.`)}
            value={requiredPhrase}
            onChange={(e) => {
              console.log(`Setting phrase to: ${e.target.value}`);
              setRequiredPhrase(e.target.value);
            }}
          />

          <p className="text-muted-foreground text-xs">
            The signer will be asked to say this phrase. Leave empty if no specific phrase is
            required.
          </p>
        </div>

        <div className="flex items-start space-x-2">
          <Checkbox
            id="strict-matching"
            checked={strictMatching}
            disabled={!requiredPhrase}
            onCheckedChange={(checked) => {
              console.log(`Setting strict matching to: ${checked}`);
              setStrictMatching(checked === true);
            }}
          />
          <div className="grid gap-1.5 leading-none">
            <Label
              htmlFor="strict-matching"
              className={!requiredPhrase ? 'cursor-not-allowed opacity-50' : ''}
            >
              Enable strict phrase matching
            </Label>
            <p className="text-muted-foreground text-xs">
              When enabled, the signer's voice must match the required phrase exactly. This provides
              stronger verification but may increase failure rates.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const getDefaultState = (fieldType: FieldType): FieldMeta => {
  switch (fieldType) {
    case FieldType.INITIALS:
      return {
        type: 'initials',
        fontSize: 14,
        textAlign: 'left',
      };
    case FieldType.NAME:
      return {
        type: 'name',
        fontSize: 14,
        textAlign: 'left',
      };
    case FieldType.EMAIL:
      return {
        type: 'email',
        fontSize: 14,
        textAlign: 'left',
      };
    case FieldType.DATE:
      return {
        type: 'date',
        fontSize: 14,
        textAlign: 'left',
      };
    case FieldType.TEXT:
      return {
        type: 'text',
        label: '',
        placeholder: '',
        text: '',
        characterLimit: 0,
        fontSize: 14,
        required: false,
        readOnly: false,
        textAlign: 'left',
      };
    case FieldType.NUMBER:
      return {
        type: 'number',
        label: '',
        placeholder: '',
        numberFormat: '',
        value: '0',
        minValue: 0,
        maxValue: 0,
        required: false,
        readOnly: false,
        fontSize: 14,
        textAlign: 'left',
      };
    case FieldType.RADIO:
      return {
        type: 'radio',
        values: [],
        required: false,
        readOnly: false,
      };
    case FieldType.CHECKBOX:
      return {
        type: 'checkbox',
        values: [],
        validationRule: '',
        validationLength: 0,
        required: false,
        readOnly: false,
      };
    case FieldType.DROPDOWN:
      return {
        type: 'dropdown',
        values: [],
        defaultValue: '',
        required: false,
        readOnly: false,
      };
    case FieldType.VOICE_SIGNATURE:
      return {
        type: 'voiceSignature',
        requiredPhrase: '',
        strictMatching: false,
        fontSize: 14,
        textAlign: 'left',
      };
    default:
      throw new Error(`Unsupported field type: ${fieldType}`);
  }
};

export const FieldAdvancedSettings = forwardRef<HTMLDivElement, FieldAdvancedSettingsProps>(
  (
    { title, description, field, fields, onAdvancedSettings, isDocumentPdfLoaded = true, onSave },
    ref,
  ) => {
    const { _ } = useLingui();
    const { toast } = useToast();

    const [errors, setErrors] = useState<string[]>([]);

    const fieldMeta = field?.fieldMeta;

    const localStorageKey = `field_${field.formId}_${field.type}`;

    const defaultState: FieldMeta = getDefaultState(field.type);

    const [fieldState, setFieldState] = useState(() => {
      const savedState = localStorage.getItem(localStorageKey);
      return savedState ? { ...defaultState, ...JSON.parse(savedState) } : defaultState;
    });

    useEffect(() => {
      if (fieldMeta && typeof fieldMeta === 'object') {
        const parsedFieldMeta = ZFieldMetaSchema.parse(fieldMeta);

        setFieldState({
          ...defaultState,
          ...parsedFieldMeta,
        });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fieldMeta]);

    const handleFieldChange = (
      key: FieldMetaKeys,
      value:
        | string
        | { checked: boolean; value: string }[]
        | { value: string }[]
        | boolean
        | number,
    ) => {
      setFieldState((prevState: FieldMeta) => {
        if (
          ['characterLimit', 'minValue', 'maxValue', 'validationLength', 'fontSize'].includes(key)
        ) {
          const parsedValue = Number(value);

          return {
            ...prevState,
            [key]: isNaN(parsedValue) ? undefined : parsedValue,
          };
        } else {
          return {
            ...prevState,
            [key]: value,
          };
        }
      });
    };

    const handleAdvancedSettingsChange = (updatedFieldMeta: FieldMeta) => {
      setFieldState(updatedFieldMeta);
      localStorage.setItem(localStorageKey, JSON.stringify(updatedFieldMeta));
      onSave?.(updatedFieldMeta);
      onAdvancedSettings?.();
    };

    const handleOnGoNextClick = () => {
      try {
        if (errors.length > 0) {
          return;
        } else {
          localStorage.setItem(localStorageKey, JSON.stringify(fieldState));

          onSave?.(fieldState);
          onAdvancedSettings?.();
        }
      } catch (error) {
        console.error('Failed to save to localStorage:', error);

        toast({
          title: _(msg`Error`),
          description: _(msg`Failed to save settings.`),
          variant: 'destructive',
        });
      }
    };

    return (
      <div
        ref={ref}
        className="flex h-full flex-col"
        onClick={(e) => {
          // We capture the click on the outer container to keep the dialog open
          // but we don't stop propagation for child elements so inputs work correctly
          e.stopPropagation();
        }}
      >
        <DocumentFlowFormContainerHeader title={title} description={description} />
        <DocumentFlowFormContainerContent>
          {isDocumentPdfLoaded &&
            fields.map((field, index) => (
              <span key={index} className="opacity-75 active:pointer-events-none">
                <FieldItem key={index} field={field} disabled={true} />
              </span>
            ))}

          {match(field.type)
            .with(FieldType.INITIALS, () => (
              <InitialsFieldAdvancedSettings
                fieldState={fieldState}
                handleFieldChange={handleFieldChange}
                handleErrors={setErrors}
              />
            ))
            .with(FieldType.NAME, () => (
              <NameFieldAdvancedSettings
                fieldState={fieldState}
                handleFieldChange={handleFieldChange}
                handleErrors={setErrors}
              />
            ))
            .with(FieldType.EMAIL, () => (
              <EmailFieldAdvancedSettings
                fieldState={fieldState}
                handleFieldChange={handleFieldChange}
                handleErrors={setErrors}
              />
            ))
            .with(FieldType.DATE, () => (
              <DateFieldAdvancedSettings
                fieldState={fieldState}
                handleFieldChange={handleFieldChange}
                handleErrors={setErrors}
              />
            ))

            .with(FieldType.TEXT, () => (
              <TextFieldAdvancedSettings
                fieldState={fieldState}
                handleFieldChange={handleFieldChange}
                handleErrors={setErrors}
              />
            ))
            .with(FieldType.NUMBER, () => (
              <NumberFieldAdvancedSettings
                fieldState={fieldState}
                handleFieldChange={handleFieldChange}
                handleErrors={setErrors}
              />
            ))
            .with(FieldType.RADIO, () => (
              <RadioFieldAdvancedSettings
                fieldState={fieldState}
                handleFieldChange={handleFieldChange}
                handleErrors={setErrors}
              />
            ))
            .with(FieldType.CHECKBOX, () => (
              <CheckboxFieldAdvancedSettings
                fieldState={fieldState}
                handleFieldChange={handleFieldChange}
                handleErrors={setErrors}
              />
            ))
            .with(FieldType.DROPDOWN, () => (
              <DropdownFieldAdvancedSettings
                fieldState={fieldState}
                handleFieldChange={handleFieldChange}
                handleErrors={setErrors}
              />
            ))
            .with(FieldType.VOICE_SIGNATURE, () => (
              <VoiceSignatureFieldAdvancedSettings
                fieldMeta={fieldState}
                onChange={(updatedMeta) => {
                  console.log('Voice signature field updated:', updatedMeta);
                  setFieldState(updatedMeta);
                  // Don't call handleAdvancedSettingsChange here to avoid closing the dialog
                  // The changes will be saved when user clicks the Save button
                }}
              />
            ))
            .otherwise(() => null)}
          {errors.length > 0 && (
            <div className="mt-4">
              <ul>
                {errors.map((error, index) => (
                  <li className="text-sm text-red-500" key={index}>
                    {error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </DocumentFlowFormContainerContent>
        <DocumentFlowFormContainerFooter className="mt-auto">
          <DocumentFlowFormContainerActions
            goNextLabel={msg`Save`}
            goBackLabel={msg`Cancel`}
            onGoBackClick={() => {
              // Use a simple callback without parameters to match the expected type
              onAdvancedSettings?.();
            }}
            onGoNextClick={() => {
              // Use a simple callback without parameters to match the expected type
              handleOnGoNextClick();
            }}
            disableNextStep={errors.length > 0}
          />
        </DocumentFlowFormContainerFooter>
      </div>
    );
  },
);

FieldAdvancedSettings.displayName = 'FieldAdvancedSettings';
