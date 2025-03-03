'use client';

import { Trans, msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';
import { ShieldCheck, ShieldX } from 'lucide-react';

import { cn } from '../../lib/utils';
import { Alert, AlertDescription, AlertTitle } from '../alert';
import { Badge } from '../badge';

export type VerificationResultProps = {
  verified: boolean;
  score: number;
  threshold: number;
  className?: string;
  compact?: boolean;
  showDetails?: boolean;
  details?: Record<string, unknown>;
};

// Type guard to check if a value exists in details
function hasRecognitionResult(details: Record<string, unknown>): boolean {
  return !!details.recognitionResult;
}

export const VerificationResult = ({
  verified,
  score,
  threshold,
  className,
  compact = false,
  showDetails = false,
  details = {},
}: VerificationResultProps) => {
  const { _ } = useLingui();
  const percentage = Math.round(score * 100);

  // Determine confidence level text
  const getConfidenceLevel = () => {
    if (percentage >= 90) return _(msg`Very High`);
    if (percentage >= 75) return _(msg`High`);
    if (percentage >= 50) return _(msg`Medium`);
    if (percentage >= 30) return _(msg`Low`);
    return _(msg`Very Low`);
  };

  // Helper function to safely get a string value from details
  const getDetailString = (key: string): string => {
    const value = details[key];
    if (value === null || value === undefined) return '';
    return String(value);
  };

  if (compact) {
    return (
      <div className={cn('flex items-center space-x-2', className)}>
        {verified ? (
          <Badge variant="default" className="gap-1 bg-green-500 hover:bg-green-600">
            <ShieldCheck className="h-3 w-3" />
            <span>
              <Trans>Verified</Trans> ({percentage}%)
            </span>
          </Badge>
        ) : (
          <Badge variant="destructive" className="gap-1">
            <ShieldX className="h-3 w-3" />
            <span>
              <Trans>Failed</Trans>
            </span>
          </Badge>
        )}
      </div>
    );
  }

  return (
    <Alert variant={verified ? 'default' : 'destructive'} className={cn('mb-4', className)}>
      {verified ? <ShieldCheck className="h-4 w-4" /> : <ShieldX className="h-4 w-4" />}
      <AlertTitle>
        {verified ? _(msg`Voice verified successfully`) : _(msg`Voice verification failed`)}
      </AlertTitle>
      <AlertDescription>
        <div className="space-y-1">
          <p>
            {verified
              ? _(msg`Voice verified with ${getConfidenceLevel()} confidence (${percentage}%).`)
              : _(msg`We couldn't verify your voice signature.`)}
          </p>

          {showDetails && (
            <div className="mt-2 text-xs">
              <div className="flex items-center justify-between border-t pt-2">
                <span>
                  <Trans>Score</Trans>:
                </span>
                <span className="font-mono">{score.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>
                  <Trans>Threshold</Trans>:
                </span>
                <span className="font-mono">{threshold.toFixed(2)}</span>
              </div>
              {hasRecognitionResult(details) && (
                <div className="flex items-center justify-between">
                  <span>
                    <Trans>Result</Trans>:
                  </span>
                  <span className="font-mono">{getDetailString('recognitionResult')}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
};
