export type Confidence = 'high' | 'low' | 'none';

export interface TreemapLeaf {
  name: string;
  totalQuestions: number;
  answered: number;
  correct: number;
  correctRate: number | null;
  confidence: Confidence;
  lastDate: string;
  isAggregate?: boolean;
  aggregateLeaves?: TreemapLeaf[];
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

export type FocusPath = string[]; // 例: [], ['医用電気電子工学'], ['医用電気電子工学', '電気工学']
