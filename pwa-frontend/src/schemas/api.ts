import { z } from 'zod';

export const ErrorAnalysisSchema = z.object({
  error_type: z.enum(['knowledge_gap', 'misread', 'confusion']),
  analysis: z.string(),
  key_concept: z.string().optional(),
  study_hint: z.string().optional(),
  cheer: z.string().optional(),
});

export type ErrorAnalysisValidated = z.infer<typeof ErrorAnalysisSchema>;
