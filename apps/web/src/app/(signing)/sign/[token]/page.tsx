import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { setupI18nSSR } from '@documenso/lib/client-only/providers/i18n.server';
import { DOCUMENSO_ENCRYPTION_KEY } from '@documenso/lib/constants/crypto';
import { getServerComponentSession } from '@documenso/lib/next-auth/get-server-component-session';
import { getDocumentAndSenderByToken } from '@documenso/lib/server-only/document/get-document-by-token';
import { isRecipientAuthorized } from '@documenso/lib/server-only/document/is-recipient-authorized';
import { viewedDocument } from '@documenso/lib/server-only/document/viewed-document';
import { getCompletedFieldsForToken } from '@documenso/lib/server-only/field/get-completed-fields-for-token';
import { getFieldsForToken } from '@documenso/lib/server-only/field/get-fields-for-token';
import { getIsRecipientsTurnToSign } from '@documenso/lib/server-only/recipient/get-is-recipient-turn';
import { getRecipientByToken } from '@documenso/lib/server-only/recipient/get-recipient-by-token';
import { getRecipientSignatures } from '@documenso/lib/server-only/recipient/get-recipient-signatures';
import { getRecipientsForAssistant } from '@documenso/lib/server-only/recipient/get-recipients-for-assistant';
import { getUserByEmail } from '@documenso/lib/server-only/user/get-user-by-email';
import { symmetricDecrypt } from '@documenso/lib/universal/crypto';
import { extractNextHeaderRequestMetadata } from '@documenso/lib/universal/extract-request-metadata';
import { extractDocumentAuthMethods } from '@documenso/lib/utils/document-auth';
import {
  serializeFieldsForClient,
  serializeForClientComponents,
} from '@documenso/lib/utils/serialize-prisma-fields';
import { DocumentStatus, RecipientRole, SigningStatus } from '@documenso/prisma/client';

import { DocumentAuthProvider } from './document-auth-provider';
import { NoLongerAvailable } from './no-longer-available';
import { SigningProvider } from './provider';
import { SigningAuthPageView } from './signing-auth-page';
import { SigningPageView } from './signing-page-view';

export type SigningPageProps = {
  params: {
    token?: string;
  };
};

export default async function SigningPage({ params: { token } }: SigningPageProps) {
  await setupI18nSSR();

  if (!token) {
    return notFound();
  }

  const { user } = await getServerComponentSession();

  const requestHeaders = Object.fromEntries(headers().entries());

  const requestMetadata = extractNextHeaderRequestMetadata(requestHeaders);

  const [document, recipient, fields, completedFields] = await Promise.all([
    getDocumentAndSenderByToken({
      token,
      userId: user?.id,
      requireAccessAuth: false,
    }).catch(() => null),
    getRecipientByToken({ token }).catch(() => null),
    getFieldsForToken({ token }),
    getCompletedFieldsForToken({ token }),
  ]);

  if (
    !document ||
    !document.documentData ||
    !recipient ||
    document.status === DocumentStatus.DRAFT
  ) {
    return notFound();
  }

  // Serialize the fields and recipient to convert Decimal objects to plain numbers
  const serializedFields = serializeFieldsForClient(fields);
  const serializedCompletedFields = serializeFieldsForClient(completedFields);
  const serializedRecipient = serializeForClientComponents(recipient);

  // Create recipientWithFields with serialized data
  const recipientWithFields = { ...serializedRecipient, fields: serializedFields };

  const isRecipientsTurn = await getIsRecipientsTurnToSign({ token });

  if (!isRecipientsTurn) {
    return redirect(`/sign/${token}/waiting`);
  }

  const allRecipients =
    recipient.role === RecipientRole.ASSISTANT
      ? serializeForClientComponents(
          await getRecipientsForAssistant({
            token,
          }),
        )
      : [];

  const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
    documentAuth: document.authOptions,
    recipientAuth: recipient.authOptions,
  });

  const isDocumentAccessValid = await isRecipientAuthorized({
    type: 'ACCESS',
    documentAuthOptions: document.authOptions,
    recipient,
    userId: user?.id,
  });

  let recipientHasAccount: boolean | null = null;

  if (!isDocumentAccessValid) {
    recipientHasAccount = await getUserByEmail({ email: recipient?.email })
      .then((user) => !!user)
      .catch(() => false);

    return <SigningAuthPageView email={recipient.email} emailHasAccount={!!recipientHasAccount} />;
  }

  await viewedDocument({
    token,
    requestMetadata,
    recipientAccessAuth: derivedRecipientAccessAuth,
  }).catch(() => null);

  const { documentMeta } = document;

  if (recipient.signingStatus === SigningStatus.REJECTED) {
    return redirect(`/sign/${token}/rejected`);
  }

  if (
    document.status === DocumentStatus.COMPLETED ||
    recipient.signingStatus === SigningStatus.SIGNED
  ) {
    documentMeta?.redirectUrl
      ? redirect(documentMeta.redirectUrl)
      : redirect(`/sign/${token}/complete`);
  }

  if (documentMeta?.password) {
    const key = DOCUMENSO_ENCRYPTION_KEY;

    if (!key) {
      throw new Error('Missing DOCUMENSO_ENCRYPTION_KEY');
    }

    const securePassword = Buffer.from(
      symmetricDecrypt({
        key,
        data: documentMeta.password,
      }),
    ).toString('utf-8');

    documentMeta.password = securePassword;
  }

  const [recipientSignature] = await getRecipientSignatures({ recipientId: recipient.id });

  if (document.deletedAt) {
    return (
      <NoLongerAvailable
        document={serializeForClientComponents(document)}
        recipientName={recipient.name}
        recipientSignature={serializeForClientComponents(recipientSignature)}
      />
    );
  }

  // Serialize the document before passing to client components
  const serializedDocument = serializeForClientComponents(document);

  return (
    <SigningProvider
      email={recipient.email}
      fullName={user?.email === recipient.email ? user.name : recipient.name}
      signature={user?.email === recipient.email ? user.signature : undefined}
    >
      <DocumentAuthProvider
        documentAuthOptions={document.authOptions}
        recipient={serializedRecipient}
        user={user}
      >
        <SigningPageView
          recipient={recipientWithFields}
          document={serializedDocument}
          fields={serializedFields}
          completedFields={serializedCompletedFields}
          isRecipientsTurn={isRecipientsTurn}
          allRecipients={allRecipients}
        />
      </DocumentAuthProvider>
    </SigningProvider>
  );
}
