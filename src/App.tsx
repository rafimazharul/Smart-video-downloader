import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Pause,
  Play,
  Trash2,
  DownloadCloud,
  CheckCircle2,
  AlertTriangle,
  PauseCircle,
  ArrowDownCircle,
} from 'lucide-react';
import {
  AppSettings,
  DiskSpaceInfo,
  DownloadItem,
  NavSection,
  SpeedPoint,
  ToastMessage,
} from './types/models';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { UrlBar } from './components/UrlBar';
import { SpeedGraph } from './components/SpeedGraph';
import { DownloadCard } from './components/DownloadCard';
import { SettingsView } from './components/SettingsView';
import { AboutCreatorView } from './components/AboutCreatorView';
import { ClipboardToast } from './components/ClipboardToast';
import { ToastContainer } from './components/ToastContainer';

const DEFAULT_SETTINGS: AppSettings = {
  defaultDownloadDir: '',
  maxConcurrentDownloads: 3,
  connectionsPerDownload: 8,
  speedLimitBytesPerSec: 0,
  autoRetry: true,
  maxRetries: 3,
  theme: 'dark',
  notificationsEnabled: true,
  clipboardMonitorEnabled: true,
  minimizeToTrayOnClose: true,
  launchAtStartup: false,
  startMinimized: false,
};

