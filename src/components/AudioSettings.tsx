import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '@/i18n';
import { engine } from '@/audio/engine';
import { analysis } from '@/audio/analysis';
import { store } from '@/state/store';
import { useCcMap } from '@/hooks/useSynth';
import { Param, SPEC_BY_ID, PARAM_SPECS } from '@/audio/params';
import { ccForParam } from '@/audio/ccmap';

/** Knobs a controller can drive, in panel order. */
const CC_TARGETS = PARAM_SPECS.filter((spec) => !spec.discrete || spec.max > 1).map((spec) => ({
  id: spec.id,
  label: spec.label,
}));

/** Polyphony the user can pin; 0 = let the load monitor decide. */
const POLY_CHOICES = [4, 8, 16, 32];

function Row({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="audio-row">
      <span className="audio-label">{label}</span>
      <span className="audio-value">{value}</span>
      {hint ? <span className="audio-hint-text">{hint}</span> : null}
    </div>
  );
}

/**
 * Audio settings and live diagnostics.
 *
 * Everything a "why does it sound like that on my device" question needs: the
 * context rate and latency the browser actually gave us, the polyphony in
 * force, and the DSP load the render thread is measuring right now.
 */
export function AudioSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [poly, setPoly] = useState(engine.polyphony);
  const [ccParam, setCcParam] = useState<number>(Param.FILTER_CUTOFF);
  const [learn, setLearn] = useState<number | null>(null);
  const ccMap = useCcMap();
  // Diagnostics are read during render; the subscription only bumps a counter
  // so a status change (running → suspended) repaints the panel.
  const [, bump] = useState(0);
  const diag = engine.diagnostics();
  const caption = useRef<HTMLSpanElement | null>(null);
  const loadRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => engine.onPolyphony(setPoly), []);
  useEffect(() => store.subscribe(() => setLearn(store.getSnapshot().midiLearn)), []);
  useEffect(() => engine.onStatus(() => bump((n) => n + 1)), []);

  // Live numbers without re-rendering React: the panel is a readout.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const tick = () => {
      const load = analysis.load;
      if (caption.current) {
        const peak = analysis.truePeak;
        caption.current.textContent = peak > 1e-6 ? `${(20 * Math.log10(peak)).toFixed(1)} dB` : '—';
      }
      if (loadRef.current) {
        loadRef.current.textContent = load > 0.005 ? `${Math.round(load * 100)}%` : '—';
        loadRef.current.classList.toggle('hot', load > 0.9);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const ctx = engine.ctx;
  const latencyMs =
    ctx && 'baseLatency' in ctx
      ? Math.round((ctx.baseLatency + ((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0)) * 1000)
      : null;

  return (
    <>
      <div className={`guide-mask${open ? ' show' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside
        className={`guide audio-settings${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('audio.title')}
        aria-hidden={!open}
      >
        <header className="guide-head">
          <span className="guide-mark" aria-hidden="true">
            ◍
          </span>
          <div className="guide-head-text">
            <span className="guide-title">{t('audio.title')}</span>
            <span className="guide-sub">{t('audio.sub')}</span>
          </div>
          <button type="button" className="d-close" onClick={onClose} aria-label={t('drawer.close')}>
            ✕
          </button>
        </header>

        <div className="guide-body">
          <article className="audio-body" key={String(open)}>
            <Row
              label={t('audio.engine')}
              value={
                diag.contextState === 'none'
                  ? t('audio.notStarted')
                  : diag.contextState
              }
            />
            <Row
              label={t('audio.sampleRate')}
              value={diag.sampleRate ? `${(diag.sampleRate / 1000).toFixed(1)} kHz` : '—'}
            />
            <Row label={t('audio.latency')} value={latencyMs != null ? `${latencyMs} ms` : '—'} />
            <Row label={t('audio.core')} value={diag.wasm === 'none' ? '—' : diag.wasm} />
            <Row label={t('audio.peak')} value={<span ref={caption}>—</span>} />
            <Row
              label={t('audio.load')}
              value={<span ref={loadRef} className="audio-load">—</span>}
              hint={t('audio.loadHint')}
            />

            <div className="audio-poly">
              <span className="audio-label">{t('audio.polyphony')}</span>
              <div className="seg audio-poly-seg" role="group" aria-label={t('audio.polyphony')}>
                {POLY_CHOICES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`seg-btn${poly === n ? ' active seg-on' : ''}`}
                    aria-pressed={poly === n}
                    onClick={() => {
                      store.setPolyphony(n);
                      setPoly(Math.min(n, engine.polyphony));
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="audio-note">{t('audio.polyHint')}</p>
            </div>

            <div className="audio-cc">
              <span className="audio-label">{t('cc.title')}</span>
              <p className="audio-note">{t('cc.hint')}</p>
              <div className="audio-cc-row">
                <select
                  value={ccParam}
                  aria-label={t('cc.param')}
                  onChange={(event) => {
                    setCcParam(Number(event.target.value));
                    store.armMidiLearn(null);
                  }}
                >
                  {CC_TARGETS.map((spec) => (
                    <option key={spec.id} value={spec.id}>
                      {spec.label}
                    </option>
                  ))}
                </select>
                {learn === ccParam ? (
                  <button type="button" className="roll-btn primary" onClick={() => store.armMidiLearn(null)}>
                    {t('cc.waiting')}
                  </button>
                ) : (
                  <button type="button" className="roll-btn" onClick={() => store.armMidiLearn(ccParam)}>
                    {t('cc.learn')}
                  </button>
                )}
                <button
                  type="button"
                  className="roll-btn"
                  disabled={ccForParam(ccMap, ccParam) == null}
                  onClick={() => store.clearMidiCc(ccParam)}
                >
                  {t('cc.clear')}
                </button>
              </div>
              <p className="audio-note">
                {ccMap.length === 0
                  ? t('cc.none')
                  : ccMap
                      .map((b) => `CC${b.cc} → ${SPEC_BY_ID[b.param]?.label ?? b.param}`)
                      .join(' · ')}
              </p>
            </div>

            {ctx && ctx.state !== 'running' ? (
              <button type="button" className="roll-btn primary audio-resume" onClick={() => void engine.resumeIfSuspended()}>
                {t('audio.resume')}
              </button>
            ) : null}
            <footer className="guide-foot">{t('audio.footer')}</footer>
          </article>
        </div>
      </aside>
    </>
  );
}
