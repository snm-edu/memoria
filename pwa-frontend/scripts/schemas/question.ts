import { z } from 'zod';

// department は実行時に registry から注入するので string に限定しない
export const QuestionSchema = z.object({
  question_id: z.string().min(1),
  department: z.string().min(1),
  exam_year: z.union([z.number(), z.string()]),
  category: z.string(),
  subcategory: z.string().optional(),
  difficulty: z.number().min(1).max(5),
  question_text: z.string().min(1),
  choices: z.array(z.string()).min(4),
  correct_answer: z.array(z.string()).min(1),
  explanation: z.string().optional(),
  has_image: z.boolean().optional(),
  image_url: z.string().optional(),
});

export type Question = z.infer<typeof QuestionSchema>;
