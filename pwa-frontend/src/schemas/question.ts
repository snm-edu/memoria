import { z } from 'zod';

export const QuestionSchema = z.object({
  question_id: z.string().min(1),
  department: z.string(),
  exam_year: z.union([z.number(), z.string()]),
  exam_number: z.number().optional(),
  category: z.string(),
  subcategory: z.string().optional(),
  subtopic: z.string().optional(),
  difficulty: z.number().min(1).max(5),
  question_text: z.string().min(1),
  choices: z.array(z.string()).min(1),
  correct_answer: z.array(z.string()),
  explanation: z.string().optional(),
  has_image: z.boolean().optional(),
  image_url: z.string().optional(),
  is_multi_select: z.boolean().optional(),
  source: z.string().optional(),
  created_at: z.string().optional(),
});

export type QuestionValidated = z.infer<typeof QuestionSchema>;
