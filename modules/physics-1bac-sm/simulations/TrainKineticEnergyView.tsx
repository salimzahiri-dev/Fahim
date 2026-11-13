'use client';

import { useState } from 'react';
import type { SimulationViewProps } from '../../simulationViews';

/**
 * The train experiment. Every number it shows comes from the server's run of
 * trainKineticEnergy (props.result): this component computes no physics and
 * makes no network call. Bar heights are only scaled to fit the drawing.
 *
 * The student starts at the low speed and moves the train to the high one; the
 * second bar and the ratio appear once both speeds have been seen.
 */

interface Result {
  massTonnes: number;
  speedsKmh: [number, number];
  energiesMJ: [number, number];
  ratio: number;
  speedRatio: number;
}

function readResult(result: Record<string, unknown>): Result | null {
  const pair = (v: unknown): [number, number] | null =>
    Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [v[0], v[1]] : null;
  const speedsKmh = pair(result.speedsKmh);
  const energiesMJ = pair(result.energiesMJ);
  const { massTonnes, ratio, speedRatio } = result;
  if (!speedsKmh || !energiesMJ || typeof massTonnes !== 'number' || typeof ratio !== 'number' || typeof speedRatio !== 'number') {
    return null;
  }
  return { massTonnes, speedsKmh, energiesMJ, ratio, speedRatio };
}

const fr = (n: number): string => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n);

const W = 320;
const TRACK_Y = 70;
const BAR_TOP = 110;
const BAR_H = 120;

export function TrainKineticEnergyView({ result }: SimulationViewProps) {
  const data = readResult(result);
  const [speedIndex, setSpeedIndex] = useState<0 | 1>(0);
  const [seenHigh, setSeenHigh] = useState(false);

  if (!data) return <p className="text-sm text-muted">L&apos;expérience n&apos;a pas pu s&apos;afficher.</p>;

  const select = (i: 0 | 1) => {
    setSpeedIndex(i);
    if (i === 1) setSeenHigh(true);
  };

  const maxE = Math.max(...data.energiesMJ);
  const barHeight = (e: number) => Math.max(2, (e / maxE) * BAR_H);
  const trainX = speedIndex === 0 ? 40 : 190;
  const bars = [0, 1] as const;

  return (
    <div>
      <div role="group" aria-label="Vitesse du train" className="mx-auto mb-3 grid max-w-sm grid-cols-2 gap-2">
        {bars.map((i) => (
          <button
            key={i}
            type="button"
            aria-pressed={speedIndex === i}
            onClick={() => select(i)}
            className={`min-h-11 rounded-xl border-2 px-3 font-semibold ${
              speedIndex === i ? 'border-accent bg-accent text-white' : 'border-accent bg-white text-accent-strong hover:bg-accent-soft'
            }`}
          >
            {fr(data.speedsKmh[i])} km/h
          </button>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${W} ${BAR_TOP + BAR_H + 40}`}
        className="mx-auto block w-full max-w-sm"
        role="img"
        aria-label={
          seenHigh
            ? `Énergie cinétique : ${fr(data.energiesMJ[0])} MJ à ${fr(data.speedsKmh[0])} km/h, ${fr(data.energiesMJ[1])} MJ à ${fr(data.speedsKmh[1])} km/h.`
            : `Énergie cinétique : ${fr(data.energiesMJ[0])} MJ à ${fr(data.speedsKmh[0])} km/h. Passe à ${fr(data.speedsKmh[1])} km/h pour comparer.`
        }
      >
        {/* Track and train */}
        <line x1="8" y1={TRACK_Y} x2={W - 8} y2={TRACK_Y} stroke="var(--color-line)" strokeWidth="3" />
        {Array.from({ length: 16 }, (_, k) => (
          <line key={k} x1={14 + k * 19} y1={TRACK_Y + 2} x2={8 + k * 19} y2={TRACK_Y + 8} stroke="var(--color-line)" strokeWidth="2" />
        ))}
        <g style={{ transform: `translateX(${trainX}px)`, transition: 'transform 900ms ease-in-out' }}>
          <path d="M0 36 h78 q18 0 26 18 v12 h-104 z" fill="var(--color-accent)" />
          <rect x="10" y="42" width="14" height="10" rx="2" fill="white" />
          <rect x="30" y="42" width="14" height="10" rx="2" fill="white" />
          <rect x="50" y="42" width="14" height="10" rx="2" fill="white" />
          <circle cx="20" cy="68" r="4" fill="var(--color-ink)" />
          <circle cx="82" cy="68" r="4" fill="var(--color-ink)" />
          {speedIndex === 1 &&
            [0, 1, 2].map((k) => <line key={k} x1={-8 - k * 4} y1={44 + k * 7} x2={-28 - k * 6} y2={44 + k * 7} stroke="var(--color-accent)" strokeWidth="2" opacity="0.6" />)}
        </g>
        <text x="8" y="18" fontSize="12" fill="var(--color-muted)">
          Masse : {fr(data.massTonnes)} t (constante)
        </text>

        {/* Energy bars */}
        {bars.map((i) => {
          const shown = i === 0 || seenHigh;
          const x = i === 0 ? 70 : 190;
          const h = barHeight(data.energiesMJ[i]);
          return (
            <g key={i} opacity={shown ? 1 : 0.35}>
              {/* The frames show the full scale, which would give the ratio away before both speeds are seen. */}
              {seenHigh && <rect x={x} y={BAR_TOP} width="60" height={BAR_H} rx="4" fill="var(--color-paper)" stroke="var(--color-line)" />}
              {shown && (
                <rect
                  x={x}
                  y={BAR_TOP + BAR_H - h}
                  width="60"
                  height={h}
                  rx="4"
                  fill={speedIndex === i ? 'var(--color-accent)' : 'var(--color-accent-soft)'}
                  stroke="var(--color-accent)"
                />
              )}
              <text x={x + 30} y={BAR_TOP + BAR_H + 16} textAnchor="middle" fontSize="12" fill="var(--color-ink)">
                {fr(data.speedsKmh[i])} km/h
              </text>
              <text x={x + 30} y={BAR_TOP + BAR_H + 32} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--color-ink)">
                {shown ? `${fr(data.energiesMJ[i])} MJ` : '?'}
              </text>
            </g>
          );
        })}
      </svg>

      <p className="mt-2 text-center text-base" aria-live="polite">
        {seenHigh ? (
          <>
            Vitesse ×{fr(data.speedRatio)} · Énergie cinétique{' '}
            <strong className="text-accent-strong">×{fr(data.ratio)}</strong>
          </>
        ) : (
          `Passe le train à ${fr(data.speedsKmh[1])} km/h.`
        )}
      </p>
    </div>
  );
}
