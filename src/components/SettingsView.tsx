import React, { useEffect, useState } from 'react';
import {
  FolderOpen,
  Gauge,
  Layers,
  RefreshCw,
  Bell,
  Clipboard,
  Monitor,
  Sun,
  Moon,
  Keyboard,
  Check,
  Puzzle,
  Zap,
} from 'lucide-react';
import { AppSettings } from '../types/models';

interface SettingsViewProps {
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

const SPEED_PRESETS = [
  { label: 'Unlimited', bytesPerSec: 0 },
  { label: '512 KB/s', bytesPerSec: 512 * 1024 },
  { label: '1 MB/s', bytesPerSec: 1024 * 1024 },
  { label: '2 MB/s', bytesPerSec: 2 * 1024 * 1024 },
  { label: '5 MB/s', bytesPerSec: 5 * 1024 * 1024 },
  { label: '10 MB/s', bytesPerSec: 10 * 1024 * 1024 },
];

export const SettingsView: React.FC<SettingsViewProps> = ({ settings, onUpdateSettings }) => {
  const [customSpeedKb, setCustomSpeedKb] = useState(
    settings.speedLimitBytesPerSec > 0 ? String(Math.round(settings.speedLimitBytesPerSec / 1024)) : ''
  );
  const [savedIndicator, setSavedIndicator] = useState(false);
  const [extBridge, setExtBridge] = useState<{
    running: boolean;
    port: number;
    extensionDir: string;
  } | null>(null);

  useEffect(() => {
    window.smartDM
      .getExtensionBridgeStatus()
      .then((status) => setExtBridge(status))
      .catch(() => {});
    const unsub = window.smartDM.onExtensionStatusChange((status) => {
      setExtBridge(status);
    });
    return unsub;
  }, []);

  const triggerSaved = () => {
    setSavedIndicator(true);
    setTimeout(() => setSavedIndicator(false), 1800);
  };

  const applyPatch = async (patch: Partial<AppSettings>) => {
    await onUpdateSettings(patch);
    triggerSaved();
  };

  const handleBrowseDefaultDir = async () => {
    const dir = await window.smartDM.selectDirectory(settings.defaultDownloadDir);
    if (dir) {
      await applyPatch({ defaultDownloadDir: dir });
    }
  };

  const handleApplyCustomSpeed = async () => {
    const kb = Number(customSpeedKb);
    if (!Number.isFinite(kb) || kb <= 0) {
      setCustomSpeedKb('');
      await applyPatch({ speedLimitBytesPerSec: 0 });
    } else {
      await applyPatch({ speedLimitBytesPerSec: Math.round(kb * 1024) });
    }
  };

  return (
    <div className="space-y-5 pb-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
            Settings
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300/75 mt-0.5">
            Configure download paths, bandwidth controls, browser bridge, and glass appearance.
          </p>
        </div>
        {savedIndicator && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <Check className="w-3.5 h-3.5" />
            Saved
          </div>
        )}
      </div>

      {/* Storage & Download Location */}
      <section className="glass-tile rounded-[24px] p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center">
            <FolderOpen className="w-4 h-4 text-emerald-600 dark:text-emerald-300" />
          </span>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Download Location
          </h3>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            readOnly
            value={settings.defaultDownloadDir}
            className="flex-1 h-10 px-4 rounded-[14px] glass-well text-xs font-mono text-slate-700 dark:text-slate-200"
          />
          <button
            type="button"
            onClick={handleBrowseDefaultDir}
            className="h-10 px-4 rounded-full ios-primary-btn text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all active:scale-95 shrink-0"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Change Folder
          </button>
        </div>
      </section>

      {/* Engine & Performance */}
      <section className="glass-tile rounded-[24px] p-5 space-y-5">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full bg-teal-500/15 border border-teal-400/25 flex items-center justify-center">
            <Gauge className="w-4 h-4 text-teal-600 dark:text-teal-300" />
          </span>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Download Engine & Speed Limits
          </h3>
        </div>

        {/* Max Concurrent Downloads */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-black/[0.07] dark:border-white/[0.08]">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
              <Layers className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
              Maximum Concurrent Downloads
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Number of files that can download simultaneously (remaining stay queued).
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={10}
              value={settings.maxConcurrentDownloads}
              onChange={(e) =>
                void applyPatch({ maxConcurrentDownloads: Number(e.target.value) })
              }
              className="w-36 accent-emerald-500"
            />
            <span className="w-9 text-center font-mono text-sm font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 border border-emerald-400/25 rounded-full py-1">
              {settings.maxConcurrentDownloads}
            </span>
          </div>
        </div>

        {/* Parallel Connections per Download (Multi-Segment Speed Accelerator) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-black/[0.07] dark:border-white/[0.08]">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
              <Zap className="w-4 h-4 text-teal-500 dark:text-teal-300" />
              Connections per Download (Speed Accelerator)
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Splits large resumable files into parallel HTTP Range connections (IDM-style) for faster speeds.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={16}
              value={settings.connectionsPerDownload}
              onChange={(e) =>
                void applyPatch({ connectionsPerDownload: Number(e.target.value) })
              }
              className="w-36 accent-emerald-500"
            />
            <span className="w-9 text-center font-mono text-sm font-bold text-teal-700 dark:text-teal-300 bg-teal-500/15 border border-teal-400/25 rounded-full py-1">
              {settings.connectionsPerDownload}
            </span>
          </div>
        </div>

        {/* Speed Limit */}
        <div className="space-y-3 pb-4 border-b border-black/[0.07] dark:border-white/[0.08]">
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">
              Global Speed Limit
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Throttle total download bandwidth across active downloads in real time.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {SPEED_PRESETS.map((preset) => {
              const active = settings.speedLimitBytesPerSec === preset.bytesPerSec;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setCustomSpeedKb(
                      preset.bytesPerSec > 0 ? String(Math.round(preset.bytesPerSec / 1024)) : ''
                    );
                    void applyPatch({ speedLimitBytesPerSec: preset.bytesPerSec });
                  }}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all active:scale-95 ${
                    active
                      ? 'ios-primary-btn text-white'
                      : 'glass-pill text-slate-700 dark:text-slate-200 hover:border-emerald-400/50'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="number"
              min={0}
              placeholder="Custom KB/s (0 = unlimited)"
              value={customSpeedKb}
              onChange={(e) => setCustomSpeedKb(e.target.value)}
              className="w-56 h-9 px-3.5 rounded-full glass-well text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
            />
            <button
              type="button"
              onClick={() => void handleApplyCustomSpeed()}
              className="h-9 px-4 rounded-full glass-pill hover:bg-white/80 dark:hover:bg-white/15 text-xs font-semibold text-slate-800 dark:text-slate-100 transition-all active:scale-95"
            >
              Apply KB/s
            </button>
          </div>
        </div>

        {/* Auto Retry */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
              <RefreshCw className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
              Automatic Retry on Network Failure
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Automatically resumes dropped connections with exponential backoff.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {settings.autoRetry && (
              <select
                value={settings.maxRetries}
                onChange={(e) => void applyPatch({ maxRetries: Number(e.target.value) })}
                className="h-9 px-3 rounded-full glass-well text-xs text-slate-800 dark:text-slate-100"
              >
                {[1, 2, 3, 5, 8].map((n) => (
                  <option key={n} value={n} className="bg-slate-900 text-white">
                    Up to {n} {n === 1 ? 'retry' : 'retries'}
                  </option>
                ))}
              </select>
            )}
            <ToggleSwitch
              checked={settings.autoRetry}
              onChange={(checked) => void applyPatch({ autoRetry: checked })}
            />
          </div>
        </div>
      </section>

      {/* Appearance & Desktop Integration */}
      <section className="glass-tile rounded-[24px] p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center">
            <Monitor className="w-4 h-4 text-emerald-600 dark:text-emerald-300" />
          </span>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Glass Appearance & Desktop Behavior
          </h3>
        </div>

        {/* Theme Segmented Control (iOS style) */}
        <div className="flex items-center justify-between py-2 border-b border-black/[0.07] dark:border-white/[0.08]">
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">Glass Mode</div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Switch between Dark Frosted and Light Frosted Control Center themes.
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-full glass-well">
            <button
              type="button"
              onClick={() => void applyPatch({ theme: 'dark' })}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all ${
                settings.theme === 'dark'
                  ? 'ios-primary-btn text-white'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              Dark
            </button>
            <button
              type="button"
              onClick={() => void applyPatch({ theme: 'light' })}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all ${
                settings.theme === 'light'
                  ? 'ios-primary-btn text-white'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              Light
            </button>
          </div>
        </div>

        <SettingRow
          icon={<Clipboard className="w-4 h-4 text-teal-500 dark:text-teal-400" />}
          title="Clipboard URL Auto-Detection"
          description="Detect downloadable media links when copied to your clipboard."
          checked={settings.clipboardMonitorEnabled}
          onChange={(v) => void applyPatch({ clipboardMonitorEnabled: v })}
        />

        <SettingRow
          icon={<Bell className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />}
          title="Download Completion Notifications"
          description="Show native Windows notifications when downloads finish or fail."
          checked={settings.notificationsEnabled}
          onChange={(v) => void applyPatch({ notificationsEnabled: v })}
        />

        <SettingRow
          icon={<Monitor className="w-4 h-4 text-slate-500 dark:text-slate-400" />}
          title="Minimize to System Tray on Close"
          description="Keep downloading in the background when you click the close button."
          checked={settings.minimizeToTrayOnClose}
          onChange={(v) => void applyPatch({ minimizeToTrayOnClose: v })}
        />

        <SettingRow
          icon={<Monitor className="w-4 h-4 text-slate-500 dark:text-slate-400" />}
          title="Launch at Windows Startup"
          description="Start Smart Video Downloader automatically when you sign in to Windows."
          checked={settings.launchAtStartup}
          onChange={(v) => void applyPatch({ launchAtStartup: v })}
        />

        <SettingRow
          icon={<Monitor className="w-4 h-4 text-slate-500 dark:text-slate-400" />}
          title="Start Minimized to Tray"
          description="Open silently in the system tray on application launch."
          checked={settings.startMinimized}
          onChange={(v) => void applyPatch({ startMinimized: v })}
        />
      </section>

      {/* Browser Extension Integration */}
      <section className="glass-tile rounded-[24px] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-full bg-teal-500/15 border border-teal-400/25 flex items-center justify-center">
              <Puzzle className="w-4 h-4 text-teal-600 dark:text-teal-300" />
            </span>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Browser Extension (Chrome / Edge / Brave)
            </h3>
          </div>
          {extBridge && (
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold border ${
                extBridge.running
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-400/30'
                  : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-400/30'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  extBridge.running ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-rose-400'
                }`}
              />
              {extBridge.running
                ? `Bridge Active (127.0.0.1:${extBridge.port})`
                : 'Bridge Offline'}
            </span>
          )}
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300/80 leading-relaxed">
          Install the included browser extension so clicking any website download button automatically sends the download (with its session headers) to Smart Video Downloader.
        </p>

        <ol className="text-xs text-slate-700 dark:text-slate-200 space-y-1.5 list-decimal list-inside glass-well rounded-[16px] p-3.5">
          <li>
            Open <code className="font-mono text-emerald-600 dark:text-emerald-300">chrome://extensions</code> (or{' '}
            <code className="font-mono text-emerald-600 dark:text-emerald-300">edge://extensions</code>) in your browser.
          </li>
          <li>
            Enable <strong>Developer mode</strong> (top-right toggle).
          </li>
          <li>
            Click <strong>Load unpacked</strong> and select the{' '}
            <code className="font-mono text-teal-600 dark:text-teal-300">browser-extension</code> folder.
          </li>
        </ol>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate max-w-md">
            {extBridge?.extensionDir || 'browser-extension'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                const status = await window.smartDM.restartExtensionBridge();
                setExtBridge(status);
              }}
              className="h-9 px-3.5 rounded-full glass-pill hover:bg-white/80 dark:hover:bg-white/15 text-slate-700 dark:text-slate-100 text-xs font-medium flex items-center gap-1.5 transition-all active:scale-95"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reconnect Bridge
            </button>
            <button
              type="button"
              onClick={() => void window.smartDM.openExtensionFolder()}
              className="h-9 px-4 rounded-full ios-primary-btn text-white text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Open Extension Folder
            </button>
          </div>
        </div>
      </section>

      {/* Keyboard Shortcuts Reference */}
      <section className="glass-tile rounded-[24px] p-5 space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center">
            <Keyboard className="w-4 h-4 text-emerald-600 dark:text-emerald-300" />
          </span>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Keyboard Shortcuts
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          <ShortcutItem keys="Ctrl + Shift + D" label="Global: Open app & paste URL" />
          <ShortcutItem keys="Ctrl + Shift + P" label="Global: Pause / Resume all downloads" />
          <ShortcutItem keys="Ctrl + N" label="In-app: Focus URL input field" />
          <ShortcutItem keys="Ctrl + ," label="In-app: Open Settings" />
        </div>
      </section>
    </div>
  );
};

const SettingRow: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ icon, title, description, checked, onChange }) => (
  <div className="flex items-center justify-between gap-4 py-2 border-b last:border-b-0 border-black/[0.07] dark:border-white/[0.08]">
    <div>
      <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
        {icon}
        {title}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>
    </div>
    <ToggleSwitch checked={checked} onChange={onChange} />
  </div>
);

/* Authentic iOS Green Toggle Switch */
const ToggleSwitch: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({
  checked,
  onChange,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-[28px] w-[48px] shrink-0 cursor-pointer rounded-full p-[2px] transition-colors duration-200 ${
      checked
        ? 'bg-gradient-to-r from-[#10B981] to-[#14B8A6] shadow-[0_0_12px_rgba(16,185,129,0.45)]'
        : 'bg-black/15 dark:bg-white/15'
    }`}
  >
    <span
      className={`pointer-events-none inline-block h-[24px] w-[24px] transform rounded-full bg-white shadow-md transition-transform duration-200 ${
        checked ? 'translate-x-[20px]' : 'translate-x-0'
      }`}
    />
  </button>
);

const ShortcutItem: React.FC<{ keys: string; label: string }> = ({ keys, label }) => (
  <div className="flex items-center justify-between px-3.5 py-2.5 rounded-[14px] glass-well">
    <span className="text-slate-700 dark:text-slate-200">{label}</span>
    <kbd className="px-2.5 py-0.5 rounded-full glass-pill font-mono text-[11px] font-semibold text-slate-800 dark:text-emerald-200">
      {keys}
    </kbd>
  </div>
);
