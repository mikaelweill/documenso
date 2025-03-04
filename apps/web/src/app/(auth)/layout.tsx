import React from 'react';

import { getServerSession } from 'next-auth';

import { setupI18nSSR } from '@documenso/lib/client-only/providers/i18n.server';
import { NEXT_AUTH_OPTIONS } from '@documenso/lib/next-auth/auth-options';

import { NextAuthProvider } from '~/providers/next-auth';

type AuthLayoutProps = {
  children: React.ReactNode;
};

export default async function AuthLayout({ children }: AuthLayoutProps) {
  await setupI18nSSR();

  const session = await getServerSession(NEXT_AUTH_OPTIONS);

  return <NextAuthProvider session={session}>{children}</NextAuthProvider>;
}
