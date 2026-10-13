import React from 'react';
import { CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';

// 2D skill map: PCA of the user's skill vectors (positions are approximate).
// Colour = where the skill came from (identity only; never used in any
// calculation). Fixed slot order manual → cv → github, validated all-pairs
// for scatter (dataviz reference palette, slots 1–3). Every point carries a
// visible text label, so identity is never colour-alone.
export const SOURCE_STYLE = {
  manual: { label: 'Added by you', color: '#2a78d6' },
  cv: { label: 'From CV', color: '#eb6834' },
  github: { label: 'From GitHub', color: '#1baf7a' },
};
const ORDER = ['manual', 'cv', 'github'];

// Labels sit above their point; a label that would collide with an earlier
// one (points close together in data space) moves below its point instead.
export const placeLabels = (points) => {
  const placed = [];
  return points.map((p) => {
    const clash = placed.some((q) => q.below === false && Math.abs(q.x - p.x) < 0.45 && Math.abs(q.y - p.y) < 0.2);
    const point = { ...p, below: clash };
    placed.push(point);
    return point;
  });
};

// Point + its text label (identity is never colour alone).
function LabelledPoint({ cx, cy, fill, payload }) {
  if (cx == null || cy == null) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fill={fill} stroke="#ffffff" strokeWidth={2} />
      <text
        x={cx}
        y={payload.below ? cy + 20 : cy - 11}
        textAnchor="middle"
        fontSize={11}
        fill="#334155"
        style={{ pointerEvents: 'none' }}
        data-testid="skill-map-label"
      >
        {payload.name}
      </text>
    </g>
  );
}

function PointTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-semibold text-slate-800">{p.name}</p>
      <p className="text-slate-500">{SOURCE_STYLE[p.source]?.label || p.source}</p>
    </div>
  );
}

export default function SkillMap({ points }) {
  const labelled = placeLabels(points);
  const series = ORDER.map((source) => ({ source, data: labelled.filter((p) => (p.source || 'manual') === source) })).filter(
    (s) => s.data.length,
  );
  return (
    <figure aria-label={`Skill map with ${points.length} skills`} data-testid="skill-map">
      <div className="h-72 w-full" role="img" aria-label={`Scatter plot of your skills: ${points.map((p) => p.name).join(', ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 18, right: 18, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
            <XAxis type="number" dataKey="x" domain={[-1.2, 1.2]} hide />
            <YAxis type="number" dataKey="y" domain={[-1.2, 1.2]} hide />
            <Tooltip content={<PointTooltip />} cursor={false} />
            <Legend
              verticalAlign="top"
              height={28}
              iconType="circle"
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value) => <span style={{ color: '#475569' }}>{value}</span>}
            />
            {series.map(({ source, data }) => (
              <Scatter
                key={source}
                name={SOURCE_STYLE[source].label}
                data={data}
                fill={SOURCE_STYLE[source].color}
                stroke="#ffffff"
                strokeWidth={2}
                isAnimationActive={false}
                shape={<LabelledPoint />}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {/* Text view of the same points (screen readers, colour-blind users, print). */}
      <ul className="sr-only" data-testid="skill-map-list">
        {points.map((p) => (
          <li key={p.name}>
            {p.name} ({SOURCE_STYLE[p.source]?.label || p.source})
          </li>
        ))}
      </ul>
    </figure>
  );
}