export default function App() {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [totalSpeed, setTotalSpeed] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [speedHistory, setSpeedHistory] = useState<SpeedPoint[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [diskSpace, setDiskSpace] = useState<DiskSpaceInfo | null>(null);
  const [activeSection, setActiveSection] = useState<NavSection>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isMaximized, setIsMaximized] = useState(false);
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);
  const [externalPrefillUrl, setExternalPrefillUrl] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const urlInputRef = useRef<HTMLInputElement>(null);

  const pushToast = useCallback(
    (type: ToastMessage['type'], title: string, description?: string) => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, type, title, description }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshDiskSpace = useCallback(async (dir?: string) => {
    try {
      const info = await window.smartDM.getDiskSpace(dir);
      setDiskSpace(info);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [settings.theme]);

  useEffect(() => {
    let mounted = true;

    const loadInitial = async () => {
      try {
        const [telemetry, loadedSettings, maximized] = await Promise.all([
          window.smartDM.getTelemetry(),
          window.smartDM.getSettings(),
          window.smartDM.windowIsMaximized(),
        ]);
        if (!mounted) return;
        setDownloads(telemetry.downloads);
        setTotalSpeed(telemetry.totalSpeedBytesPerSec);
        setActiveCount(telemetry.activeCount);
        setSpeedHistory(telemetry.speedHistory);
        setSettings(loadedSettings);
        setIsMaximized(maximized);
        void refreshDiskSpace(loadedSettings.defaultDownloadDir);
      } catch (err) {
        console.error('Failed to initialize app state:', err);
      }
    };

    void loadInitial();

    const unsubTelemetry = window.smartDM.onTelemetry((payload) => {
      setDownloads(payload.downloads);
      setTotalSpeed(payload.totalSpeedBytesPerSec);
      setActiveCount(payload.activeCount);
      setSpeedHistory(payload.speedHistory);
    });

    const unsubClipboard = window.smartDM.onClipboardUrlDetected((url) => {
      setClipboardUrl(url);
    });

    const unsubFocus = window.smartDM.onFocusUrlInput((prefillUrl) => {
      setActiveSection('all');
      if (prefillUrl) {
        setExternalPrefillUrl(prefillUrl);
      }
      setTimeout(() => urlInputRef.current?.focus(), 60);
    });

    const unsubMax = window.smartDM.onWindowMaximizedChange((max) => {
      setIsMaximized(max);
    });

    const unsubExt = window.smartDM.onExtensionCaptured((filename) => {
      setActiveSection('all');
      pushToast('success', 'Captured from Browser Extension', filename);
      void refreshDiskSpace();
    });

    const diskInterval = setInterval(() => {
      void refreshDiskSpace();
    }, 20000);

    return () => {
      mounted = false;
      unsubTelemetry();
      unsubClipboard();
      unsubFocus();
      unsubMax();
      unsubExt();
      clearInterval(diskInterval);
    };
  }, [refreshDiskSpace, pushToast]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setActiveSection('all');
        setTimeout(() => urlInputRef.current?.focus(), 40);
      } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setActiveSection('settings');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleUpdateSettings = async (patch: Partial<AppSettings>) => {
    const updated = await window.smartDM.updateSettings(patch);
    setSettings(updated);
    if (patch.defaultDownloadDir) {
      void refreshDiskSpace(updated.defaultDownloadDir);
    }
  };

  const handleToggleTheme = () => {
    void handleUpdateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' });
  };

  const counts = useMemo(() => {
    let downloading = 0;
    let completed = 0;
    let paused = 0;
    let failed = 0;
    for (const d of downloads) {
      if (d.status === 'downloading' || d.status === 'queued') downloading++;
      else if (d.status === 'completed') completed++;
      else if (d.status === 'paused') paused++;
      else if (d.status === 'failed' || d.status === 'cancelled') failed++;
    }
    return {
      all: downloads.length,
      downloading,
      completed,
      paused,
      failed,
    };
  }, [downloads]);

  const filteredDownloads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return downloads.filter((d) => {
      if (activeSection === 'downloading' && d.status !== 'downloading' && d.status !== 'queued') {
        return false;
      }
      if (activeSection === 'completed' && d.status !== 'completed') return false;
      if (activeSection === 'paused' && d.status !== 'paused') return false;
      if (activeSection === 'failed' && d.status !== 'failed' && d.status !== 'cancelled') {
        return false;
      }
      if (q) {
        return (
          d.filename.toLowerCase().includes(q) ||
          d.url.toLowerCase().includes(q) ||
          d.category.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [downloads, activeSection, searchQuery]);

  const handleStart = useCallback((id: string) => void window.smartDM.startDownload(id), []);
  const handlePause = useCallback((id: string) => void window.smartDM.pauseDownload(id), []);
  const handleResume = useCallback((id: string) => void window.smartDM.resumeDownload(id), []);
  const handleCancel = useCallback((id: string) => void window.smartDM.cancelDownload(id), []);
  const handleRetry = useCallback((id: string) => void window.smartDM.retryDownload(id), []);
  const handleRemove = useCallback(
    (id: string, del?: boolean) => void window.smartDM.removeDownload(id, del),
    []
  );

  const handleOpenFile = useCallback(
    async (filePath: string) => {
      const res = await window.smartDM.openFile(filePath);
      if (!res.ok) {
        pushToast('error', 'Cannot open file', res.error || 'File may have been moved or deleted.');
      }
    },
    [pushToast]
  );

  const handleOpenFolder = useCallback(
    async (filePath: string) => {
      const res = await window.smartDM.openFolder(filePath);
      if (!res.ok) {
        pushToast('error', 'Cannot open folder', res.error || 'Folder not found.');
      }
    },
    [pushToast]
  );

  const sectionTitleMap: Record<NavSection, string> = {
    all: 'All Downloads',
    downloading: 'Active & Queued Downloads',
    completed: 'Completed Downloads',
    paused: 'Paused Downloads',
    failed: 'Failed & Cancelled Downloads',
    settings: 'Settings',
    about: 'About the Creator',
  };

  const renderEmptyState = () => {
    let icon = <DownloadCloud className="w-9 h-9 text-emerald-500/80 dark:text-emerald-300/80" />;
    let title = 'No downloads yet';
    let subtitle =
      'Paste any direct video or media URL above—or click a download button in your browser with the extension connected.';

    if (searchQuery.trim()) {
      title = 'No matching downloads';
      subtitle = `No downloads matched "${searchQuery}".`;
    } else if (activeSection === 'downloading') {
      icon = <ArrowDownCircle className="w-9 h-9 text-teal-500/80 dark:text-teal-300/80" />;
      title = 'No active downloads';
      subtitle = 'Downloads in progress or waiting in the queue will appear here.';
    } else if (activeSection === 'completed') {
      icon = <CheckCircle2 className="w-9 h-9 text-emerald-500/80 dark:text-emerald-300/80" />;
      title = 'No completed downloads';
      subtitle = 'Finished downloads will be saved here for quick access.';
    } else if (activeSection === 'paused') {
      icon = <PauseCircle className="w-9 h-9 text-amber-500/80" />;
      title = 'No paused downloads';
      subtitle = 'Pause any active download to resume it later using HTTP Range requests.';
    } else if (activeSection === 'failed') {
      icon = <AlertTriangle className="w-9 h-9 text-rose-500/80" />;
      title = 'No failed downloads';
      subtitle = 'Everything is running cleanly!';
    }

    return (
      <div className="glass-tile rounded-[26px] flex flex-col items-center justify-center text-center py-16 px-6">
        <div className="w-16 h-16 rounded-full glass-well flex items-center justify-center mb-4">
          {icon}
        </div>
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
        <p className="text-xs text-slate-500 dark:text-slate-300/75 max-w-md mt-1.5 leading-relaxed">
          {subtitle}
        </p>
      </div>
    );
  };

  return (
    <div className="ios-canvas h-screen w-screen flex flex-col text-slate-900 dark:text-slate-100 overflow-hidden">
      <TitleBar
        theme={settings.theme}
        onToggleTheme={handleToggleTheme}
        totalSpeed={totalSpeed}
        activeCount={activeCount}
        isMaximized={isMaximized}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar
          activeSection={activeSection}
          onSelectSection={setActiveSection}
          counts={counts}
          totalSpeed={totalSpeed}
          speedLimitBytesPerSec={settings.speedLimitBytesPerSec}
          diskSpace={diskSpace}
        />

        <main className="flex-1 min-w-0 overflow-y-auto p-4 lg:p-5">
          <div className="max-w-6xl mx-auto space-y-4">
            {activeSection === 'settings' ? (
              <SettingsView settings={settings} onUpdateSettings={handleUpdateSettings} />
            ) : activeSection === 'about' ? (
              <AboutCreatorView />
            ) : (
              <>
                <ClipboardToast
                  url={clipboardUrl}
                  onAccept={(detectedUrl) => {
                    setClipboardUrl(null);
                    setExternalPrefillUrl(detectedUrl);
                  }}
                  onDismiss={() => setClipboardUrl(null)}
                />

                <UrlBar
                  defaultDownloadDir={settings.defaultDownloadDir}
                  inputRef={urlInputRef}
                  externalPrefillUrl={externalPrefillUrl}
                  onClearExternalPrefill={() => setExternalPrefillUrl(null)}
                  onDownloadAdded={(filename, queuedOnly) => {
                    pushToast(
                      'success',
                      queuedOnly ? 'Added to queue' : 'Download started',
                      filename
                    );
                    void refreshDiskSpace();
                  }}
                  onError={(title, desc) => pushToast('error', title, desc)}
                />

                <SpeedGraph
                  history={speedHistory}
                  currentSpeed={totalSpeed}
                  activeCount={activeCount}
                />

                {/* Section Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                      {sectionTitleMap[activeSection]}
                    </h2>
                    <span className="text-xs font-mono font-semibold px-2.5 py-0.5 rounded-full glass-pill text-emerald-700 dark:text-emerald-300">
                      {filteredDownloads.length}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Filter downloads..."
                        className="h-9 w-48 sm:w-56 pl-9 pr-3.5 rounded-full glass-pill text-xs text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/50"
                      />
                    </div>

                    {counts.downloading > 0 && (
                      <button
                        type="button"
                        onClick={() => void window.smartDM.pauseAll()}
                        className="h-9 px-3.5 rounded-full glass-pill hover:bg-amber-500/15 text-amber-700 dark:text-amber-300 text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95"
                      >
                        <Pause className="w-3.5 h-3.5" />
                        Pause All
                      </button>
                    )}

                    {counts.paused > 0 && (
                      <button
                        type="button"
                        onClick={() => void window.smartDM.resumeAll()}
                        className="h-9 px-3.5 rounded-full glass-pill hover:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        Resume All
                      </button>
                    )}

                    {counts.completed > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          void window.smartDM.clearCompleted();
                          pushToast('info', 'Cleared completed entries from history');
                        }}
                        className="h-9 px-3.5 rounded-full glass-pill hover:bg-rose-500/15 text-slate-700 dark:text-slate-200 hover:text-rose-500 text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Clear Completed
                      </button>
                    )}
                  </div>
                </div>

                {/* Download List */}
                <div className="space-y-3 pb-6">
                  {filteredDownloads.length === 0
                    ? renderEmptyState()
                    : filteredDownloads.map((item) => (
                        <DownloadCard
                          key={item.id}
                          item={item}
                          onStart={handleStart}
                          onPause={handlePause}
                          onResume={handleResume}
                          onCancel={handleCancel}
                          onRetry={handleRetry}
                          onRemove={handleRemove}
                          onOpenFile={handleOpenFile}
                          onOpenFolder={handleOpenFolder}
                        />
                      ))}
                </div>
              </>
            )}
          </div>
        </main>
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
