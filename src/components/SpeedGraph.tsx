import React, { useMemo } from 'react';
import { Activity, TrendingUp, Zap } from 'lucide-react';
import { SpeedPoint } from '../types/models';
import { formatSpeed } from '../utils/format';

interface SpeedGraphProps {
  history: SpeedPoint[];
  currentSpeed: number;
  activeCount: number;
}

export const SpeedGraph: React.FC<SpeedGraphProps> = ({
  history,
  currentSpeed,
  activeCount,
}) => {
  const { linePath, areaPath, peakSpeed } = useMemo(() => {
    const width = 600;
    const height = 88;
    const padY = 6;
    const points =
      history.length >= 2
        ? history
        : [
            { timestamp: 0, speedBytesPerSec: 0, activeCount: 0 },
            { timestamp: 1, speedBytesPerSec: 0, activeCount: 0 },
          ];

    const peak = points.reduce((m, p) => Math.max(m, p.speedBytesPerSec), 0);
    const maxScale = Math.max(peak * 1.15, 1024 * 64);

    const coords = points.map((p, idx) => {
      const x = (idx / (points.length - 1)) * width;
      const ratio = p.speedBytesPerSec / maxScale;
      const y = height - padY - ratio * (height - padY * 2);
      return { x, y };
    });

    // Smooth cubic Bezier path for fluid glass chart rendering
    let line = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    for (let i = 1; i < coords.length; i++) {
      const prev = coords[i - 1];
      const curr = coords[i];
      const midX = ((prev.x + curr.x) / 2).toFixed(1);
      line += ` C ${midX} ${prev.y.toFixed(1)}, ${midX} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
    }
    const area = `${line} L ${width} ${height} L 0 ${height} Z`;

    return { linePath: line, areaPath: area, peakSpeed: peak };
  }, [history]);

  return (
    <div className="glass-tile rounded-[24px] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center">
            <Activity className="w-4 h-4 text-emerald-600 dark:text-emerald-300" />
          </div>
          <div>
            <h3 className="text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-200">
              Live Throughput
            </h3>
            <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
              60-second real-time network monitor
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full glass-well">
            <Zap className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
            <span className="text-slate-500 dark:text-slate-400">Now</span>
            <span className="font-mono font-semibold text-slate-900 dark:text-white">
              {formatSpeed(currentSpeed)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full glass-well">
            <TrendingUp className="w-3.5 h-3.5 text-teal-500 dark:text-teal-400" />
            <span className="text-slate-500 dark:text-slate-400">Peak</span>
            <span className="font-mono font-semibold text-slate-900 dark:text-white">
              {formatSpeed(peakSpeed)}
            </span>
          </div>
          <div className="hidden md:flex items-center gap-1.5 px-3 py-1 rounded-full glass-well text-slate-700 dark:text-slate-200">
            <span
              className={`w-2 h-2 rounded-full ${
                activeCount > 0
                  ? 'bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse'
                  : 'bg-slate-400/60'
              }`}
            />
            <span className="font-medium">{activeCount} active</span>
          </div>
        </div>
      </div>

      <div className="relative h-[88px] w-full overflow-hidden rounded-[18px] glass-well">
        <svg viewBox="0 0 600 88" preserveAspectRatio="none" className="w-full h-full block">
          <defs>
            <linearGradient id="speedAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#10B981" stopOpacity="0.45" />
              <stop offset="65%" stopColor="#2DD4BF" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#2DD4BF" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="speedLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#059669" />
              <stop offset="50%" stopColor="#10B981" />
              <stop offset="100%" stopColor="#2DD4BF" />
            </linearGradient>
          </defs>

          <line x1="0" y1="22" x2="600" y2="22" stroke="currentColor" strokeOpacity="0.07" strokeDasharray="3 4" />
          <line x1="0" y1="44" x2="600" y2="44" stroke="currentColor" strokeOpacity="0.07" strokeDasharray="3 4" />
          <line x1="0" y1="66" x2="600" y2="66" stroke="currentColor" strokeOpacity="0.07" strokeDasharray="3 4" />

          <path d={areaPath} fill="url(#speedAreaGrad)" />
          <path
            d={linePath}
            fill="none"
            stroke="url(#speedLineGrad)"
            strokeWidth="2.4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
};
