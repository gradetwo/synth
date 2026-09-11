import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { engine } from '@/audio/engine';
import { installUserWave } from '@/audio/userWave';
import { installUserIr } from '@/audio/ir';
import { installUserSample } from '@/audio/userSample';
import { store } from '@/state/store';
import { useContrast, useLayout, usePower, useTheme, useView } from '@/hooks/useSynth';
import { useViewport } from '@/hooks/useViewport';
import { wireAnalysis } from '@/audio/analysis';
import { TopBar, DisplayRow, KeyboardDock } from '@/panels/layout';
import { CHANGELOG } from '@/changelog';
import { fxGraphOpen, useFxGraphOpen } from '@/state/overlays';
import { ModuleFor } from '@/panels/modules';
import { ModulesGrid } from '@/components/Module';
// The three dialogs carry a lot of copy (the guide alone is tens of KB) and
// ship as their own chunks: the synth itself should not wait for a manual.
const Guide = lazy(() => import('@/components/Guide').then((m) => ({ default: m.Guide })));
// The routing editor is a whole canvas: it belongs in a chunk of its own, not in
// the bundle every visitor downloads.
// The piano roll is a canvas editing surface behind a button: a chunk of its
// own, loaded when it is first opened.
import { SettingsDrawer } from '@/components/SettingsDrawer';

const PianoRoll = lazy(() => import('@/components/PianoRoll').then((m) => ({ default: m.PianoRoll })));
// The preset drawer and the flow canvas are behind a click or a view switch too.
// The settings drawer stays in the main chunk: it is the panel the shell test
// renders through, and keeping it eager keeps that test honest.
const PresetDrawer = lazy(() =>
  import('@/components/PresetDrawer').then((m) => ({ default: m.PresetDrawer })),
);
const SignalFlow = lazy(() => import('@/components/SignalFlow').then((m) => ({ default: m.SignalFlow })));
const FxGraphEditor = lazy(() =>
  import('@/components/FxGraphEditor').then((m) => ({ default: m.FxGraphEditor })),
);
const Changelog = lazy(() => import('@/components/Changelog').then((m) => ({ default: m.Changelog })));
const AudioSettings = lazy(() =>
  import('@/components/AudioSettings').then((m) => ({ default: m.AudioSettings })),
);
import { PlayerPanel } from '@/components/PlayerPanel';
import { ToastHost } from '@/components/Toast';
import { applyUpdate, onUpdateAvailable, registerServiceWorker } from '@/pwa/register';
import { setHapticsEnabled } from '@/hooks/useInputMode';
import { readShareCode } from '@/state/share';
import { APP_VERSION } from '@/version';

import { getLang, t } from '@/i18n';
import { toast } from '@/components/Toast';
import { midiPlayer } from '@/midi/player';
import { recorder } from '@/midi/recorder';
import { midiLibrary } from '@/midi/library';
import { setResolvedTheme } from '@/state/theme';

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
        {/* The logo and the version belong *here*: the first thing a returning
            player wants to know is which build they are looking at. */}
        <div className="start-brand">
          <svg className="start-logo" width="46" height="46" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10.5" stroke="currentColor" strokeOpacity=".35" />
            <path
              className="start-logo-wave"
              d="M3.5 12 Q6.5 4.5 12 12 T20.5 12"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <div className="start-name">
            GROOVE <b>SYNTH</b>
          </div>
          <div className="start-sub">GS-1 · v{APP_VERSION}</div>
        </div>
        <button type="button" className="start-btn" onClick={onStart} disabled={busy}>
          <span>{busy ? t('app.starting') : t('app.start')}</span>
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
        ) : null}
      </div>
    </div>
  );
}

