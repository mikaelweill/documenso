import { forwardRef } from 'react';

import type { LucideIcon } from 'lucide-react/dist/lucide-react';

export const VoiceSignatureIcon: LucideIcon = forwardRef(
  (
    { size = 24, color = 'currentColor', strokeWidth = 1.33, absoluteStrokeWidth, ...props },
    ref,
  ) => {
    return (
      <svg
        ref={ref}
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path
          d="M8 1C8.53043 1 9.03914 1.21071 9.41421 1.58579C9.78929 1.96086 10 2.46957 10 3V8C10 8.53043 9.78929 9.03914 9.41421 9.41421C9.03914 9.78929 8.53043 10 8 10C7.46957 10 6.96086 9.78929 6.58579 9.41421C6.21071 9.03914 6 8.53043 6 8V3C6 2.46957 6.21071 1.96086 6.58579 1.58579C6.96086 1.21071 7.46957 1 8 1Z"
          stroke={color}
          strokeWidth={
            absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth
          }
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M13 7.5V8C13 9.5913 12.3679 11.1174 11.2426 12.2426C10.1174 13.3679 8.5913 14 7 14C5.4087 14 3.88258 13.3679 2.75736 12.2426C1.63214 11.1174 1 9.5913 1 8V7.5"
          stroke={color}
          strokeWidth={
            absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth
          }
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M7 14V15.5M9 14V15.5"
          stroke={color}
          strokeWidth={
            absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth
          }
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M2.5 11C4.5 13 11.5 13 13.5 11"
          stroke={color}
          strokeWidth={
            absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth
          }
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  },
);

VoiceSignatureIcon.displayName = 'VoiceSignatureIcon';
