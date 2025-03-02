# Voice Fingerprinting Implementation Plan

## Overview

This document outlines the basic implementation plan for adding voice fingerprinting and verification to Documenso. The feature will allow users to enroll their voice during signup by uploading a video, extracting the audio, and then comparing subsequent voice signatures against this enrolled voice profile to verify the signer's identity.

## Recommended Voice Verification APIs

For implementing voice biometrics, these are the leading third-party APIs to consider:

| API | Strengths | Considerations |
|-----|-----------|----------------|
| **Microsoft Azure Speaker Recognition** | - High accuracy<br>- Text-independent & text-dependent options<br>- Well-documented<br>- GDPR compliant | - Subscription required<br>- Cloud-based processing |
| **Amazon Voice ID** | - Part of AWS ecosystem<br>- Fraud detection features<br>- Scalable | - Primarily designed for call centers<br>- May require adapting for document signing |
| **VoiceIt API** | - Purpose-built for voice authentication<br>- Simple implementation<br>- Multiple authentication methods | - Smaller provider<br>- May have higher per-transaction costs |
| **Speechmatics** | - High accuracy across accents<br>- Flexible deployment options | - More focused on transcription<br>- Speaker ID is a secondary feature |

**Recommendation**: Microsoft Azure Speaker Recognition API provides the best balance of accuracy, features, and enterprise-grade security for this use case.

## Implementation Components

### 1. Database Schema Updates

File: `packages/prisma/schema.prisma`

```prisma
// Add to User model
model User {
  // Existing fields...
  
  // Voice fingerprint fields
  voiceEnrollmentComplete Boolean @default(false)
  voiceProfileId          String?
  voiceEnrollmentDate     DateTime?
  
  // Relations
  voiceEnrollments        VoiceEnrollment[]
}

// New model for voice enrollment
model VoiceEnrollment {
  id                String    @id @default(cuid())
  userId            Int
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  videoUrl          String?   // URL to stored enrollment video
  audioUrl          String?   // URL to extracted audio
  profileData       Json?     // Store API-specific voice profile data
  isActive          Boolean   @default(true)
  
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### 2. Storage Infrastructure

Files to create/modify:
- `packages/lib/server-only/storage/voice-enrollment-storage.ts`
- `packages/lib/server-only/voice-verification/voice-profile-service.ts`

### 3. API Integration

Files to create:
- `packages/lib/server-only/voice-verification/azure-speaker-recognition.ts` (or appropriate API)
- `apps/web/src/app/api/voice-enrollment/route.ts`
- `apps/web/src/app/api/voice-verification/route.ts`

### 4. UI Components

Files to create:
- `packages/ui/primitives/voice-enrollment/video-recorder.tsx`
- `packages/ui/primitives/voice-enrollment/enrollment-status.tsx`
- `packages/ui/primitives/voice-verification/verification-result.tsx`

### 5. Integration Points

Files to modify:
- `apps/web/src/app/(auth)/signup/page.tsx` (or appropriate signup flow)
- `apps/web/src/app/(signing)/sign/[token]/voice-signature-field.tsx`
- `packages/lib/server-only/field/sign-field-with-token.ts`

## Implementation Steps

### Phase 1: Voice Enrollment

1. **Video Upload Component**
   - Create a component to record or upload video during signup
   - Implement browser-based video recording with fallback to file upload
   - Add guidance for users on what to say for enrollment

2. **Audio Extraction**
   - Extract audio track from uploaded video
   - Convert to appropriate format for voice fingerprinting API
   - Validate audio quality is sufficient for enrollment

3. **Voice Profile Creation**
   - Integrate with chosen API to create voice profile
   - Store profile ID and relevant metadata in database
   - Implement error handling and retry mechanisms

4. **Enrollment Status Tracking**
   - Add enrollment status indicators to user profile
   - Create admin dashboard component to view enrollment status
   - Implement forced re-enrollment for low-quality profiles

### Phase 2: Voice Verification

1. **Verification Flow Integration**
   - Modify voice signature field to include verification step
   - Add verification status to signature metadata
   - Implement confidence scoring for verification results

2. **Error Handling**
   - Create fallback mechanisms when verification fails
   - Implement progressive security (low/medium/high confidence levels)
   - Add manual review option for failed verifications

3. **Security Enhancements**
   - Add anti-spoofing measures (random phrases, etc.)
   - Implement encryption for voice data in transit and at rest
   - Add audit logging for all verification attempts

4. **User Experience**
   - Add verification status indicators
   - Implement clear feedback when verification fails
   - Create help documentation for voice verification issues

## File Structure Changes

```
packages/
  ├── lib/
  │   └── server-only/
  │       ├── voice-verification/
  │       │   ├── azure-speaker-recognition.ts
  │       │   ├── voice-profile-service.ts
  │       │   └── verification-service.ts
  │       └── storage/
  │           └── voice-enrollment-storage.ts
  └── ui/
      └── primitives/
          ├── voice-enrollment/
          │   ├── video-recorder.tsx
          │   └── enrollment-status.tsx
          └── voice-verification/
              └── verification-result.tsx

apps/
  └── web/
      └── src/
          ├── app/
          │   ├── api/
          │   │   ├── voice-enrollment/
          │   │   │   └── route.ts
          │   │   └── voice-verification/
          │   │       └── route.ts
          │   ├── (auth)/
          │   │   └── signup/
          │   │       ├── page.tsx
          │   │       └── voice-enrollment-step.tsx
          │   └── (signing)/
          │       └── sign/
          │           └── [token]/
          │               └── voice-signature-field.tsx (modify)
          └── components/
              └── voice-enrollment/
                  └── enrollment-wizard.tsx
```

## Technical Approach

1. **Enrollment Process**:
   - During signup, after basic information collection
   - User records video saying a predetermined phrase
   - Backend extracts audio and sends to voice API
   - API creates voice profile and returns profile ID
   - Store profile ID in user record

2. **Verification Process**:
   - User records voice signature using existing component
   - Send audio to verification API with user's profile ID
   - API returns confidence score and verification result
   - Store verification result in signature metadata
   - Proceed or reject based on verification outcome

3. **Progressive Enhancement**:
   - Initial implementation: voice verification is informational only
   - Second stage: require minimum confidence score
   - Final stage: require high confidence for sensitive documents

## Next Steps (Immediate)

1. Select and set up voice verification API account
2. Update database schema and create migrations
3. Implement basic video recording component
4. Create audio extraction service
5. Integrate with chosen API for voice profile creation
6. Modify sign flow to include verification check

## Future Enhancements

1. Multiple enrollment samples to improve accuracy
2. Periodic re-enrollment to maintain accuracy
3. Fraud detection based on voice patterns
4. On-premise processing option for enhanced privacy
5. Integration with other biometric verification methods 