function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  const lang = getLang();
  useEffect(() => {
    onUpdateAvailable(() => setAvailable(true));
  }, []);
  if (!available) return null;
  // Say what arrived, not just that something did: the newest release's first
  // line is what a returning player wants to know before reloading.
  const newest = CHANGELOG[0];
  const headline = newest?.items[0]?.[lang === 'zh' ? 0 : 1].replace(/\*\*/g, '') ?? '';
  return (
    <div className="update-banner" role="status">
      <span>🚀 {t('app.updateReady')}</span>
      {headline ? (
        <span className="update-what" data-act="update-what">
          v{newest.version} · {headline}
        </span>
      ) : null}
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
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [rollOpen, setRollOpen] = useState(false);
  const [status, setStatus] = useState(engine.getState());
  /** True once the engine has actually played in this session. */
  const [everRan, setEverRan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const layout = useLayout();
  const view = useView();
  const viewport = useViewport();
  const power = usePower();
  const theme = useTheme();
  const contrast = useContrast();
  const [systemDark, setSystemDark] = useState(true);

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
      const next = engine.getState();
      setStatus(next);
      if (next === 'running') setEverRan(true);
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

  // On phones the flow view starts without the piano dock so the graph gets the
  // screen, but the keyboard toggle keeps working — restore it on the way back.
  const keyboardBeforeFlow = useRef<boolean | null>(null);
  useEffect(() => {
    if (viewport.device !== 'phone') return;
    if (view === 'flow') {
      if (keyboardBeforeFlow.current === null) {
        keyboardBeforeFlow.current = store.getSnapshot().layout.keyboardVisible;
        if (keyboardBeforeFlow.current) store.setKeyboardVisible(false);
      }
    } else if (keyboardBeforeFlow.current !== null) {
      const restore = keyboardBeforeFlow.current;
      keyboardBeforeFlow.current = null;
      if (restore) store.setKeyboardVisible(true);
    }
  }, [view, viewport.device]);

  useEffect(() => {
    // Keep the graph muted when the power switch is off.
    engine.setMuted(!power);
  }, [power]);

  // Follow the OS colour scheme while `theme` is `auto`, including live
  // switches (macOS sunset, iOS appearance toggle, browser devtools).
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setSystemDark(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const resolvedTheme = theme === 'auto' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.style.colorScheme = resolvedTheme;
    document.body.classList.toggle('contrast', contrast);
    setResolvedTheme(resolvedTheme);
    // Keep the mobile browser chrome in step with the app.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolvedTheme === 'light' ? '#eef1f6' : '#0b0d11');
  }, [resolvedTheme, contrast]);

  useEffect(() => {
    setHapticsEnabled(layout.haptics);
  }, [layout.haptics]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      // Must run inside the gesture: creates + resumes the AudioContext before
      // the first await (Safari requirement).
      const layout = store.getSnapshot().layout;
      await engine.start(layout.polyphony || 16, store.getSnapshot().state.routes);
      // The graph exists from here on, even if the context refused to start
      // (Firefox can sit on `resume()`): treat that as a run so the suspended
      // hint is offered instead of an endless start gate.
      if (engine.hasGraph()) setEverRan(true);
      engine.setTuning(store.tuningTableFor(layout.temperament));
      // Layer/split routing lives in the workspace, so a restarted engine has to
      // be told about it (the params arrive with `applyState`).
      store.syncInstanceRouting();
      engine.applyState(store.getSnapshot().state, true);
      engine.setMuted(!store.getSnapshot().state.power);
      // The core's memory does not survive a reload: give it back the waveform
      // and the impulse response the player imported last time (both are queued
      // until the worklet is ready).
      void installUserWave();
      void installUserIr();
      void installUserSample();
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

  // Tell the user when the engine had to shed voices: from their side the
  // symptom is "the synth crackles", and the fix is knowing it is a load
  // problem (the monitor shows the DSP load).
  useEffect(
    () =>
      engine.onPolyphony((value, reason) => {
        if (reason !== 'overload') return;
        toast(t('app.overload').replace('{n}', String(value)));
      }),
    [],
  );

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

  // Warm the audio path while the user reads the start gate: the worklet can be
  // registered on a suspended context and the core fetched without a gesture.
  useEffect(() => {
    void engine.preload();
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

  // A context that exists is not a started engine (`engine.isReady()`): the
  // worklet may still be unbuilt, and gating on the context state hid the start
  // button over a silent app.
  const running = status === 'running';
  // Once it has genuinely run, a later interruption (iOS call, device change)
  // shows the resume hint instead of throwing the start gate back over the UI.
  const showGate = !running && (!everRan || status === 'error');

  /**
   * Open the piano-roll editor for the current track. Any running take is
   * finished and saved first so opening the editor never loses a recording.
   */
  const fxGraphOpenNow = useFxGraphOpen();
  const closeFxGraph = () => fxGraphOpen.set(false);

  const openRoll = () => {
    if (recorder.getState().recording) {
      const clip = recorder.stop();
      if (clip) {
        midiLibrary.put({
          id: 'clip',
          title: [t('player.recordingName'), t('player.recordingName')],
          composer: t('player.recordedBy'),
          song: clip,
          group: 'clip',
        })
      store.mark();
        toast(t('player.clipSaved', { n: clip.notes.length }));
      }
    }
    midiPlayer.stop();
    setPlayerOpen(false);
    setDrawerOpen(false);
    setRollOpen(true);
  };

  return (
    <div className="app" data-device={viewport.device} data-view={view}>
      <TopBar
        onBrowse={() => setDrawerOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onRoll={openRoll}
        view={view}
        onView={(next) => store.setView(next)}
      />

      <DisplayRow onOpenPlayer={() => setPlayerOpen(true)} />

      {view === 'flow' ? (
        <Suspense fallback={null}>
          <SignalFlow />
        </Suspense>
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

      {status === 'suspended' && everRan ? (
        <button type="button" className="audio-hint" onClick={() => void engine.resumeIfSuspended()}>
          {t('app.suspended')}
        </button>
      ) : null}

      <Suspense fallback={null}>
        <PianoRoll open={rollOpen} onClose={() => setRollOpen(false)} />
      </Suspense>

      {/* Mounted only while it is open, so a closed editor keeps no state. */}
      {fxGraphOpenNow ? (
        <Suspense fallback={null}>
          <FxGraphEditor onClose={closeFxGraph} />
        </Suspense>
      ) : null}

      <Suspense fallback={null}>
        <PresetDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </Suspense>

      <SettingsDrawer
        open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onOpenGuide={() => {
            setSettingsOpen(false);
            setGuideOpen(true);
          }}
          onOpenChangelog={() => {
            setSettingsOpen(false);
            setChangelogOpen(true);
          }}
          onOpenAudio={() => {
            setSettingsOpen(false);
            setAudioOpen(true);
          }}
      />
      {guideOpen ? (
        <Suspense fallback={null}>
          <Guide open onClose={() => setGuideOpen(false)} />
        </Suspense>
      ) : null}
      {changelogOpen ? (
        <Suspense fallback={null}>
          <Changelog open onClose={() => setChangelogOpen(false)} />
        </Suspense>
      ) : null}
      {audioOpen ? (
        <Suspense fallback={null}>
          <AudioSettings open onClose={() => setAudioOpen(false)} />
        </Suspense>
      ) : null}
      <PlayerPanel
        open={playerOpen}
        onClose={() => setPlayerOpen(false)}
        onEdit={openRoll}
      />
      <ToastHost />
      <UpdateBanner />
      {showGate ? <StartOverlay onStart={start} error={error} busy={busy} /> : null}
    </div>
  );
}
