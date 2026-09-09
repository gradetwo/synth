import { useEffect, useState } from 'react';
import { engine } from '@/audio/engine';
import { store } from '@/state/store';
import { useLayout, usePower, useTheme, useView } from '@/hooks/useSynth';
import { useViewport } from '@/hooks/useViewport';
import { wireAnalysis } from '@/audio/analysis';
import { TopBar, DisplayRow, KeyboardDock } from '@/panels/layout';
import { ModuleFor } from '@/panels/modules';
import { ModulesGrid } from '@/components/Module';
import { PresetDrawer } from '@/components/PresetDrawer';
import { Guide } from '@/components/Guide';
import { PlayerPanel } from '@/components/PlayerPanel';
import { SignalFlow } from '@/components/SignalFlow';
import { ToastHost } from '@/components/Toast';
import { applyUpdate, onUpdateAvailable, registerServiceWorker } from '@/pwa/register';
import { setHapticsEnabled } from '@/hooks/useInputMode';
import { readShareCode } from '@/state/share';
import { APP_VERSION } from '@/version';
import { t } from '@/i18n';
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
    <div className="start-overlay" role="dialog" aria-label={t('app.start')}>
      <div className="start-card">
        <button type="button" className="start-btn" onClick={onStart} disabled={busy}>
          <span className="start-icon">▶</span>
          <span>{busy ? t('app.starting') : t('app.start')}</span>
          <small>{t('app.startHint')}</small>
        </button>
        {error ? (
          <div className="start-error" role="alert">
            <b>{t('app.startFailed')}</b>
            <p>{error}</p>
            <small>{diag}</small>
            <button type="button" className="start-retry" onClick={onStart} disabled={busy}>
              {t('app.retry')}
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
      <span>🚀 {t('app.updateReady')}</span>
      <button type="button" onClick={() => applyUpdate()}>
        {t('app.updateNow')}
      </button>
      <button type="button" className="ghost" onClick={() => setAvailable(false)} aria-label={t('app.later')}>
        ✕
      </button>
    </div>
  );
}

export default function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [status, setStatus] = useState(engine.getState());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const layout = useLayout();
  const view = useView();
  const viewport = useViewport();
  const power = usePower();
  const theme = useTheme();

  useEffect(() => {
    // Apply a shared patch from the URL hash on first load.
    const code = readShareCode();
    if (code && store.importPatchCode(code)) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      toast(t('app.sharedLoaded'));
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

  // Phones get a compact first-run layout (essential modules open, scope row
  // collapsed). Applied once, then the user's own choices win.
  useEffect(() => {
    if (viewport.device === 'phone') store.applyPhoneDefaults();
    if (viewport.device === 'desktop') store.expandAutoCollapsed();
  }, [viewport.device]);

  useEffect(() => {
    // Keep the graph muted when the power switch is off.
    engine.setMuted(!power);
  }, [power]);

  useEffect(() => {
    document.body.classList.toggle('contrast', theme === 'contrast');
  }, [theme]);

  useEffect(() => {
    setHapticsEnabled(layout.haptics);
  }, [layout.haptics]);

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
    <div className="app" data-device={viewport.device} data-view={view}>
      <TopBar
        onBrowse={() => setDrawerOpen(true)}
        status={status}
        view={view}
        onView={(next) => store.setView(next)}
      />

      <DisplayRow onOpenPlayer={() => setPlayerOpen(true)} />

      {view === 'flow' ? (
        <SignalFlow />
      ) : (
        <main className="modules">
          <ModulesGrid>
            {layout.order.map((id) => (
              <ModuleFor key={id} id={id} />
            ))}
          </ModulesGrid>
        </main>
      )}

      <KeyboardDock />

      {status === 'suspended' ? (
        <button type="button" className="audio-hint" onClick={() => void engine.resumeIfSuspended()}>
          {t('app.suspended')}
        </button>
      ) : null}

      <PresetDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onOpenGuide={() => {
          setDrawerOpen(false);
          setGuideOpen(true);
        }}
      />
      <Guide open={guideOpen} onClose={() => setGuideOpen(false)} />
      <PlayerPanel open={playerOpen} onClose={() => setPlayerOpen(false)} />
      <ToastHost />
      <UpdateBanner />
      {!running ? <StartOverlay onStart={start} error={error} busy={busy} /> : null}
    </div>
  );
}
