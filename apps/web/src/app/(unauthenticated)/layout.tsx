import React from 'react';

import Image from 'next/image';

import { getServerSession } from 'next-auth';

import backgroundPattern from '@documenso/assets/images/background-pattern.png';
import { setupI18nSSR } from '@documenso/lib/client-only/providers/i18n.server';
import { NEXT_AUTH_OPTIONS } from '@documenso/lib/next-auth/auth-options';

import { NextAuthProvider } from '~/providers/next-auth';

type UnauthenticatedLayoutProps = {
  children: React.ReactNode;
};

export default async function UnauthenticatedLayout({ children }: UnauthenticatedLayoutProps) {
  await setupI18nSSR();

  const session = await getServerSession(NEXT_AUTH_OPTIONS);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-12 md:p-12 lg:p-24">
      <NextAuthProvider session={session}>
        <div>
          <div className="absolute -inset-[min(600px,max(400px,60vw))] -z-[1] flex items-center justify-center opacity-70">
            <Image
              src={backgroundPattern}
              alt="background pattern"
              className="dark:brightness-95 dark:contrast-[70%] dark:invert dark:sepia"
              style={{
                mask: 'radial-gradient(rgba(255, 255, 255, 1) 0%, transparent 80%)',
                WebkitMask: 'radial-gradient(rgba(255, 255, 255, 1) 0%, transparent 80%)',
              }}
            />
          </div>

          <div className="relative w-full">{children}</div>
        </div>
      </NextAuthProvider>
    </main>
  );
}
