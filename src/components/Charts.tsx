/** Flat horizontal line — used when PnL has no movement yet (zero trades). */
export function FlatSparkline({ color = "var(--color-success)", height = 80, width = 300 }: {
  color?: string;
  height?: number;
  width?: number;
}) {
  const y = height * 0.55;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id="flat-spk" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.12" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M 0 ${y} L ${width} ${y} L ${width} ${height} L 0 ${height} Z`} fill="url(#flat-spk)" />
      <path d={`M 0 ${y} L ${width} ${y}`} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

export function Sparkline({ data, color = "var(--color-success)", height = 36, width = 120 }: {
  data?: number[];
  color?: string;
  height?: number;
  width?: number;
}) {
  const points = data ?? Array.from({ length: 24 }, (_, i) => Math.sin(i / 2) * 10 + Math.random() * 8 + 20);
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${i * stepX} ${height - ((p - min) / range) * height}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`spk-${color}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L ${width} ${height} L 0 ${height} Z`} fill={`url(#spk-${color})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

export function CandleChart({ height = 380 }: { height?: number }) {
  const bars = 80;
  let v = 50;
  const data = Array.from({ length: bars }, () => {
    const o = v;
    v = v + (Math.random() - 0.48) * 4;
    const c = v;
    const h = Math.max(o, c) + Math.random() * 2;
    const l = Math.min(o, c) - Math.random() * 2;
    return { o, c, h, l };
  });
  const max = Math.max(...data.map((d) => d.h));
  const min = Math.min(...data.map((d) => d.l));
  const range = max - min;
  const w = 100;
  const scaleY = (y: number) => height - ((y - min) / range) * (height - 20) - 10;
  const cw = w / bars;

  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <line
          key={i}
          x1={0}
          x2={w}
          y1={(height / 6) * i}
          y2={(height / 6) * i}
          stroke="currentColor"
          className="text-border"
          strokeWidth="0.1"
        />
      ))}
      {data.map((d, i) => {
        const up = d.c >= d.o;
        const x = i * cw + cw / 2;
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={scaleY(d.h)} y2={scaleY(d.l)} stroke={up ? "var(--color-success)" : "var(--color-destructive)"} strokeWidth="0.15" />
            <rect
              x={i * cw + cw * 0.15}
              y={scaleY(Math.max(d.o, d.c))}
              width={cw * 0.7}
              height={Math.max(0.5, Math.abs(scaleY(d.o) - scaleY(d.c)))}
              fill={up ? "var(--color-success)" : "var(--color-destructive)"}
            />
          </g>
        );
      })}
    </svg>
  );
}

export function LineChart({ height = 200, color = "var(--color-success)" }: { height?: number; color?: string }) {
  const points = Array.from({ length: 40 }, (_, i) => Math.sin(i / 4) * 20 + i * 1.2 + Math.random() * 5);
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const w = 100;
  const stepX = w / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${i * stepX} ${height - ((p - min) / range) * (height - 20) - 10}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id="ln-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L ${w} ${height} L 0 ${height} Z`} fill="url(#ln-grad)" />
      <path d={path} fill="none" stroke={color} strokeWidth="0.4" />
    </svg>
  );
}
