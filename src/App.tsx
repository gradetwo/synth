import { useEffect, useState } from 'react';
import { engine } from '@/audio/engine';
import { store } from '@/state/store';
import { useSynth } from '@/hooks/useSynth';
import { wireAnalysis } from '@/audio/analysis';
import { TopBar, DisplayRow, KeyboardBar } from '@/panels/layout';
import { FilterModule, EnvModule, FxModule, LfoModule, ModMatrix, OscModule } from '@/panels/modules';
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
  const { state } = useSynth();

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

  // Resume automatically on the first gesture once the context exists.
  useEffect(() => {
    const resume = () => {
      const s = engine.getState();
      if (s === 'idle' || s === 'suspended') void start();
    };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
    return () => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = status === 'running' || status === 'suspended';

  return (
    <div className="app">
      <div className="notice">
        <span className="dot" />
        WASM 音频核心 · <b>Rust + AudioWorklet</b> · 完整离线 PWA · GS-1 v1.0.1
      </div>

      <TopBar onBrowse={() => setDrawerOpen(true)} status={status} />

      <DisplayRow />

      <main className="modules">
        <section className="chain-row chain-a">
          <OscModule which={1} />
          <OscModule which={2} />
          <FilterModule />
          <EnvModule />
        </section>
        <section className="chain-row chain-b">
          <LfoModule />
          <ModMatrix />
          <FxModule />
        </section>
      </main>

      <KeyboardBar />

      <PresetDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <ToastHost />
      <UpdateBanner />
      {!running ? <StartOverlay onStart={start} error={error} busy={busy} /> : null}
    </div>
  );
}
