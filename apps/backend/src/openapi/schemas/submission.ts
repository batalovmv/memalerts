import { z, type ZodTypeAny } from 'zod';
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  approveSubmissionSchema,
  bulkSubmissionsSchema,
  createPoolSubmissionSchema,
  createSubmissionSchema,
  importMemeSchema,
  needsChangesSubmissionSchema,
  rejectSubmissionSchema,
  resubmitSubmissionSchema,
} from '../../shared/schemas.js';

export type SubmissionSchemas = {
  CreateSubmissionForm: ZodTypeAny;
  ImportMemeBody: ZodTypeAny;
  CreatePoolSubmissionBody: ZodTypeAny;
  ResubmitSubmissionBody: ZodTypeAny;
  ApproveSubmissionBody: ZodTypeAny;
  RejectSubmissionBody: ZodTypeAny;
  NeedsChangesSubmissionBody: ZodTypeAny;
  BulkSubmissionsBody: ZodTypeAny;
};

export function registerSubmissionSchemas(registry: OpenAPIRegistry): SubmissionSchemas {
  const CreateSubmissionForm = registry.register(
    'CreateSubmissionForm',
    createSubmissionSchema.extend({
      file: z.string().openapi({ format: 'binary', description: 'Video file upload' }),
    })
  );

  const ImportMemeBody = registry.register('ImportMemeBody', importMemeSchema);
  const CreatePoolSubmissionBody = registry.register('CreatePoolSubmissionBody', createPoolSubmissionSchema);
  const ResubmitSubmissionBody = registry.register('ResubmitSubmissionBody', resubmitSubmissionSchema);
  const ApproveSubmissionBody = registry.register('ApproveSubmissionBody', approveSubmissionSchema);
  const RejectSubmissionBody = registry.register('RejectSubmissionBody', rejectSubmissionSchema);
  const NeedsChangesSubmissionBody = registry.register('NeedsChangesSubmissionBody', needsChangesSubmissionSchema);
  const BulkSubmissionsBody = registry.register('BulkSubmissionsBody', bulkSubmissionsSchema);

  return {
    CreateSubmissionForm,
    ImportMemeBody,
    CreatePoolSubmissionBody,
    ResubmitSubmissionBody,
    ApproveSubmissionBody,
    RejectSubmissionBody,
    NeedsChangesSubmissionBody,
    BulkSubmissionsBody,
  };
}
