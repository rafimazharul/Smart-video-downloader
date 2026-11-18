import React from 'react';
import { Clipboard, Download, X } from 'lucide-react';

interface ClipboardToastProps {
  url: string | null;
  onAccept: (url: string) => void;
  onDismiss: () => void;
}

export const ClipboardToast: React.FC<ClipboardToastProps> = ({
  url,
  onAccept,
  onDismiss,
}) => {
  if (!url) return null;

  return (
    <div className="glass-tile rounded-[22px] border-emerald-400/35 flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-full ios-primary-btn text-white flex items-center justify-center shrink-0">
          <Clipboard className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-900 dark:text-white">
            Downloadable URL detected in clipboard
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-300 truncate">{url}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onAccept(url)}
          className="h-8 px-3.5 rounded-full ios-primary-btn text-white text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95"
        >
          <Download className="w-3.5 h-3.5" />
          Inspect & Download
        </button>
        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss"
          className="w-7 h-7 rounded-full glass-pill flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
