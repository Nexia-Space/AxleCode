"use client";

export interface LineDatum {
  label: string;
  value: number;
}

interface LineChartProps {
  data: LineDatum[];
  height?: number;
  tone?: "a" | "b";
  valueLabel?: string;
}

const TONES = {
  a: { line: "#8fb4ff", fill: "#7aa2f7" },
  b: { line: "#75ddb3", fill: "#5ecfa3" },
} as const;

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const scaled = value / base;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * base;
}

function shortLabel(label: string): string {
  return label.length > 10 ? label.slice(5) : label;
}

export function LineChart({ data, height = 240, tone = "a", valueLabel = "value" }: LineChartProps) {
  if (data.length === 0) return <p className="muted small">No data recorded yet.</p>;

  const width = 760;
  const padding = { top: 16, right: 12, bottom: 30, left: 48 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const axisMax = niceCeil(Math.max(...data.map((entry) => entry.value)));
  const points = data.map((entry, index) => {
    const x = data.length === 1
      ? padding.left + innerWidth / 2
      : padding.left + (index / (data.length - 1)) * innerWidth;
    const y = padding.top + innerHeight - (entry.value / axisMax) * innerHeight;
    return { ...entry, x, y };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${padding.left},${padding.top + innerHeight} ${line} ${padding.left + innerWidth},${padding.top + innerHeight}`;
  const colors = TONES[tone];
  const labelStep = Math.max(1, Math.ceil(data.length / 7));

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${valueLabel} over time`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`line-fill-${tone}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colors.fill} stopOpacity="0.24" />
          <stop offset="100%" stopColor={colors.fill} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((index) => {
        const value = (axisMax / 4) * index;
        const y = padding.top + innerHeight - (value / axisMax) * innerHeight;
        return (
          <g key={index}>
            <line className="grid-line" x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
            <text x={padding.left - 8} y={y + 3} textAnchor="end">{compact.format(value)}</text>
          </g>
        );
      })}
      <polygon points={area} fill={`url(#line-fill-${tone})`} />
      <polyline points={line} fill="none" stroke={colors.line} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((point, index) => (
        <g key={`${point.label}-${index}`}>
          <circle cx={point.x} cy={point.y} r="3.5" fill={colors.line} stroke="var(--card)" strokeWidth="2">
            <title>{`${point.label}: ${point.value.toLocaleString("en-US")} ${valueLabel}`}</title>
          </circle>
          {index % labelStep === 0 ? <text x={point.x} y={height - 9} textAnchor="middle">{shortLabel(point.label)}</text> : null}
        </g>
      ))}
    </svg>
  );
}
