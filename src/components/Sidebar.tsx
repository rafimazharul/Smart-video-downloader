import React from 'react';
import {
  Layers,
  ArrowDownCircle,
  CheckCircle2,
  PauseCircle,
  AlertTriangle,
  Settings,
  User,
  HardDrive,
  Gauge,
} from 'lucide-react';
import { DiskSpaceInfo, NavSection } from '../types/models';
import { formatBytes, formatSpeed } from '../utils/format';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  counts: {
    all: number;
    downloading: number;
    completed: number;
    paused: number;
    failed: number;
  };
  totalSpeed: number;
  speedLimitBytesPerSec: number;
  diskSpace: DiskSpaceInfo | null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSelectSection,
  counts,
  totalSpeed,
  speedLimitBytesPerSec,
  diskSpace,
}) => {
  const navItems: {
    id: NavSection;
    label: string;
    icon: React.FC<{ className?: string }>;
    count?: number;
    accent?: string;
  }[] = [
    { id: 'all', label: 'All Downloads', icon: Layers, count: counts.all },
    {
      id: 'downloading',
      label: 'Downloading',
      icon: ArrowDownCircle,
      count: counts.downloading,
      accent: 'text-teal-500 dark:text-teal-400',
    },
    {
      id: 'completed',
      label: 'Completed',
      icon: CheckCircle2,
      count: counts.completed,
      accent: 'text-emerald-500 dark:text-emerald-400',
    },
    {
      id: 'paused',
      label: 'Paused',
      icon: PauseCircle,
      count: counts.paused,
      accent: 'text-amber-500 dark:text-amber-400',
    },
    {
      id: 'failed',
      label: 'Failed',
      icon: AlertTriangle,
      count: counts.failed,
      accent: 'text-rose-500 dark:text-rose-400',
    },
  ];

  const usedPercent =
    diskSpace && diskSpace.totalBytes > 0
      ? Math.min(
          100,
          Math.max(0, ((diskSpace.totalBytes - diskSpace.freeBytes) / diskSpace.totalBytes) * 100)
        )
      : 0;

  return (
    <aside className="w-[248px] shrink-0 p-3 pr-0 flex flex-col select-none">
      <div className="flex-1 flex flex-col glass-panel rounded-[26px] overflow-hidden">
        <div className="p-3.5 flex-1 overflow-y-auto">
          <p className="px-3 mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-500/80 dark:text-emerald-100/45">
            Control Center
          </p>

          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectSection(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-[16px] text-[13.5px] font-medium transition-all duration-150 active:scale-[0.98] ${
                    active
                      ? 'ios-primary-btn text-white'
                      : 'text-slate-700 dark:text-slate-200/85 hover:bg-white/55 dark:hover:bg-white/[0.08] hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className={`w-7 h-7 rounded-full flex items-center justify-center ${
                        active
                          ? 'bg-white/20 text-white'
                          : 'bg-black/[0.05] dark:bg-white/[0.08]'
                      }`}
                    >
                      <Icon
                        className={`w-3.5 h-3.5 ${
                          active ? 'text-white' : item.accent || 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      />
                    </span>
                    <span>{item.label}</span>
                  </span>
                  {item.count !== undefined && (
                    <span
                      className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full ${
                        active
                          ? 'bg-white/22 text-white'
                          : 'bg-black/[0.06] dark:bg-white/[0.09] text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="mt-5 pt-4 border-t border-black/[0.07] dark:border-white/[0.08] space-y-1">
            <p className="px-3 mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-500/80 dark:text-emerald-100/45">
              Preferences
            </p>
            <button
              type="button"
              onClick={() => onSelectSection('settings')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[16px] text-[13.5px] font-medium transition-all duration-150 active:scale-[0.98] ${
                activeSection === 'settings'
                  ? 'ios-primary-btn text-white'
                  : 'text-slate-700 dark:text-slate-200/85 hover:bg-white/55 dark:hover:bg-white/[0.08] hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span
                className={`w-7 h-7 rounded-full flex items-center justify-center ${
                  activeSection === 'settings'
                    ? 'bg-white/20 text-white'
                    : 'bg-black/[0.05] dark:bg-white/[0.08]'
                }`}
              >
                <Settings
                  className={`w-3.5 h-3.5 ${
                    activeSection === 'settings'
                      ? 'text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                />
              </span>
              <span>Settings</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectSection('about')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[16px] text-[13.5px] font-medium transition-all duration-150 active:scale-[0.98] ${
                activeSection === 'about'
                  ? 'ios-primary-btn text-white'
                  : 'text-slate-700 dark:text-slate-200/85 hover:bg-white/55 dark:hover:bg-white/[0.08] hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span
                className={`w-7 h-7 rounded-full flex items-center justify-center ${
                  activeSection === 'about'
                    ? 'bg-white/20 text-white'
                    : 'bg-black/[0.05] dark:bg-white/[0.08]'
                }`}
              >
                <User
                  className={`w-3.5 h-3.5 ${
                    activeSection === 'about'
                      ? 'text-white'
                      : 'text-emerald-600 dark:text-emerald-300'
                  }`}
                />
              </span>
              <span>About the Creator</span>
            </button>
          </div>
        </div>

        {/* Control Center Bottom Live Tiles */}
        <div className="p-3 border-t border-black/[0.07] dark:border-white/[0.08] space-y-2.5">
          <div className="p-3 rounded-[18px] glass-well">
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 font-medium">
                <Gauge className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                Live Speed
              </span>
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
                {speedLimitBytesPerSec > 0 ? formatSpeed(speedLimitBytesPerSec) : 'Max'}
              </span>
            </div>
            <div className="text-[17px] font-mono font-bold tracking-tight text-slate-900 dark:text-white">
              {formatSpeed(totalSpeed)}
            </div>
          </div>

          {diskSpace && (
            <div className="p-3 rounded-[18px] glass-well">
              <div className="flex items-center justify-between text-[11px] mb-2">
                <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 font-medium">
                  <HardDrive className="w-3.5 h-3.5 text-teal-500 dark:text-teal-400" />
                  Storage Free
                </span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">
                  {formatBytes(diskSpace.freeBytes)}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-black/[0.08] dark:bg-white/[0.1] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    usedPercent > 90
                      ? 'bg-rose-500'
                      : usedPercent > 75
                      ? 'bg-amber-400'
                      : 'bg-gradient-to-r from-[#10B981] to-[#2DD4BF]'
                  }`}
                  style={{ width: `${usedPercent}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
