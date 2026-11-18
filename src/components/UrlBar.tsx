import React, { useEffect, useRef, useState } from 'react';
import {
  ClipboardPaste,
  Download,
  FolderOpen,
  Link2,
  Loader2,
  CheckCircle2,
  X,
  AlertCircle,
  ListPlus,
  RefreshCw,
} from 'lucide-react';
import { InspectedMedia } from '../types/models';
import { formatBytes } from '../utils/format';
import { CategoryIcon, getCategoryStyles } from './CategoryIcon';

interface UrlBarProps {
  defaultDownloadDir: string;
  inputRef: React.RefObject<HTMLInputElement>;
  externalPrefillUrl: string | null;
  onClearExternalPrefill: () => void;
  onDownloadAdded: (filename: string, queuedOnly: boolean) => void;
  onError: (title: string, description: string) => void;
}

export const UrlBar: React.FC<UrlBarProps> = ({
  defaultDownloadDir,
  inputRef,
  externalPrefillUrl,
  onClearExternalPrefill,
  onDownloadAdded,
  onError,
}) => {
  const [url, setUrl] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [inspected, setInspected] = useState<InspectedMedia | null>(null);
  const [customFilename, setCustomFilename] = useState('');
  const [saveDir, setSaveDir] = useState(defaultDownloadDir);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const lastInspectedUrl = useRef<string>('');

  useEffect(() => {
    setSaveDir((prev) => prev || defaultDownloadDir);
  }, [defaultDownloadDir]);

  useEffect(() => {
    if (externalPrefillUrl) {
      setUrl(externalPrefillUrl);
      onClearExternalPrefill();
      void runInspect(externalPrefillUrl);
    }
  }, [externalPrefillUrl]);

  const runInspect = async (targetUrl: string): Promise<InspectedMedia | null> => {
    const trimmed = targetUrl.trim();
    if (!trimmed) {
      setInlineError('Please paste or type a direct video or file URL.');
      return null;
    }

    setInlineError(null);
    setInspecting(true);
    try {
      const info = await window.smartDM.inspectUrl(trimmed);
      setInspected(info);
      setCustomFilename(info.filename);
      setSaveDir(defaultDownloadDir);
      lastInspectedUrl.current = trimmed;
      return info;
    } catch (err: any) {
      const msg = err?.message || 'Failed to inspect URL.';
      setInspected(null);
      setInlineError(msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, ''));
      return null;
    } finally {
      setInspecting(false);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await window.smartDM.readClipboard();
      if (!text) {
        setInlineError('Clipboard is empty.');
        return;
      }
      setUrl(text);
      setInlineError(null);
      await runInspect(text);
    } catch {
      setInlineError('Could not read clipboard.');
    }
  };

  const handlePrimaryDownloadClick = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setInlineError('Please paste a video or file URL first.');
      inputRef.current?.focus();
      return;
    }

    if (!inspected || lastInspectedUrl.current !== trimmed) {
      await runInspect(trimmed);
      return;
    }

    await startDownload(true);
  };

  const startDownload = async (startImmediately: boolean) => {
    const trimmed = url.trim();
    if (!trimmed) return;

    setAdding(true);
    setInlineError(null);
    try {
      let media = inspected;
      if (!media || lastInspectedUrl.current !== trimmed) {
        media = await runInspect(trimmed);
        if (!media) {
          setAdding(false);
          return;
        }
      }

      const item = await window.smartDM.addDownload({
        url: trimmed,
        filename: customFilename.trim() || media.filename,
        saveDir: saveDir || defaultDownloadDir,
        startImmediately,
        inspected: media,
      });

      onDownloadAdded(item.filename, !startImmediately);
      setUrl('');
      setInspected(null);
      setCustomFilename('');
      lastInspectedUrl.current = '';
    } catch (err: any) {
      const cleanMsg = String(err?.message || 'Could not start download.').replace(
        /^Error invoking remote method '[^']+':\s*(Error:\s*)?/i,
        ''
      );
      setInlineError(cleanMsg);
      onError('Download Error', cleanMsg);
    } finally {
      setAdding(false);
    }
  };

  const handleBrowseFolder = async () => {
    const selected = await window.smartDM.selectDirectory(saveDir || defaultDownloadDir);
    if (selected) {
      setSaveDir(selected);
    }
  };

  const clearPreview = () => {
    setInspected(null);
    setInlineError(null);
    lastInspectedUrl.current = '';
  };

  return (
    <div className="glass-tile rounded-[24px] p-4">
      <form onSubmit={handlePrimaryDownloadClick} className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-emerald-600/70 dark:text-emerald-300/70">
            <Link2 className="w-4 h-4" />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (inlineError) setInlineError(null);
              if (inspected && e.target.value.trim() !== lastInspectedUrl.current) {
                setInspected(null);
              }
            }}
            placeholder="Paste a direct video or file URL (https://example.com/video.mp4)..."
            className="w-full h-12 pl-11 pr-9 rounded-[18px] glass-well text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-400/75 focus:outline-none focus:ring-2 focus:ring-emerald-400/55 focus:border-emerald-400/60 transition-all"
          />
          {url && (
            <button
              type="button"
              onClick={() => {
                setUrl('');
                clearPreview();
                inputRef.current?.focus();
              }}
              title="Clear URL"
              className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-700 dark:hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handlePaste}
            disabled={inspecting || adding}
            className="h-12 px-4 rounded-[18px] glass-pill hover:bg-white/80 dark:hover:bg-white/15 text-slate-700 dark:text-slate-100 text-sm font-medium flex items-center gap-2 transition-all active:scale-[0.97] disabled:opacity-50"
          >
            <ClipboardPaste className="w-4 h-4 text-teal-600 dark:text-teal-300" />
            <span>Paste URL</span>
          </button>

          <button
            type="submit"
            disabled={inspecting || adding || !url.trim()}
            className="h-12 px-5 rounded-[18px] ios-primary-btn active:scale-[0.97] text-white text-sm font-semibold flex items-center gap-2 transition-all disabled:opacity-45 disabled:cursor-not-allowed"
          >
            {inspecting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Detecting...</span>
              </>
            ) : adding ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Starting...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>{inspected ? 'Download Now' : 'Download'}</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Inline Error Banner */}
      {inlineError && (
        <div className="mt-3 flex items-start gap-2.5 p-3 rounded-[16px] bg-rose-500/12 border border-rose-500/25 text-rose-700 dark:text-rose-300 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1 leading-relaxed">{inlineError}</span>
          <button
            type="button"
            onClick={() => setInlineError(null)}
            className="opacity-70 hover:opacity-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Detected Media Metadata & Pre-Download Editor */}
      {inspected && (
        <div className="mt-3.5 p-4 rounded-[20px] glass-well border border-emerald-400/30 space-y-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {inspected.thumbnailUrl ? (
                <img
                  src={inspected.thumbnailUrl}
                  alt="Preview"
                  className="w-12 h-12 rounded-[14px] object-cover border border-white/20 shrink-0 bg-slate-900"
                />
              ) : (
                <div
                  className={`w-12 h-12 rounded-[14px] border flex items-center justify-center shrink-0 ${getCategoryStyles(
                    inspected.category
                  )}`}
                >
                  <CategoryIcon category={inspected.category} className="w-6 h-6" />
                </div>
              )}

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-300">
                    {inspected.category}
                  </span>
                  <span className="text-xs font-mono text-slate-600 dark:text-slate-300">
                    • {inspected.totalBytes !== null ? formatBytes(inspected.totalBytes) : 'Size unknown'}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    • {inspected.mimeType}
                  </span>
                  {inspected.resumable && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-400/25">
                      <CheckCircle2 className="w-3 h-3" />
                      Resumable
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  {inspected.finalUrl}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={clearPreview}
              title="Dismiss preview"
              className="w-7 h-7 rounded-full glass-pill flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                File Name (rename before downloading)
              </label>
              <input
                type="text"
                value={customFilename}
                onChange={(e) => setCustomFilename(e.target.value)}
                className="w-full h-9 px-3.5 rounded-[12px] glass-pill text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                Save Location
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={saveDir}
                  readOnly
                  title={saveDir}
                  className="flex-1 h-9 px-3.5 rounded-[12px] glass-pill text-xs text-slate-700 dark:text-slate-200 truncate focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleBrowseFolder}
                  className="h-9 px-3.5 rounded-[12px] glass-pill hover:bg-white/80 dark:hover:bg-white/15 text-slate-700 dark:text-slate-100 text-xs font-medium flex items-center gap-1.5 transition-colors shrink-0"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300" />
                  Browse
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => void runInspect(url)}
              disabled={inspecting || adding}
              className="h-9 px-3.5 rounded-full text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/10 flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Re-detect
            </button>
            <button
              type="button"
              onClick={() => void startDownload(false)}
              disabled={adding}
              className="h-9 px-4 rounded-full glass-pill hover:bg-white/80 dark:hover:bg-white/15 text-slate-800 dark:text-slate-100 text-xs font-medium flex items-center gap-1.5 transition-all active:scale-95"
            >
              <ListPlus className="w-3.5 h-3.5" />
              Add to Queue
            </button>
            <button
              type="button"
              onClick={() => void startDownload(true)}
              disabled={adding}
              className="h-9 px-4 rounded-full ios-primary-btn text-white text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95"
            >
              {adding ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Start Download
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
