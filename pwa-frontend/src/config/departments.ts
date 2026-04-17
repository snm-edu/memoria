// pwa-frontend/src/config/departments.ts
// 学科メタデータの Single Source of Truth

export type ColorSet = { gradient: string; border: string; color: string };

export interface DepartmentEntry {
  id: string;
  label: string;
  shortLabel: string;
  enabled: boolean;
  color: ColorSet;
  imagePrefix: string;
  dataVersion: number;
  grades: readonly number[];
  orderIndex: number;
}

// ラベルは CLAUDE.md の学校公式学科名に準拠
const REGISTRY_DATA = [
  {
    id: 'nursing' as const,
    label: '看護学科',
    shortLabel: 'NRS',
    enabled: true,
    color: { gradient: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 50%, #fed7aa 100%)', border: '#fdba74', color: '#c2410c' },
    imagePrefix: 'nrs_',
    dataVersion: 1,
    grades: [1, 2, 3] as const,
    orderIndex: 1,
  },
  {
    id: 'orthoptist' as const,
    label: '視能訓練学科',
    shortLabel: 'CO',
    enabled: true,
    color: { gradient: 'linear-gradient(135deg, #fdf2f8 0%, #fce7f3 50%, #fbcfe8 100%)', border: '#f9a8d4', color: '#be185d' },
    imagePrefix: 'co_',
    dataVersion: 1,
    grades: [1, 2, 3] as const,
    orderIndex: 2,
  },
  {
    id: 'dental_hyg' as const,
    label: '歯科衛生学科',
    shortLabel: 'DH',
    enabled: true,
    color: { gradient: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 50%, #a7f3d0 100%)', border: '#6ee7b7', color: '#047857' },
    imagePrefix: 'dh_',
    dataVersion: 1,
    grades: [1, 2, 3] as const,
    orderIndex: 3,
  },
  {
    id: 'clinical_eng' as const,
    label: '臨床工学科',
    shortLabel: 'CE',
    enabled: true,
    color: { gradient: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 50%, #bfdbfe 100%)', border: '#93c5fd', color: '#1d4ed8' },
    imagePrefix: 'ce_',
    dataVersion: 1,
    grades: [1, 2, 3] as const,
    orderIndex: 4,
  },
] as const;

export type Department = typeof REGISTRY_DATA[number]['id'];

export const DEPARTMENT_REGISTRY: readonly DepartmentEntry[] = REGISTRY_DATA as unknown as readonly DepartmentEntry[];

export const DEPARTMENT_LABELS: Record<Department, string> = Object.fromEntries(
  REGISTRY_DATA.map(d => [d.id, d.label])
) as Record<Department, string>;

export const DEPARTMENTS: Department[] = (REGISTRY_DATA as readonly { id: Department; enabled: boolean; orderIndex: number }[])
  .filter(d => d.enabled)
  .sort((a, b) => a.orderIndex - b.orderIndex)
  .map(d => d.id);

export const AVAILABLE_DEPARTMENTS: Department[] = DEPARTMENTS;

export const DEPT_STYLES: Record<Department, ColorSet> = Object.fromEntries(
  REGISTRY_DATA.map(d => [d.id, d.color])
) as Record<Department, ColorSet>;

export const GRADES = [1, 2, 3] as const;

export function getDepartment(id: Department): DepartmentEntry {
  const entry = REGISTRY_DATA.find(d => d.id === id);
  if (!entry) throw new Error(`Unknown department: ${id}`);
  return entry as unknown as DepartmentEntry;
}

export function getLabel(id: Department): string {
  return DEPARTMENT_LABELS[id];
}
