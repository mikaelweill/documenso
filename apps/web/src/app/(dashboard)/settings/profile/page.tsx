import type { Metadata } from 'next';

import { msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';

import { setupI18nSSR } from '@documenso/lib/client-only/providers/i18n.server';
import { getRequiredServerComponentSession } from '@documenso/lib/next-auth/get-server-component-session';
import { getUserVoiceEnrollment } from '@documenso/lib/server-only/voice-enrollment/get-voice-enrollment';

import { SettingsHeader } from '~/components/(dashboard)/settings/layout/header';
import { AvatarImageForm } from '~/components/forms/avatar-image';
import { ProfileForm } from '~/components/forms/profile';
import { VoiceEnrollmentDisplay } from '~/components/forms/voice-enrollment-display';

import { DeleteAccountDialog } from './delete-account-dialog';

export const metadata: Metadata = {
  title: 'Profile',
};

export default async function ProfileSettingsPage() {
  await setupI18nSSR();

  const { _ } = useLingui();
  const { user } = await getRequiredServerComponentSession();

  // Fetch the user's voice enrollment data
  const voiceEnrollment = await getUserVoiceEnrollment(user.id);

  return (
    <div>
      <SettingsHeader
        title={_(msg`Profile`)}
        subtitle={_(msg`Here you can edit your personal details.`)}
      />

      <AvatarImageForm className="mb-8 max-w-xl" user={user} />
      <ProfileForm className="mb-8 max-w-xl" user={user} />

      <div className="mb-8 max-w-xl">
        <h3 className="mb-2 text-lg font-medium">{_(msg`Voice Verification`)}</h3>
        <p className="text-muted-foreground mb-4 text-sm">
          {_(
            msg`Your voice enrollment is used to verify your identity when signing documents with voice signatures.`,
          )}
        </p>
        <VoiceEnrollmentDisplay
          videoUrl={voiceEnrollment?.videoUrl}
          audioUrl={voiceEnrollment?.audioUrl}
          duration={voiceEnrollment?.videoDuration}
        />
      </div>

      <hr className="my-4 max-w-xl" />

      <DeleteAccountDialog className="max-w-xl" user={user} />
    </div>
  );
}
