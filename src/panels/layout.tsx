import { useEffect, useState } from 'react';
import { store } from '@/state/store';
import { useActiveSlot, useCanRedo, useCanUndo, useDisplayExpanded, useKeyboardVisible, usePower, usePresetId, useSlotFilled } from '@/hooks/useSynth';
import { noteBus, noteName, noteToHz } from '@/audio/noteBus';
import { LfoLed, LfoRateLabel, Scope, ScopeMeta, Spectrum, VuMeter } from '@/components/canvas';
import { Keyboard, Wheels } from '@/components/Keyboard';
import { toast } from '@/components/Toast';
import { engine, type EngineStatus } from '@/audio/engine';
import { midi } from '@/audio/midi';
import { localizeName, t } from '@/i18n';
import { haptic, useInputMode } from '@/hooks/useInputMode';
import { useViewport } from '@/hooks/useViewport';
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
      <span className="tbtn-label">{label}</span>
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
  const { device, width, height } = useViewport();
  const phone = device === 'phone';
  // Phones and portrait tablets keep a compact bar with a secondary-action
  // menu; landscape tablets and desktops have room for the inline row.
  const compactBar = phone || (device === 'tablet' && height > width);
  const desktop = device === 'desktop';
  const [moreOpen, setMoreOpen] = useState(false);

  // Close the phone overflow menu on outside tap or Escape.
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.top-more')) setMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  const abGroup = (
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
  );

  const undoRedo = (
    <>
      <button type="button" className="tbtn icon" disabled={!canUndo} title={`${t('top.undo')} (Ctrl+Z)`} aria-label={t('top.undo')} onClick={() => { haptic(); store.undo(); }}>
        ↶
      </button>
      <button type="button" className="tbtn icon" disabled={!canRedo} title={`${t('top.redo')} (Ctrl+Shift+Z)`} aria-label={t('top.redo')} onClick={() => { haptic(); store.redo(); }}>
        ↷
      </button>
    </>
  );

  const keyboardButton = (
    <button
      type="button"
      className={`tbtn${keyboardVisible ? ' on' : ''}`}
      data-kb="1"
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
      <span className="tbtn-label">{t('top.keyboard')}</span>
    </button>
  );

  const randomButton = (
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
      <span className="tbtn-label">{t('top.random')}</span>
    </button>
  );

  const saveButton = (
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
      <span className="tbtn-label">{t('top.save')}</span>
    </button>
  );

  const browseButton = (
    <button type="button" className="tbtn primary" onClick={onBrowse}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
      <span className="tbtn-label">{t('top.browse')}</span>
    </button>
  );

  const viewToggle = (
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
  );

  return (
    <header className={`topbar${compactBar ? ' compact' : ''}`}>
      <div className="brand">
        <div className="brand-mark">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9.5" stroke="#3a4152" />
            <path d="M4.5 12 Q7.5 5 12 12 T19.5 12" stroke="#ffb340" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>
        {!phone ? (
          <div className="brand-text">
            <div className="brand-name">
              GROOVE <b>SYNTH</b>
            </div>
            <div className="brand-sub">GS-1 · WEB POLYPHONIC SYNTH</div>
          </div>
        ) : null}
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
        {!phone ? <EngineBadge status={status} /> : null}
        {!compactBar ? viewToggle : null}
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

      {compactBar ? (
        <div className="top-actions compact">
          {phone ? <EngineBadge status={status} /> : null}
          {keyboardButton}
          <div className="top-more">
            <button
              type="button"
              className="tbtn icon"
              aria-expanded={moreOpen}
              aria-label={t('top.more')}
              title={t('top.more')}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </button>
            {moreOpen ? (
              <div className="top-menu" role="menu">
                {abGroup}
                {undoRedo}
                <MidiButton />
                {randomButton}
                {saveButton}
                {browseButton}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="top-actions">
          {abGroup}
          {undoRedo}
          <MidiButton />
          {keyboardButton}
          {randomButton}
          {saveButton}
          {browseButton}
          {desktop ? (
            <div className="top-more">
              <button
                type="button"
                className="tbtn icon"
                aria-expanded={moreOpen}
                aria-label={t('top.more')}
                title={t('top.more')}
                onClick={() => setMoreOpen((v) => !v)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>
              {moreOpen ? (
                <div className="top-menu" role="menu">
                  {abGroup}
                  {randomButton}
                  {saveButton}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      {compactBar ? viewToggle : null}
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

function PlayerButton({ onOpen, iconOnly }: { onOpen: () => void; iconOnly?: boolean }) {
  return (
    <button
      type="button"
      className={`demo-btn player-open${iconOnly ? ' icon-only' : ''}`}
      onClick={onOpen}
      aria-label={t('player.title')}
      title={t('player.title')}
    >
      <span className="po-icon" aria-hidden="true">▶</span>
      {iconOnly ? null : t('player.title')}
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


export function DisplayRow({ onOpenPlayer }: { onOpenPlayer: () => void }) {
  const { device, width, height } = useViewport();
  const stored = useDisplayExpanded();
  // Only the desktop keeps the full scope/spectrum/monitor row by default;
  // phones and tablets start with the compact strip and can expand it.
  const canCollapse = device !== 'desktop';
  const expanded = stored ?? device === 'desktop';
  // Any strip wide enough carries the live waveform and spectrum so the note
  // box is not a stretched, mostly empty panel.
  const showMeters = device === 'tablet' || (device === 'phone' && width > height);

  if (canCollapse && !expanded) {
    return (
      <section className={`display-row compact${showMeters ? ' has-meters' : ''}`}>
        <NoteDisplay />
        {showMeters ? (
          <div className="strip-scope">
            <Scope />
          </div>
        ) : null}
        {showMeters ? (
          <div className="strip-spec">
            <Spectrum />
          </div>
        ) : null}
        <PlayerButton onOpen={onOpenPlayer} iconOnly />
        <VuMeter />
        <button
          type="button"
          className="display-toggle"
          aria-label={t('display.expand')}
          title={t('display.expand')}
          onClick={() => {
            haptic();
            store.setDisplayExpanded(true);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </section>
    );
  }

  return (
    <section className="display-row">
      {canCollapse ? (
        <div className="display-bar">
          <span className="db-label">
            {t('panel.scope')} · {t('panel.spectrum')} · {t('panel.monitor')}
          </span>
          <button
            type="button"
            className="display-toggle"
            aria-label={t('display.collapse')}
            title={t('display.collapse')}
            onClick={() => {
              haptic();
              store.setDisplayExpanded(false);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 15l6-6 6 6" />
            </svg>
          </button>
        </div>
      ) : null}
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
