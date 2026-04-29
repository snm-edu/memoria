export type Confidence = 'high' | 'low' | 'none';

export interface TreemapLeaf {
  name: string;
  totalQuestions: number;
  answered: number;
  correct: number;
  correctRate: number | null;
  confidence: Confidence;
  lastDate: string;
}

export interface TreemapSubcategory {
  name: string;
  totalQuestions: number;
  answered: number;
  correctRate: number | null;
  children: TreemapLeaf[];
}

export interface TreemapCategory {
  name: string;
  totalQuestions: number;
  answered: number;
  correctRate: number | null;
  children: TreemapSubcategory[];
}

export interface TreemapRoot {
  name: string;
  totalQuestions: number;
  answered: number;
  children: TreemapCategory[];
}

export interface TreemapResponse {
  studentId: string;
  studentNumber: string;
  department: string;
  grade: number;
  updatedAt: string;
  totalQuestions: number;
  answered: number;
  tree: TreemapRoot;
}
