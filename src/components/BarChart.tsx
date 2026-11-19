import { useEffect, useRef, useState } from 'react';

export interface Bar {
  key: string;
  label: string; // axis label
  value: number;
  tip: string; // tooltip heading
  detail?: string; // tooltip second line
}

/** Single-series vertical bar chart (SVG) with hover/tap tooltip. */
export function BarChart({ bars, height = 180, unit = '', ariaLabel }: { bars: Bar[]; height?: number; unit?: string; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(340);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCw(el.clientWidth || 340));
    ro.observe(el);
    return () => ro.disconnect();
  }, [bars.length]);
  if (!bars.length) return <div className="empty small">No data in this range.</div>;
  const W = Math.max(cw, bars.length * 14);
  const H = height;
  const padL = 32;
  const padB = 22;
  const padT = 10;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const plotW = W - padL - 4;
  const plotH = H - padB - padT;
  const bw = plotW / bars.length;
  const barW = Math.max(3, Math.min(28, bw - 2)); // 2px surface gap between bars
  const y = (v: number) => padT + plotH - (v / top) * plotH;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const labelEvery = Math.ceil(bars.length / Math.max(1, Math.floor(plotW / 46)));
  const h = hover != null ? bars[hover] : null;

  return (
    <div className="chart" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="grid" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="axis">
              {t}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = padL + i * bw + (bw - barW) / 2;
          const yy = y(b.value);
          const hgt = Math.max(0, padT + plotH - yy);
          const r = Math.min(4, barW / 2, hgt);
          return (
            <g key={b.key}>
              {hgt > 0 && (
                <path
                  className={`bar ${hover === i ? 'hot' : ''} ${hover != null && hover !== i ? 'dim' : ''}`}
                  d={`M${x},${padT + plotH} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + barW - r} Q${x + barW},${yy} ${x + barW},${yy + r} V${padT + plotH} Z`}
                />
              )}
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" className="axis">
                  {b.label}
                </text>
              )}
              {/* hit target bigger than the mark */}
              <rect x={padL + i * bw} y={padT} width={bw} height={plotH + padB} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
            </g>
          );
        })}
        <line x1={padL} x2={W} y1={padT + plotH} y2={padT + plotH} className="baseline" />
      </svg>
      {h && hover != null && (
        <div className="tooltip" style={{ left: Math.min(Math.max(padL + hover * bw + bw / 2, 70), W - 70) - (wrap.current?.scrollLeft ?? 0) }}>
          <b>
            {h.value}
            {unit}
          </b>{' '}
          <span>{h.tip}</span>
          {h.detail && <div className="muted">{h.detail}</div>}
        </div>
      )}
    </div>
  );
}

function niceStep(max: number) {
  const raw = max / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Horizontal proportion bar used inside tables. */
export function Meter({ value, max, className = '' }: { value: number; max: number; className?: string }) {
  const w = max ? Math.max(2, (value / max) * 100) : 0;
  return (
    <span className="meter">
      <span className={`meter-fill ${className}`} style={{ width: `${w}%` }} />
    </span>
  );
}
