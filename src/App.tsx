import { useEffect, useState } from 'react';
import { engine } from '@/audio/engine';
import { store } from '@/state/store';
import { useSynth } from '@/hooks/useSynth';
import { wireAnalysis } from '@/audio/analysis';
import { TopBar, DisplayRow, KeyboardDock } from '@/panels/layout';
import { ModuleFor } from '@/panels/modules';
import { ModulesGrid } from '@/components/Module';
import { PresetDrawer } from '@/components/PresetDrawer';
import { ToastHost } from '@/components/Toast';
import { applyUpdate, onUpdateAvailable, registerServiceWorker } from '@/pwa/register';

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
  const diag = `SIMD ${d.simd ? '✓' : '✗'} · WASM ${d.wasm} · AudioContext ${d.contextState} · ${d.sampleRate} Hz`;
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
  const { state, layout } = useSynth();

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
    engine.setMuted(!state.power);
  }, [state.power]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = status === 'running' || status === 'suspended';

  return (
    <div className="app">
      <div className="notice">
        <span className="dot" />
        WASM 音频核心 · <b>Rust + AudioWorklet</b> · 完整离线 PWA · GS-1 v1.0.4
      </div>

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
