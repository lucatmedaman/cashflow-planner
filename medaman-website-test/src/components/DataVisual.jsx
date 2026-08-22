/**
 * Abstract data-motief voor de hero. Geen echte cijfers, dus puur decoratief
 * en verborgen voor schermlezers.
 */
const staven = [38, 52, 46, 68, 61, 79, 72, 88];
const lijn = [64, 58, 61, 47, 44, 36, 33, 26];
const BREEDTE = 400;
const HOOGTE = 240;
const STAP = BREEDTE / staven.length;

export default function DataVisual() {
  const punten = lijn
    .map((v, i) => `${i * STAP + STAP / 2},${(v / 100) * HOOGTE}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${BREEDTE} ${HOOGTE}`}
      className="h-auto w-full text-primair"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      {[0.25, 0.5, 0.75].map((y) => (
        <line
          key={y}
          x1="0"
          x2={BREEDTE}
          y1={HOOGTE * y}
          y2={HOOGTE * y}
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.14"
        />
      ))}

      {staven.map((v, i) => (
        <rect
          key={i}
          x={i * STAP + STAP * 0.22}
          y={HOOGTE - (v / 100) * HOOGTE}
          width={STAP * 0.56}
          height={(v / 100) * HOOGTE}
          rx="1.5"
          fill="currentColor"
          opacity={0.18 + i * 0.045}
        />
      ))}

      <polyline
        points={punten}
        fill="none"
        stroke="#2FB3A0"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {lijn.map((v, i) => (
        <circle
          key={i}
          cx={i * STAP + STAP / 2}
          cy={(v / 100) * HOOGTE}
          r="3.5"
          fill="#2FB3A0"
        />
      ))}
    </svg>
  );
}
