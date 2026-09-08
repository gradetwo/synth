import { useEffect, useState } from 'react';
import { engine } from '@/audio/engine';
import { store } from '@/state/store';
import { useLayout, usePower, useTheme } from '@/hooks/useSynth';
import { wireAnalysis } from '@/audio/analysis';
import { TopBar, DisplayRow, KeyboardDock } from '@/panels/layout';
import { ModuleFor } from '@/panels/modules';
import { ModulesGrid } from '@/components/Module';
import { PresetDrawer } from '@/components/PresetDrawer';
import { ToastHost } from '@/components/Toast';
import { applyUpdate, onUpdateAvailable, registerServiceWorker } from '@/pwa/register';
import { readShareCode } from '@/state/share';
import { APP_VERSION } from '@/version';
import { toast } from '@/components/Toast';

wireAnalysis();

function StartOverlay({
  onStart,
  error,
  busy,
}: {
  onStart: () => void;
  error: string | null;
  busy: boolean;
}) {
  const d = engine.diagnostics();
  const diag = `GS-1 v${APP_VERSION} · SIMD ${d.simd ? '✓' : '✗'} · WASM ${d.wasm} · AudioContext ${d.contextState} · ${d.sampleRate} Hz`;
  return (
    <div className="start-overlay" role="dialog" aria-label="启动音频引擎">
      <div className="start-card">
        <button type="button" className="start-btn" onClick={onStart} disabled={busy}>
          <span className="start-icon">▶</span>
          <span>{busy ? '正在启动…' : '启动音频引擎'}</span>
          <small>浏览器需要一次点击才能播放声音</small>
        </button>
        {error ? (
          <div className="start-error" role="alert">
            <b>启动失败</b>
            <p>{error}</p>
            <small>{diag}</small>
            <button type="button" className="start-retry" onClick={onStart} disabled={busy}>
              重试
            </button>
          </div>
        ) : (
          <small className="start-diag">{diag}</small>
        )}
      </div>
    </div>
  );
}

function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    onUpdateAvailable(() => setAvailable(true));
  }, []);
  if (!available) return null;
  return (
    <div className="update-banner" role="status">
      <span>🚀 新版本已就绪</span>
      <button type="button" onClick={() => applyUpdate()}>
        立即更新
      </button>
      <button type="button" className="ghost" onClick={() => setAvailable(false)} aria-label="稍后">
        ✕
      </button>
    </div>
  );
}

export default function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [status, setStatus] = useState(engine.getState());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const layout = useLayout();
  const power = usePower();
  const theme = useTheme();

  useEffect(() => {
    // Apply a shared patch from the URL hash on first load.
    const code = readShareCode();
    if (code && store.importPatchCode(code)) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      toast('已载入分享音色');
    }
  }, []);

  useEffect(() => {
    const off = engine.onStatus(() => {
      setStatus(engine.getState());
      if (engine.error) setError(engine.error);
    });
    void registerServiceWorker();
    return off;
  }, []);

  useEffect(() => {
    // Keep the graph muted when the power switch is off.
    engine.setMuted(!power);
  }, [power]);

  useEffect(() => {
    document.body.classList.toggle('contrast', theme === 'contrast');
  }, [theme]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      // Must run inside the gesture: creates + resumes the AudioContext before
      // the first await (Safari requirement).
      await engine.start(16, store.getSnapshot().state.routes);
      engine.applyState(store.getSnapshot().state, true);
      engine.setMuted(!store.getSnapshot().state.power);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // iOS: suppress the long-press context menu outside real text inputs.
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

  // Undo / redo shortcuts.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
      } else if (key === 'y') {
        event.preventDefault();
        store.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Any gesture may (re)start or resume audio. iOS suspends the context when
  // the page is backgrounded or interrupted, so this cannot be a one-shot.
  useEffect(() => {
    const onGesture = () => {
      const s = engine.getState();
      if (s === 'idle') void start();
      else if (s === 'suspended') void engine.resumeIfSuspended();
    };
    const events = ['pointerdown', 'touchend', 'keydown'] as const;
    for (const event of events) window.addEventListener(event, onGesture, { passive: true });
    return () => {
      for (const event of events) window.removeEventListener(event, onGesture);
    };
  }, []);

  const running = status === 'running' || status === 'suspended';

  return (
    <div className="app">
      <TopBar onBrowse={() => setDrawerOpen(true)} status={status} />

      <DisplayRow />

      <main className="modules">
        <ModulesGrid>
          {layout.order.map((id) => (
            <ModuleFor key={id} id={id} />
          ))}
        </ModulesGrid>
      </main>

      <KeyboardDock />

      {status === 'suspended' ? (
        <button type="button" className="audio-hint" onClick={() => void engine.resumeIfSuspended()}>
          ⏸ 音频已暂停 · 点按此处恢复
        </button>
      ) : null}

      <PresetDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <ToastHost />
      <UpdateBanner />
      {!running ? <StartOverlay onStart={start} error={error} busy={busy} /> : null}
    </div>
  );
}
