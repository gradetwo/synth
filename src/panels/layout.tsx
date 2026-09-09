import { useEffect, useState } from 'react';
import { store } from '@/state/store';
import { useActiveSlot, useCanRedo, useCanUndo, useKeyboardVisible, usePower, usePresetId, useSlotFilled } from '@/hooks/useSynth';
import { noteBus, noteName, noteToHz } from '@/audio/noteBus';
import { LfoLed, LfoRateLabel, Scope, ScopeMeta, Spectrum, VuMeter } from '@/components/canvas';
import { Keyboard, Wheels } from '@/components/Keyboard';
import { toast } from '@/components/Toast';
import { engine, type EngineStatus } from '@/audio/engine';
import { midi } from '@/audio/midi';
import { renderPatchToWav } from '@/audio/render';
import { downloadBlob } from '@/state/share';
import { localizeName, t } from '@/i18n';
import { haptic, useInputMode } from '@/hooks/useInputMode';
import { detectChord } from '@/audio/chords';

function MidiButton() {
  const [snap, setSnap] = useState(midi.snapshot());
  useEffect(() => midi.subscribe(() => setSnap(midi.snapshot())), []);
  const label = snap.enabled ? `MIDI ${snap.devices.length}` : 'MIDI';
  const title = !snap.supported
    ? t('top.midiUnsupported')
    : snap.error
      ? t('top.midiError', { msg: snap.error })
      : snap.enabled
        ? snap.devices.map((d) => d.name).join(', ') || t('top.midiEnabled')
        : t('top.midiConnect');
  return (
    <button
      type="button"
      className={`tbtn${snap.enabled ? ' on' : ''}`}
      title={title}
      aria-pressed={snap.enabled}
      onClick={() => (snap.enabled ? midi.disable() : void midi.enable())}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 4v10a4 4 0 0 0 4 4h12" />
        <path d="M8 4v6M12 4v6M16 4v6" />
      </svg>
      {label}
    </button>
  );
}

// ---------------------------------------------------------------- top bar

function EngineBadge({ status }: { status: EngineStatus }) {
  const label =
    status === 'running'
      ? 'ONLINE'
      : status === 'loading'
        ? 'LOADING'
        : status === 'suspended'
          ? 'SUSPENDED'
          : status === 'error'
            ? 'ERROR'
            : 'STANDBY';
  return <span className={`engine-badge ${status}`}>{label}</span>;
}

