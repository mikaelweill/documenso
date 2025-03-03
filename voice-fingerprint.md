# Voice Fingerprinting Implementation Plan

## Overview

This document outlines the basic implementation plan for adding voice fingerprinting and verification to Documenso. The feature will allow users to enroll their voice during signup by uploading a video, extracting the audio, and then comparing subsequent voice signatures against this enrolled voice profile to verify the signer's identity.

## Implementation Progress

### Current Status (Updated)

As of the latest update, we have made significant progress on the voice fingerprinting feature:

✅ **Implemented Database Schema**: Created the VoiceEnrollment model in schema.prisma  
✅ **Created Video Recording Component**: Implemented video-recorder.tsx for capturing enrollment videos  
✅ **Set Up S3 Storage**: Configured AWS S3 for secure storage of voice enrollment media  
✅ **Implemented Audio Extraction**: Added server-side processing to extract audio from enrollment videos  
✅ **Created Voice Enrollment API**: Built route handlers for voice enrollment submission  
✅ **Added Voice Enrollment to Signup**: Integrated voice enrollment step in the signup flow  
✅ **Implemented Media Display Component**: Created voice-enrollment-display.tsx for playback  
✅ **Added Presigned URL Support**: Implemented secure media access via presigned S3 URLs  
✅ **Improved Media Playback**: Added robust error handling and playback UI with progress tracking  
⬜ **Voice API Integration**: Pending integration with voice biometrics verification API  
⬜ **Verification Flow**: Pending implementation of verification during document signing  

### Recent Improvements

#### Secure Media Access with Presigned URLs

We've implemented a robust solution for secure media access using AWS S3 presigned URLs:

1. **API Endpoint**: Created `/api/media-presigned` endpoint that generates temporary access URLs
2. **Authentication**: Secured the endpoint with proper authentication checks
3. **S3 Integration**: Set up AWS S3 client configuration with appropriate permissions
4. **CORS Handling**: Implemented presigned URL approach to bypass CORS restrictions
5. **Media Component Updates**: Modified VoiceEnrollmentDisplay to fetch and use presigned URLs

#### Media Playback Enhancements

The VoiceEnrollmentDisplay component now includes:

1. **Playback Progress**: Added visual progress bar and time display (MM:SS format)
2. **Adaptive Playback**: Implemented fallback from video to audio when needed
3. **Error Recovery**: Added comprehensive error handling with retry functionality
4. **Loading States**: Improved UX with clear loading indicators
5. **Debugging Support**: Added detailed logging of media status for troubleshooting

#### Bug Fixes and Optimizations

1. **Fixed Infinite API Calls**: Resolved circular dependency in React useEffect that was causing infinite media-presigned API requests
2. **Improved Memory Usage**: Implemented proper cleanup of media resources and event listeners
3. **Enhanced Error Handling**: Added detailed error messages for various failure scenarios
4. **Fixed Event Handling**: Ensured proper event propagation and state management
5. **Optimized Dependencies**: Improved React dependency management with useCallback

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
  videoDuration     Float?    // Duration of the video in seconds
  profileData       Json?     // Store API-specific voice profile data
  isActive          Boolean   @default(true)
  isProcessed       Boolean   @default(false)
  processingStatus  String?   // Status of audio extraction/processing
  
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### 2. Storage Infrastructure

Files created/modified:
- ✅ `packages/lib/server-only/storage/s3-storage.ts` - Added S3 upload and presigned URL functions
- ✅ `apps/web/src/app/api/media-presigned/route.ts` - Created endpoint for generating secure access URLs
- ⬜ `packages/lib/server-only/voice-verification/voice-profile-service.ts` - Pending

### 3. API Integration

Files created:
- ✅ `apps/web/src/app/api/voice-enrollment/route.ts` - Added endpoint for voice enrollment
- ✅ `apps/web/src/app/api/voice-enrollment/extract-audio/route.ts` - Added audio extraction endpoint
- ⬜ `packages/lib/server-only/voice-verification/azure-speaker-recognition.ts` - Pending
- ⬜ `apps/web/src/app/api/voice-verification/route.ts` - Pending

### 4. UI Components

Files created:
- ✅ `packages/ui/primitives/voice-enrollment/video-recorder.tsx` - Implemented
- ✅ `packages/ui/primitives/voice-enrollment/voice-enrollment-display.tsx` - Implemented
- ⬜ `packages/ui/primitives/voice-verification/verification-result.tsx` - Pending

### 5. Integration Points

Files modified:
- ✅ `apps/web/src/app/(auth)/signup/page.tsx` - Added voice enrollment step
- ✅ `apps/web/src/components/forms/v2/signup.tsx` - Integrated voice enrollment
- ✅ `apps/web/src/app/(dashboard)/settings/profile/page.tsx` - Added voice enrollment display
- ⬜ `apps/web/src/app/(signing)/sign/[token]/voice-signature-field.tsx` - Pending
- ⬜ `packages/lib/server-only/field/sign-field-with-token.ts` - Pending

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