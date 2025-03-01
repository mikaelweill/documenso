import { prisma } from '@documenso/prisma';

export interface GetRecipientsForDocumentOptions {
  documentId: number;
  userId: number;
  teamId?: number;
  includeSignatures?: boolean;
}

export const getRecipientsForDocument = async ({
  documentId,
  userId,
  teamId,
  includeSignatures = false,
}: GetRecipientsForDocumentOptions) => {
  const recipients = await prisma.recipient.findMany({
    where: {
      documentId,
      document: teamId
        ? {
            team: {
              id: teamId,
              members: {
                some: {
                  userId,
                },
              },
            },
          }
        : {
            userId,
            teamId: null,
          },
    },
    include: includeSignatures
      ? {
          signatures: true,
        }
      : undefined,
    orderBy: {
      id: 'asc',
    },
  });

  return recipients;
};
