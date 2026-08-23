import type { DotLoaderProps } from "./DotLoader.types";

// Vendored/adapted from the 5x5 dot-matrix wave loader family at
// https://dot-matrix-animations.vercel.app/ (MIT licensed). The site's
// animations are generated client-side rather than shipped as static
// markup, so this is a from-scratch re-implementation of the same
// "diagonal wave across a 5x5 dot grid" idea rather than a byte-for-byte
// copy of vendored SVG source — kept intentionally small (~1KB), single
// color via `currentColor`, and inert under `prefers-reduced-motion`.

const GRID_SIZE = 5;
const DOT_SPACING = 6;
const DOT_RADIUS = 2;
const VIEWBOX = GRID_SIZE * DOT_SPACING;

const DOTS = Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => {
  const row = Math.floor(i / GRID_SIZE);
  const col = i % GRID_SIZE;
  return {
    cx: col * DOT_SPACING + DOT_SPACING / 2,
    cy: row * DOT_SPACING + DOT_SPACING / 2,
    delay: (row + col) * 0.08,
  };
});

export function DotLoader({ label, size = 18 }: DotLoaderProps) {
  return (
    <div className="inline-flex items-center gap-2" role="status" aria-label={label ?? "Loading"}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        fill="currentColor"
        aria-hidden="true"
        className="dp-dot-loader"
      >
        <style>{`
          .dp-dot-loader circle {
            animation: dp-dot-loader-wave 1.2s ease-in-out infinite;
            transform-origin: center;
          }
          @keyframes dp-dot-loader-wave {
            0%, 100% { opacity: 0.2; transform: scale(0.55); }
            50% { opacity: 1; transform: scale(1); }
          }
          @media (prefers-reduced-motion: reduce) {
            .dp-dot-loader circle { animation: none; opacity: 0.8; }
          }
        `}</style>
        {DOTS.map((dot, i) => (
          <circle key={i} cx={dot.cx} cy={dot.cy} r={DOT_RADIUS} style={{ animationDelay: `${dot.delay}s` }} />
        ))}
      </svg>
      {label && <span className="font-mono text-[10px] text-dim">{label}</span>}
    </div>
  );
}
