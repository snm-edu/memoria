import { useMemo } from 'react';
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import { interpolateRdYlGn } from 'd3-scale-chromatic';
import type {
  TreemapRoot,
  TreemapCategory,
  TreemapSubcategory,
  TreemapLeaf,
} from './treemapTypes';

interface TreemapProps {
  data: TreemapRoot;
  width: number;
  height: number;
}

type AnyNode =
  | TreemapRoot
  | TreemapCategory
  | TreemapSubcategory
  | TreemapLeaf;

function isLeaf(node: AnyNode): node is TreemapLeaf {
  return !('children' in node);
}

function leafColor(leaf: TreemapLeaf): { fill: string; opacity: number } {
  if (leaf.confidence === 'none' || leaf.correctRate === null) {
    return { fill: '#cbd5e1', opacity: 1 };
  }
  const fill = interpolateRdYlGn(leaf.correctRate / 100);
  const opacity = leaf.confidence === 'low' ? 0.5 : 1;
  return { fill, opacity };
}

const HEADER_CAT = 24;
const HEADER_SUB = 18;
const LABEL_MIN_W = 40;
const LABEL_MIN_H = 24;

export function Treemap({ data, width, height }: TreemapProps) {
  const root = useMemo(() => {
    const h = hierarchy<AnyNode>(data, (d) =>
      isLeaf(d) ? null : (d as { children: AnyNode[] }).children
    );
    h.sum((d) => (isLeaf(d) ? d.totalQuestions : 0));
    h.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const layout = treemap<AnyNode>()
      .size([width, height])
      .tile(treemapSquarify)
      .paddingTop((node) => {
        if (node.depth === 1) return HEADER_CAT;
        if (node.depth === 2) return HEADER_SUB;
        return 0;
      })
      .paddingInner(2)
      .paddingOuter(1)
      .round(true);
    return layout(h);
  }, [data, width, height]);

  const nodes = root.descendants();

  return (
    <svg
      width={width}
      height={height}
      style={{ display: 'block', background: '#ffffff' }}
    >
      {nodes.map((node, i) => {
        const x = node.x0 ?? 0;
        const y = node.y0 ?? 0;
        const w = (node.x1 ?? 0) - x;
        const h = (node.y1 ?? 0) - y;
        if (w <= 0 || h <= 0) return null;

        const datum = node.data;
        const depth = node.depth;

        if (depth === 0) {
          return null;
        }

        if (isLeaf(datum)) {
          const color = leafColor(datum);
          const showLabel = w >= LABEL_MIN_W && h >= LABEL_MIN_H;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill={color.fill}
                fillOpacity={color.opacity}
                stroke="#ffffff"
                strokeWidth={1}
              />
              {showLabel && (
                <text
                  x={x + w / 2}
                  y={y + h / 2}
                  fontSize={11}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#1e293b"
                  pointerEvents="none"
                >
                  {datum.name}
                </text>
              )}
            </g>
          );
        }

        const headerH = depth === 1 ? HEADER_CAT : HEADER_SUB;
        const fontWeight = depth === 1 ? 700 : 500;
        const fontSize = depth === 1 ? 13 : 11;
        const showHeader = w >= LABEL_MIN_W && headerH >= 14;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="#ffffff"
              stroke="#e2e8f0"
              strokeWidth={depth === 1 ? 2 : 1}
            />
            {showHeader && (
              <>
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={headerH}
                  fill="#f1f5f9"
                />
                <text
                  x={x + 6}
                  y={y + headerH / 2}
                  fontSize={fontSize}
                  fontWeight={fontWeight}
                  dominantBaseline="middle"
                  fill="#1e293b"
                  pointerEvents="none"
                >
                  {datum.name}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
