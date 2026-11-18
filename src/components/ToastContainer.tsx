import React from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { ToastMessage } from '../types/models';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-2.5 p-3.5 rounded-[20px] border shadow-2xl backdrop-blur-2xl transition-all ${
            t.type === 'error'
              ? 'bg-rose-950/85 border-rose-400/35 text-rose-50'
              : t.type === 'success'
              ? 'bg-emerald-950/85 border-emerald-400/35 text-emerald-50'
              : 'bg-slate-900/85 border-white/15 text-slate-50'
          }`}
        >
          {t.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          ) : t.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <Info className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold">{t.title}</p>
            {t.description && (
              <p className="text-xs opacity-80 mt-0.5 break-words">{t.description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            className="opacity-65 hover:opacity-100 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
