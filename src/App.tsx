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

function StartOverlay({ onStart }: { onStart: () => void }) {
  return (
    <div className="start-overlay" role="dialog" aria-label="启动音频引擎">
      <button type="button" className="start-btn" onClick={onStart}>
        <span className="start-icon">▶</span>
        <span>启动音频引擎</span>
        <small>浏览器需要一次点击才能播放声音</small>
      </button>
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
  const { state } = useSynth();

  useEffect(() => {
    const off = engine.onStatus(() => setStatus(engine.getState()));
    void registerServiceWorker();
    return off;
  }, []);

  useEffect(() => {
    // Keep the graph muted when the power switch is off.
    engine.setMuted(!state.power);
  }, [state.power]);

  const start = async () => {
    try {
      await engine.init(16, store.getSnapshot().state.routes);
      engine.applyState(store.getSnapshot().state, true);
      engine.setMuted(!store.getSnapshot().state.power);
      await engine.resume();
    } catch {
      /* status listener surfaces the error */
    }
  };

  // Resume automatically on the first gesture once the context exists.
  useEffect(() => {
    const resume = () => {
      if (engine.getState() === 'suspended' || engine.getState() === 'idle') void start();
    };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
    return () => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
  }, []);

  const running = status === 'running' || status === 'suspended';

  return (
    <div className="app">
      <div className="notice">
        <span className="dot" />
        WASM 音频核心 · <b>Rust + AudioWorklet</b> · 完整离线 PWA · GS-1 v1.0.0
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
      {!running ? <StartOverlay onStart={start} /> : null}
    </div>
  );
}
