"use client";

export interface BarDatum {
  label: string;
  value: number;
}

interface BarChartProps {
  data: BarDatum[];
  height?: number;
  tone?: "a" | "b";
  valueLabel?: string;
}

const TONES = {
  a: { from: "#8fb4ff", to: "#5b7fd8" },
  b: { from: "#7ee0b8", to: "#3fa982" },
} as const;

/** Round the axis up to a readable value (1, 2, 5 × 10^n). */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const scaled = value / base;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * base;
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function axisLabel(label: string): string {
  return label.length > 14 ? `${label.slice(0, 13)}…` : label;
}

export function BarChart({ data, height = 210, tone = "a", valueLabel = "requests" }: BarChartProps) {
  if (data.length === 0) {
    return <p className="muted small">No data recorded yet.</p>;
  }

  const width = 760;
  const padding = { top: 10, right: 8, bottom: 26, left: 44 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const maxValue = Math.max(...data.map((entry) => entry.value));
  const axisMax = niceCeil(maxValue);
  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => (axisMax / tickCount) * index);

  const slot = innerWidth / data.length;
  const barWidth = Math.max(2, Math.min(38, slot * 0.62));

  // Label every nth bar so dates never collide.
  const labelStep = Math.max(1, Math.ceil(data.length / 8));

  const gradientId = `bar-gradient-${tone}`;
  const colors = TONES[tone];

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${valueLabel} per period`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colors.from} />
          <stop offset="100%" stopColor={colors.to} />
        </linearGradient>
      </defs>

      {ticks.map((tick) => {
        const y = padding.top + innerHeight - (tick / axisMax) * innerHeight;
        return (
          <g key={tick}>
            <line
              className="grid-line"
              x1={padding.left}
              x2={width - padding.right}
              y1={y}
              y2={y}
            />
            <text x={padding.left - 8} y={y + 3} textAnchor="end">
              {compact.format(tick)}
            </text>
          </g>
        );
      })}

      {data.map((entry, index) => {
        const barHeight = axisMax === 0 ? 0 : (entry.value / axisMax) * innerHeight;
        const x = padding.left + slot * index + (slot - barWidth) / 2;
        const y = padding.top + innerHeight - barHeight;
        return (
          <g key={entry.label}>
            <rect
              className="bar"
              x={x}
              y={y}
              width={barWidth}
              height={Math.max(entry.value > 0 ? 1.5 : 0, barHeight)}
              rx={Math.min(3, barWidth / 2)}
              fill={`url(#${gradientId})`}
            >
              <title>{`${entry.label}: ${entry.value.toLocaleString("en-US")} ${valueLabel}`}</title>
            </rect>
            {index % labelStep === 0 ? (
              <text x={x + barWidth / 2} y={height - 8} textAnchor="middle">
                {axisLabel(entry.label)}
              </text>
            ) : null}
          </g>
        );
      })}

      <line
        className="grid-line"
        x1={padding.left}
        x2={width - padding.right}
        y1={padding.top + innerHeight}
        y2={padding.top + innerHeight}
      />
    </svg>
  );
}