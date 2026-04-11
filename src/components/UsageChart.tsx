/**
 * UsageChart — 30-day bar chart of credit spends, rendered as hand-made
 * SVG. No chart library (Recharts, Chart.js) so the bundle doesn't
 * inflate just to show 30 colored bars.
 *
 * The chart is purely presentational — data prep lives in
 * `data/billing_events.ts bucketByDay()`.
 *
 * Empty days still render as a small "ghost" tick so the x-axis
 * stays contiguous. Today is the last bar on the right.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { DailyBucket } from '../data/billing_events';

interface Props {
    buckets: DailyBucket[];
}

export const UsageChart: React.FC<Props> = ({ buckets }) => {
    const { t } = useTranslation();

    const total = buckets.reduce((acc, b) => acc + b.credits, 0);
    const max = Math.max(1, ...buckets.map((b) => b.credits));
    const empty = buckets.every((b) => b.credits === 0);

    if (empty) {
        return (
            <div
                style={{
                    padding: '1.5rem',
                    border: '1px dashed var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    textAlign: 'center',
                    color: 'var(--text-secondary)',
                    fontSize: '0.9rem',
                }}
            >
                {t('billing.usage.empty', 'No credit activity in the last 30 days.')}
            </div>
        );
    }

    // Layout constants — keep everything in one place so the SVG is
    // readable without digging into React state math.
    const WIDTH = 720;
    const HEIGHT = 140;
    const PAD_X = 16;
    const PAD_Y = 12;
    const BAR_AREA_W = WIDTH - PAD_X * 2;
    const BAR_AREA_H = HEIGHT - PAD_Y * 2 - 16; // reserve space for x labels
    const BAR_W = BAR_AREA_W / buckets.length;
    const BAR_GAP = Math.max(1, BAR_W * 0.2);
    const INNER_W = Math.max(1, BAR_W - BAR_GAP);

    return (
        <div>
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: '0.4rem',
                }}
            >
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {t('billing.usage.last30', 'Last 30 days')}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {t('billing.usage.total', 'Total')}:{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>
                        {total}
                    </strong>{' '}
                    {t('billing.usage.credits', 'credits')}
                </div>
            </div>
            <svg
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                style={{ width: '100%', height: 'auto', display: 'block' }}
                role="img"
                aria-label={t('billing.usage.chartAlt', 'Credit usage over the last 30 days')}
            >
                {/* Baseline */}
                <line
                    x1={PAD_X}
                    y1={HEIGHT - PAD_Y - 16}
                    x2={WIDTH - PAD_X}
                    y2={HEIGHT - PAD_Y - 16}
                    stroke="var(--border-color, #2a2d3f)"
                    strokeWidth={1}
                />

                {buckets.map((b, i) => {
                    const h = b.credits > 0 ? (b.credits / max) * BAR_AREA_H : 2;
                    const x = PAD_X + i * BAR_W + BAR_GAP / 2;
                    const y = HEIGHT - PAD_Y - 16 - h;
                    const isEmpty = b.credits === 0;
                    return (
                        <g key={b.dayIso}>
                            <rect
                                x={x}
                                y={y}
                                width={INNER_W}
                                height={h}
                                rx={2}
                                fill={
                                    isEmpty
                                        ? 'var(--border-color, #2a2d3f)'
                                        : 'var(--accent-color, #4a9eff)'
                                }
                                opacity={isEmpty ? 0.4 : 0.85}
                            >
                                <title>
                                    {b.dayIso}: {b.credits} credits
                                </title>
                            </rect>
                            {/* Label every 5th bar so axis isn't noisy */}
                            {i % 5 === 0 && (
                                <text
                                    x={x + INNER_W / 2}
                                    y={HEIGHT - PAD_Y + 2}
                                    fill="var(--text-secondary, #8a8fa3)"
                                    fontSize="9"
                                    textAnchor="middle"
                                >
                                    {b.label}
                                </text>
                            )}
                        </g>
                    );
                })}
            </svg>
        </div>
    );
};

export default UsageChart;
