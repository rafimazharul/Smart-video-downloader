import React from 'react';
import {
  Download,
  Minus,
  Moon,
  Square,
  Copy,
  Sun,
  X,
  Activity,
} from 'lucide-react';
import { formatSpeed } from '../utils/format';

interface TitleBarProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  totalSpeed: number;
  activeCount: number;
  isMaximized: boolean;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  theme,
  onToggleTheme,
  totalSpeed,
  activeCount,
  isMaximized,
}) => {
  return (
    <header className="app-drag h-12 shrink-0 flex items-center justify-between px-4 select-none z-30 border-b border-black/[0.06] dark:border-white/[0.08] bg-white/40 dark:bg-black/25 backdrop-blur-2xl">
      {/* Left: App Brand */}
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-[10px] ios-primary-btn flex items-center justify-center">
          <Download className="w-4 h-4 text-white stroke-[2.5]" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[13.5px] tracking-tight text-slate-900 dark:text-white">
            Smart Video Downloader
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
            Glass Pro
          </span>
        </div>
      </div>

      {/* Center: iPhone Dynamic-Island-inspired Live Pill */}
      <div className="hidden sm:flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-slate-900/90 dark:bg-black/65 border border-white/15 shadow-lg shadow-black/20 text-xs">
        <span
          className={`w-2 h-2 rounded-full ${
            activeCount > 0
              ? 'bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse'
              : 'bg-emerald-500/40'
          }`}
        />
        <Activity
          className={`w-3.5 h-3.5 ${
            activeCount > 0 ? 'text-teal-300' : 'text-slate-400'
          }`}
        />
        <span className="font-mono font-semibold text-white tracking-tight">
          {formatSpeed(totalSpeed)}
        </span>
        <span className="text-white/25">•</span>
        <span className="text-slate-300 font-medium">
          {activeCount > 0 ? `${activeCount} active` : 'Ready'}
        </span>
      </div>

      {/* Right: Circular iOS Glass Controls */}
      <div className="app-no-drag flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleTheme}
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} glass`}
          className="w-8 h-8 rounded-full glass-pill flex items-center justify-center text-slate-600 hover:text-emerald-600 dark:text-slate-300 dark:hover:text-emerald-300 transition-all active:scale-95"
        >
          {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>

        <div className="w-px h-4 bg-black/10 dark:bg-white/10 mx-1" />

        <button
          type="button"
          onClick={() => window.smartDM.windowMinimize()}
          title="Minimize"
          className="w-8 h-8 rounded-full glass-pill flex items-center justify-center text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition-all active:scale-95"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => window.smartDM.windowToggleMaximize()}
          title={isMaximized ? 'Restore' : 'Maximize'}
          className="w-8 h-8 rounded-full glass-pill flex items-center justify-center text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition-all active:scale-95"
        >
          {isMaximized ? (
            <Copy className="w-3 h-3" />
          ) : (
            <Square className="w-3 h-3" />
          )}
        </button>
        <button
          type="button"
          onClick={() => window.smartDM.windowClose()}
          title="Close"
          className="w-8 h-8 rounded-full glass-pill flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-rose-500 hover:text-white hover:border-rose-400/50 transition-all active:scale-95"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
