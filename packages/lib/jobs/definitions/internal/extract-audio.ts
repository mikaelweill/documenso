import { z } from 'zod';

import { ZRequestMetadataSchema } from '../../../universal/extract-request-metadata';
import { type JobDefinition } from '../../client/_internal/job';

const EXTRACT_AUDIO_JOB_DEFINITION_ID = 'internal.extract-audio';

const EXTRACT_AUDIO_JOB_DEFINITION_SCHEMA = z.object({
  enrollmentId: z.string(),
  requestMetadata: ZRequestMetadataSchema.optional(),
});

export type TExtractAudioJobDefinition = z.infer<typeof EXTRACT_AUDIO_JOB_DEFINITION_SCHEMA>;

export const EXTRACT_AUDIO_JOB_DEFINITION = {
  id: EXTRACT_AUDIO_JOB_DEFINITION_ID,
  name: 'Extract Audio from Video',
  version: '1.0.0',
  trigger: {
    name: EXTRACT_AUDIO_JOB_DEFINITION_ID,
    schema: EXTRACT_AUDIO_JOB_DEFINITION_SCHEMA,
  },
  handler: async ({ payload, io }) => {
    const handler = await import('./extract-audio.handler');

    await handler.run({ payload, io });
  },
} as const satisfies JobDefinition<typeof EXTRACT_AUDIO_JOB_DEFINITION.trigger>;
