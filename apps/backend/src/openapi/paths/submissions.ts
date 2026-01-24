import type { OpenApiContext } from '../context.js';

export function registerSubmissionsPaths(ctx: OpenApiContext) {
  const { registerJsonPath, genericArraySchema, genericObjectSchema } = ctx.responses;
  const {
    CreateSubmissionForm,
    ImportMemeBody,
    CreatePoolSubmissionBody,
    ResubmitSubmissionBody,
  } = ctx.schemas;
  const { idParam } = ctx.params;

  registerJsonPath({
    method: 'post',
    path: '/submissions',
    tags: ['Submissions'],
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: CreateSubmissionForm,
            example: {
              title: 'My meme',
              type: 'video',
              notes: 'First upload',
              tags: ['demo'],
            },
          },
        },
      },
    },
    responseSchema: genericObjectSchema,
    responseExample: {
      id: '92a2b6a7-148c-47ef-8a9c-1d7f2f0f6d2d',
      status: 'pending',
      title: 'My meme',
    },
  });

  registerJsonPath({
    method: 'post',
    path: '/submissions/import',
    tags: ['Submissions'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: ImportMemeBody,
            example: {
              title: 'Imported meme',
              sourceUrl: 'https://memalerts.com/memes/123',
              notes: 'Imported from pool',
              tags: ['demo'],
            },
          },
        },
      },
    },
  });

  registerJsonPath({
    method: 'post',
    path: '/submissions/pool',
    tags: ['Submissions'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreatePoolSubmissionBody,
            example: {
              channelId: 'ae2d1d19-c6fb-4b77-9c9b-22e4ff1f0c4a',
              memeAssetId: '5f2d3a1d-7b9b-4f51-8b26-3fd8b4f9d991',
              title: 'Pool meme',
            },
          },
        },
      },
    },
  });

  registerJsonPath({
    method: 'get',
    path: '/submissions/mine',
    tags: ['Submissions'],
    responseSchema: genericArraySchema,
  });

  registerJsonPath({
    method: 'post',
    path: '/submissions/:id/resubmit',
    tags: ['Submissions'],
    request: {
      params: idParam,
      body: {
        content: {
          'application/json': {
            schema: ResubmitSubmissionBody,
            example: {
              title: 'Fixed title',
              notes: 'Updated after feedback',
              tags: ['demo'],
            },
          },
        },
      },
    },
  });

  registerJsonPath({
    method: 'get',
    path: '/submissions',
    tags: ['Submissions'],
    responseSchema: genericArraySchema,
  });
}
