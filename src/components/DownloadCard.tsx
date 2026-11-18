import React, { useState } from 'react';
import {
  Play,
  Pause,
  XCircle,
  RotateCcw,
  FolderOpen,
  ExternalLink,
  Trash2,
  Clock,
  Gauge,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { DownloadItem } from '../types/models';
import {
  extractHostname,
  formatBytes,
  formatEta,
  formatRelativeTime,
  formatSpeed,
  toFileUrl,
} from '../utils/format';
import { CategoryIcon, getCategoryStyles } from './CategoryIcon';

interface DownloadCardProps {
  item: DownloadItem;
  onStart: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string, deleteFile?: boolean) => void;
  onOpenFile: (filePath: string) => void;
  onOpenFolder: (filePath: string) => void;
}

export const DownloadCard: React.FC<DownloadCardProps> = React.memo(
  ({
    item,
    onStart,
    onPause,
    onResume,
    onCancel,
    onRetry,
    onRemove,
    onOpenFile,
    onOpenFolder,
  }) => {
    const [imgError, setImgError] = useState(false);

    const isIndeterminate = item.status === 'downloading' && item.totalBytes === null;
    const pct =
      item.status === 'completed'
        ? 100
        : item.totalBytes && item.totalBytes > 0
        ? Math.min(100, Math.max(0, (item.downloadedBytes / item.totalBytes) * 100))
        : 0;

    const previewSrc =
      !imgError && item.category === 'image'
        ? item.status === 'completed'
          ? toFileUrl(item.filePath)
          : item.thumbnailUrl
        : !imgError && item.thumbnailUrl
        ? item.thumbnailUrl
        : null;

    const statusBadge = () => {
      switch (item.status) {
        case 'downloading':
          return (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-teal-500/15 text-teal-700 dark:text-teal-300 border border-teal-400/25">
              <Loader2 className="w-3 h-3 animate-spin" />
              Downloading
            </span>
          );
        case 'queued':
          return (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border border-emerald-400/25">
              <Clock className="w-3 h-3" />
              Queued
            </span>
          );
        case 'paused':
          return (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400/25">
              <Pause className="w-3 h-3" />
              Paused
            </span>
          );
        case 'completed':
          return (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/18 text-emerald-700 dark:text-emerald-300 border border-emerald-400/30">
              <CheckCircle2 className="w-3 h-3" />
              Completed
            </span>
          );
        case 'failed':
          return (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-400/25">
              <AlertCircle className="w-3 h-3" />
              Failed
            </span>
          );
        case 'cancelled':
          return (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-500/15 text-slate-600 dark:text-slate-300 border border-slate-400/20">
              <XCircle className="w-3 h-3" />
              Cancelled
            </span>
          );
      }
    };

    const progressBarClass = () => {
      switch (item.status) {
        case 'completed':
          return 'bg-gradient-to-r from-[#059669] to-[#34D399]';
        case 'paused':
          return 'bg-amber-400';
        case 'failed':
          return 'bg-rose-500';
        case 'cancelled':
          return 'bg-slate-400/70 dark:bg-slate-600';
        case 'downloading':
          return 'progress-shimmer';
        default:
          return 'bg-emerald-500/60';
      }
    };

    const iconBtn =
      'w-8 h-8 rounded-full glass-pill flex items-center justify-center transition-all active:scale-90';

    return (
      <div className="group glass-tile rounded-[22px] hover:border-emerald-400/40 dark:hover:border-emerald-400/35 p-4 transition-all duration-150">
        <div className="flex items-start gap-3.5">
          {/* Thumbnail / Media Icon */}
          {previewSrc ? (
            <img
              src={previewSrc}
              alt={item.filename}
              onError={() => setImgError(true)}
              className="w-12 h-12 rounded-[15px] object-cover shrink-0 border border-white/25 bg-slate-900"
            />
          ) : (
            <div
              className={`w-12 h-12 rounded-[15px] border flex items-center justify-center shrink-0 ${getCategoryStyles(
                item.category
              )}`}
            >
              <CategoryIcon category={item.category} className="w-5 h-5" />
            </div>
          )}

          {/* Main Info */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <h4
                  title={item.filename}
                  className="text-sm font-semibold text-slate-900 dark:text-white truncate"
                >
                  {item.filename}
                </h4>
                {statusBadge()}
                {item.status === 'downloading' && item.activeConnections && item.activeConnections > 1 && (
                  <span
                    title="Parallel segmented HTTP Range connections"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-400/25"
                  >
                    <Zap className="w-3 h-3" />
                    {item.activeConnections}x
                  </span>
                )}
                {item.resumable && item.status !== 'completed' && (
                  <span
                    title="Server supports HTTP Range resumable downloads"
                    className="hidden sm:inline-flex items-center gap-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400"
                  >
                    <ShieldCheck className="w-3 h-3 text-teal-500 dark:text-teal-300" />
                    Range
                  </span>
                )}
              </div>

              {/* Circular iOS Control Center Action Buttons */}
              <div className="flex items-center gap-1.5 shrink-0">
                {item.status === 'queued' && (
                  <>
                    <button
                      type="button"
                      onClick={() => onStart(item.id)}
                      title="Start download"
                      className={`${iconBtn} text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/20`}
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onPause(item.id)}
                      title="Pause"
                      className={`${iconBtn} text-amber-600 dark:text-amber-300 hover:bg-amber-500/20`}
                    >
                      <Pause className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onCancel(item.id)}
                      title="Cancel download"
                      className={`${iconBtn} text-slate-500 dark:text-slate-300 hover:text-rose-500 hover:bg-rose-500/20`}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}

                {item.status === 'downloading' && (
                  <>
                    <button
                      type="button"
                      onClick={() => onPause(item.id)}
                      title="Pause download"
                      className={`${iconBtn} text-amber-600 dark:text-amber-300 hover:bg-amber-500/20`}
                    >
                      <Pause className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onCancel(item.id)}
                      title="Cancel download"
                      className={`${iconBtn} text-slate-500 dark:text-slate-300 hover:text-rose-500 hover:bg-rose-500/20`}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}

                {item.status === 'paused' && (
                  <>
                    <button
                      type="button"
                      onClick={() => onResume(item.id)}
                      title="Resume download"
                      className={`${iconBtn} text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/20`}
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onCancel(item.id)}
                      title="Cancel download"
                      className={`${iconBtn} text-slate-500 dark:text-slate-300 hover:text-rose-500 hover:bg-rose-500/20`}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}

                {(item.status === 'failed' || item.status === 'cancelled') && (
                  <button
                    type="button"
                    onClick={() => onRetry(item.id)}
                    title="Retry download"
                    className={`${iconBtn} text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/20`}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}

                {item.status === 'completed' && (
                  <button
                    type="button"
                    onClick={() => onOpenFile(item.filePath)}
                    title="Open downloaded file"
                    className={`${iconBtn} text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/20`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onOpenFolder(item.filePath)}
                  title="Open containing folder"
                  className={`${iconBtn} text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white`}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => onRemove(item.id, false)}
                  title="Remove from list"
                  className={`${iconBtn} text-slate-500 dark:text-slate-400 hover:text-rose-500 hover:bg-rose-500/20`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Source & Size Row */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400 mt-1">
              <span className="truncate max-w-[260px]" title={item.url}>
                {extractHostname(item.finalUrl || item.url)}
              </span>
              <span>•</span>
              <span className="font-mono text-slate-700 dark:text-slate-200/90">
                {formatBytes(item.downloadedBytes)}
                {' / '}
                {item.totalBytes !== null ? formatBytes(item.totalBytes) : 'Unknown size'}
              </span>
              {item.status === 'completed' && item.completedAt && (
                <>
                  <span>•</span>
                  <span>Completed {formatRelativeTime(item.completedAt)}</span>
                </>
              )}
            </div>

            {/* Recessed Glass Progress Bar */}
            <div className="mt-3">
              <div className="h-2.5 w-full rounded-full glass-well overflow-hidden p-[1px]">
                {isIndeterminate ? (
                  <div className="h-full rounded-full progress-shimmer progress-indeterminate" />
                ) : (
                  <div
                    className={`h-full rounded-full transition-[width] duration-300 ease-linear ${progressBarClass()}`}
                    style={{ width: `${pct}%` }}
                  />
                )}
              </div>

              {/* Live Metrics Footer */}
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                  {item.status === 'downloading' ? (
                    <>
                      <span className="inline-flex items-center gap-1 font-mono font-semibold text-emerald-600 dark:text-emerald-300">
                        <Gauge className="w-3.5 h-3.5" />
                        {formatSpeed(item.speed)}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono">
                        <Clock className="w-3.5 h-3.5" />
                        ETA: {formatEta(item.etaSeconds)}
                      </span>
                    </>
                  ) : item.status === 'completed' ? (
                    <span className="text-emerald-600 dark:text-emerald-300 font-medium truncate max-w-md">
                      Saved to {item.saveDir}
                    </span>
                  ) : item.status === 'paused' ? (
                    <span>Paused — click Resume to continue</span>
                  ) : item.status === 'queued' ? (
                    <span>Waiting in download queue...</span>
                  ) : null}
                </div>

                <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">
                  {isIndeterminate ? 'Streaming...' : `${pct.toFixed(1)}%`}
                </span>
              </div>
            </div>

            {item.error && (
              <div className="mt-2.5 flex items-start gap-2 px-3 py-2 rounded-[14px] bg-rose-500/12 border border-rose-500/25 text-xs text-rose-700 dark:text-rose-300">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{item.error}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
);