export function TopBar({
  onBrowse,
  status,
  view,
  onView,
}: {
  onBrowse: () => void;
  status: EngineStatus;
  view: 'modules' | 'flow';
  onView: (view: 'modules' | 'flow') => void;
}) {
  const currentPresetId = usePresetId();
  const power = usePower();
  const keyboardVisible = useKeyboardVisible();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const activeSlot = useActiveSlot();
  const slotAFilled = useSlotFilled('a');
  const slotBFilled = useSlotFilled('b');
  const preset = store.allPresets().find((p) => p.id === currentPresetId);

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9.5" stroke="#3a4152" />
            <path d="M4.5 12 Q7.5 5 12 12 T19.5 12" stroke="#ffb340" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>
        <div className="brand-text">
          <div className="brand-name">
            GROOVE <b>SYNTH</b>
          </div>
          <div className="brand-sub">GS-1 · WEB POLYPHONIC SYNTH</div>
        </div>
        <button
          type="button"
          className="power-btn"
          title={t('top.power')}
          aria-label={t('top.power')}
          aria-pressed={power}
          onClick={() => {
            haptic();
            store.setPower(!power);
          }}
        >
          <span className={`pled${power ? ' on' : ''}`} />
        </button>
        <EngineBadge status={status} />
        <div className="view-toggle" role="group" aria-label={t('view.label')}>
          <button
            type="button"
            className={`vt-btn${view === 'modules' ? ' on' : ''}`}
            aria-pressed={view === 'modules'}
            onClick={() => {
              haptic();
              onView('modules');
            }}
          >
            {t('view.modules')}
          </button>
          <button
            type="button"
            className={`vt-btn${view === 'flow' ? ' on' : ''}`}
            aria-pressed={view === 'flow'}
            onClick={() => {
              haptic();
              onView('flow');
            }}
          >
            {t('view.flow')}
          </button>
        </div>
      </div>

      <div className="preset-ctrl">
        <button type="button" className="nav-btn" title={t('top.prevPreset')} aria-label={t('top.prevPreset')} onClick={() => { haptic(); store.stepPreset(-1); }}>
          ‹
        </button>
        <div
          className="preset-display"
          role="button"
          tabIndex={0}
          title={t('top.openPresets')}
          onClick={onBrowse}
          onKeyDown={(e) => (e.key === 'Enter' ? onBrowse() : undefined)}
        >
          <div>
            <span className="preset-tag">{preset?.tag ?? 'INIT'}</span>
          </div>
          <div className="preset-name">{localizeName(preset?.name ?? t('preset.initName'))}</div>
        </div>
        <button type="button" className="nav-btn" title={t('top.nextPreset')} aria-label={t('top.nextPreset')} onClick={() => { haptic(); store.stepPreset(1); }}>
          ›
        </button>
      </div>

      <div className="top-actions">
        <div className="ab-group" role="group" aria-label={t('top.abGroup')}>
          <button
            type="button"
            className={`ab-slot${activeSlot === 'a' ? ' on' : ''}${slotAFilled ? ' filled' : ''}`}
            title={t('top.slotA')}
            aria-pressed={activeSlot === 'a'}
            onClick={() => {
              haptic();
              store.selectSlot('a');
            }}
          >
            A
          </button>
          <button
            type="button"
            className={`ab-slot${activeSlot === 'b' ? ' on' : ''}${slotBFilled ? ' filled' : ''}`}
            title={t('top.slotB')}
            aria-pressed={activeSlot === 'b'}
            onClick={() => {
              haptic();
              store.selectSlot('b');
            }}
          >
            B
          </button>
          <button type="button" className="ab-copy" title={t('top.copySlot')} onClick={() => { haptic(); store.copySlot(); }}>
            ⇄
          </button>
        </div>
        <button type="button" className="tbtn icon" disabled={!canUndo} title={`${t('top.undo')} (Ctrl+Z)`} aria-label={t('top.undo')} onClick={() => { haptic(); store.undo(); }}>
          ↶
        </button>
        <button type="button" className="tbtn icon" disabled={!canRedo} title={`${t('top.redo')} (Ctrl+Shift+Z)`} aria-label={t('top.redo')} onClick={() => { haptic(); store.redo(); }}>
          ↷
        </button>
        <MidiButton />
        <button
          type="button"
          className={`tbtn${keyboardVisible ? ' on' : ''}`}
          title={keyboardVisible ? t('top.keyboardHide') : t('top.keyboardShow')}
          aria-pressed={keyboardVisible}
          onClick={() => {
            haptic();
            store.toggleKeyboard();
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 10h1M9 10h1M12 10h1M15 10h1M18 10h1M7 14h10" strokeLinecap="round" />
          </svg>
          {t('top.keyboard')}
        </button>
        <button
          type="button"
          className="tbtn"
          title={t('top.randomTitle')}
          onClick={() => {
            haptic();
            store.randomize();
            toast(t('top.randomToast'));
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="4" />
            <circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="15.5" cy="15.5" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="8.5" cy="15.5" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
          </svg>
          {t('top.random')}
        </button>
        <button
          type="button"
          className="tbtn"
          onClick={() => {
            const p = store.savePreset();
            toast(t('top.savedToast', { name: localizeName(p.name) }));
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <path d="M17 21v-8H7v8M7 3v5h8" />
          </svg>
          {t('top.save')}
        </button>
        <button type="button" className="tbtn primary" onClick={onBrowse}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
          {t('top.browse')}
        </button>
      </div>
    </header>
  );
}

// ----------------------------------------------------------------- monitor

function NoteDisplay() {
  const [info, setInfo] = useState({ note: null as number | null, velocity: 1, voices: 0 });
  const [held, setHeld] = useState<number[]>([]);
  useEffect(
    () =>
      noteBus.subscribe((next) => {
        setInfo(next);
        setHeld(noteBus.heldNotes());
      }),
    [],
  );
  const chord = detectChord(held);
  return (
    <div className={`note-display${chord ? ' chord' : ''}`}>
      <span className="nd-label">{chord ? 'CHORD' : 'NOTE'}</span>
      <span className="nd-val">{chord ? chord.name : info.note === null ? '—' : noteName(info.note)}</span>
      <span className="nd-sub">
        {chord
          ? `${held.map(noteName).join(' ')}`
          : info.note === null
            ? '0.0 Hz'
            : `${noteToHz(info.note).toFixed(1)} Hz`}
        {` · VEL ${Math.round(info.velocity * 127)}`}
        {info.voices > 1 ? ` · ${info.voices} VOICES` : ''}
      </span>
    </div>
  );
}

function PlayerButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="demo-btn player-open" onClick={onOpen}>
      <span className="po-icon" aria-hidden="true">▶</span> {t('player.title')}
    </button>
  );
}

function PolyBadge() {
  const [poly, setPoly] = useState(engine.polyphony);
  useEffect(() => engine.onPolyphony(setPoly), []);
  if (poly >= 16) return null;
  return (
    <span className="poly-badge" title={t('monitor.polyTitle')}>
      POLY {poly}
    </span>
  );
}

function WavButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="demo-btn"
      disabled={busy}
      title={t('monitor.wavTitle')}
      onClick={async () => {
        setBusy(true);
        try {
          const blob = await renderPatchToWav(store.getSnapshot().state);
          downloadBlob('gs1-patch.wav', blob);
          toast(t('monitor.wavDone'));
        } catch (err) {
          toast(t('monitor.wavFailed', { msg: err instanceof Error ? err.message : String(err) }));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? t('monitor.rendering') : t('monitor.wav')}
    </button>
  );
}

export function DisplayRow({ onOpenPlayer }: { onOpenPlayer: () => void }) {
  return (
    <section className="display-row">
      <div className="panel scope-panel">
        <div className="panel-head">
          <span className="ph-title">{t('panel.scope')}</span>
          <ScopeMeta />
        </div>
        <div className="scope-body">
          <Scope />
        </div>
      </div>

      <div className="panel spectrum-panel">
        <div className="panel-head">
          <span className="ph-title">{t('panel.spectrum')}</span>
          <span className="ph-meta">36 BINS · PEAK HOLD</span>
        </div>
        <div className="spec-body">
          <Spectrum />
        </div>
      </div>

      <div className="panel monitor-panel">
        <div className="panel-head">
          <span className="ph-title">{t('panel.monitor')}</span>
        </div>
        <div className="monitor-actions">
          <PlayerButton onOpen={onOpenPlayer} />
          <WavButton />
        </div>
        <div className="monitor-body">
          <NoteDisplay />
          <VuMeter />
          <div className="lfo-mon">
            <span className="lm-label">LFO</span>
            <LfoLed />
            <LfoRateLabel />
            <PolyBadge />
          </div>
        </div>
      </div>
    </section>
  );
}

// -------------------------------------------------------------- keyboard dock

/**
 * Floating performance keyboard pinned to the bottom of the viewport.
 * Hideable so it never blocks the module editor on small screens.
 */
export function KeyboardDock() {
  const visible = useKeyboardVisible();
  const mode = useInputMode();
  const touch = mode === 'touch';
  const tips = touch ? ['kbd.tipT1', 'kbd.tipT2', 'kbd.tipT3', 'kbd.tipT4'] : ['kbd.tip1', 'kbd.tip2', 'kbd.tip3', 'kbd.tip4'];
  return (
    <>
      <div
        className={`kbd-dock${visible ? ' open' : ''}${touch ? ' touch' : ''}`}
        role="region"
        aria-label={t('kbd.region')}
        aria-hidden={!visible}
      >
        <div className="kbd-dock-inner">
          <Wheels />
          <Keyboard />
          <div className="kbd-tips">
            {tips.map((key) => (
              <div key={key} dangerouslySetInnerHTML={{ __html: t(key) }} />
            ))}
          </div>
          <div className="kbd-hint">{t(touch ? 'kbd.hintTouch' : 'kbd.hintMouse')}</div>
          <button
            type="button"
            className="dock-hide"
            onClick={() => store.setKeyboardVisible(false)}
            aria-label={t('top.keyboardHide')}
            title={t('top.keyboardHide')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 4.5 L6 8.5 L10 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
      {visible ? <div className="dock-spacer" aria-hidden="true" /> : null}
      {!visible ? (
        <button
          type="button"
          className="dock-show"
          onClick={() => store.setKeyboardVisible(true)}
          aria-label={t('top.keyboardShow')}
          title={t('top.keyboardShow')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 10h1M9 10h1M12 10h1M15 10h1M18 10h1M7 14h10" strokeLinecap="round" />
          </svg>
          {t('top.keyboard')}
        </button>
      ) : null}
    </>
  );
}
