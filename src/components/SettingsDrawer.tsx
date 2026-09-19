/**
 * Settings drawer.
 *
 * The settings used to live at the bottom of the preset library, where they grew
 * a control at a time until they were a wall of buttons that also pushed the
 * presets around. They are their own entry now, at the same level as the preset
 * library, grouped by what they are for — so the next control has an obvious
 * home instead of making the pile longer.
 *
 * Controls are deliberately *not* stretched to fill a column: a select that
 * shows "平均律" does not need 380px of width to look tidy.
 */

import { lazy, Suspense, useRef, useState, type ReactNode } from 'react';
import { store } from '@/state/store';
import { checkForUpdate } from '@/pwa/register';
import { TEMPERAMENTS } from '@/audio/tuning';
import { VELOCITY_CURVES, velocityCurveLabel } from '@/audio/velocity';
import { parseScala } from '@/audio/scala';
import { toast } from './Toast';
import { fxGraphOpen } from '@/state/overlays';
import { LANG_LABELS, loadAllStrings, t } from '@/i18n';
import { useHaptics, useLang, useTheme, useContrast } from '@/hooks/useSynth';
import { useStringsReady } from '@/hooks/useStringsReady';
import { canVibrate, haptic, HAPTIC } from '@/hooks/useInputMode';

/**
 * One key from the drawer's lazy table, used as the readiness sentinel.
 * Registration is atomic, so this one probe answers "is the drawer's copy in
 * memory"; a hand-written list of all 45 keys would be ~1 KB of duplicated
 * strings in the entry chunk for the same answer.
 */
const SETTINGS_SENTINEL = ['settings.title'];

/**
 * The project manager — its row and its panel — is a lazy chunk of its own
 * (P10.4): the list, the snapshots and the `.gs1proj` import/export live behind
 * one row in the workspace section, and neither their code nor their copy
 * belongs on the first screen. The row owns the panel, so nothing about it has
 * to be hoisted into the eager shell; the copy it needs is registered by its own
 * chunk before the row renders.
 */
const ProjectsRow = lazy(() => import('@/components/Projects'));

/**
 * The practice panel is a lazy chunk of its own (P12.1), reached from one row
 * here: its code, its stylesheet and its copy stay out of the first screen. It
 * too owns its panel, so the shell only knows "there is a row here".
 */
const TeachingRow = lazy(() => import('@/components/Teaching'));

/**
 * A 44px finger target around one native `<select>`.
 *
 * macOS/iOS WebKit sizes a select with the default (native) appearance from the
 * platform control's own metrics. Measured on macOS, four selects in these rows
 * were 82x19, 95x19, 152x19 and 53x19 while every button beside them was 44x44,
 * and a *freshly injected* select in the same row behaved identically: the
 * `min-height:44px` / `padding` rules match (computed `min-width` 44px,
 * `min-height` 18px) but a native-appearance control honours neither, so the
 * box stays 19px. `appearance:none` would make the box obey the rule; the
 * product keeps the platform control instead, because that is what draws the
 * dropdown arrow.
 *
 * So the wrapper is the target. `<label>` is the semantic form of "this region
 * belongs to that control": activating a label forwards to the labelled
 * control. Measured on the engines available here (Linux Chromium and Linux
 * WebKit), a tap in the wrapper's 44px padding -- with `elementFromPoint`
 * confirming it did *not* land on the control -- produces the same event
 * signature as a tap on the control itself (a synthetic `click` on the select,
 * a `focus` event, the select then answering the keyboard).
 *
 * Deliberately no explicit activation on top. The obvious one,
 * `select.showPicker()`, does not exist in Safari: MDN/BCD lists
 * `HTMLSelectElement.showPicker` for Safari only as "preview" behind a flag (and
 * Linux WebKit reports `typeof showPicker === "function"` false too). There it
 * would fall back to `focus()` -- which focuses without opening the picker --
 * and it would have to `preventDefault()` the label's own activation to avoid
 * opening the picker twice, i.e. it would *remove* the one path that does open
 * the picker on the engines this wrapper exists for. Measured, that combination
 * (preventDefault + showPicker, probe variant C) left Linux WebKit with no
 * click, no focus and no value change at all on the edge tap.
 *
 * On a fine pointer the wrapper draws no box (`display:contents`), so the
 * desktop layout is exactly what it was; only `@media (pointer: coarse)` gives
 * it the 44px inline-flex box and centres the control inside it.
 */
function SelectTarget({ children }: { children: ReactNode }) {
  return <label className="select-target">{children}</label>;
}

export function SettingsDrawer({
  open,
  onClose,
  onOpenGuide,
  onOpenChangelog,
  onOpenAudio,
}: {
  open: boolean;
  onClose: () => void;
  onOpenGuide: () => void;
  onOpenChangelog: () => void;
  onOpenAudio: () => void;
}) {
  const lang = useLang();
  const theme = useTheme();
  const contrast = useContrast();
  const hapticsOn = useHaptics();
  const vibrate = canVibrate();
  // Bumped after a mutation so the selects re-read the store.
  const [, bump] = useState(0);
  const scaleRef = useRef<HTMLInputElement | null>(null);
  /**
   * The drawer's own copy is lazy (P11.2): it is an off-canvas panel, so none
   * of it is on the first screen, and the ~45 keys cost more than the rest of
   * the core table put together. Until the table registers this returns null —
   * the drawer is closed and hidden at that point, so nothing flickers; the
   * boot preload in `main.tsx` normally wins the race before a user can click
   * the gear at all.
   */
  const stringsReady = useStringsReady(SETTINGS_SENTINEL);

  if (!stringsReady) return null;

  const temperamentLabel = (id: string) => {
    if (id === 'custom') {
      const scale = store.getSnapshot().layout.customTuning;
      return scale ? `${lang === 'zh' ? '自定义' : 'Custom'} · ${scale.name}` : 'Custom';
    }
    const temperament = TEMPERAMENTS.find((x) => x.id === id) ?? TEMPERAMENTS[0];
    return temperament.name[lang === 'zh' ? 0 : 1];
  };

  const importScale = async (file: File) => {
    try {
      const scale = parseScala(await file.text());
      store.importTuning(scale);
      bump((n) => n + 1);
      toast(t('tuning.imported', { name: scale.name, notes: String(scale.degrees.length) }));
    } catch (err) {
      toast(t('tuning.importFailed', { msg: err instanceof Error ? t(`tuning.${err.message}`) : '' }));
    }
  };

  const scenes = store.getSnapshot().scenes;

  return (
    <>
      <div className={`drawer-mask${open ? ' show' : ''}`} onClick={onClose} />
      <aside
        className={`drawer settings-drawer${open ? ' open' : ''}`}
        aria-hidden={!open}
        aria-label={t('settings.title')}
      >
        <div className="drawer-head">
          <span className="d-title">{t('settings.title')}</span>
          <button type="button" className="d-close" onClick={onClose} aria-label={t('drawer.close')}>
            ✕
          </button>
        </div>
        <div className="d-body">
          <div className="settings-body">
            <section className="settings-section" data-section="workspace">
              <h3>{t('settings.workspace')}</h3>
              <div className="settings-row" data-setting="scene">
                <span className="settings-label">{t('scene.title')}</span>
                <SelectTarget>
                  <select
                    aria-label={t('scene.title')}
                    value=""
                    onChange={(event) => {
                      if (!event.target.value) return;
                      haptic();
                      store.applyScene(event.target.value);
                      toast(t('scene.applied'));
                    }}
                  >
                    <option value="">{t('scene.pick')}</option>
                    {scenes.map((scene) => (
                      <option key={scene.id} value={scene.id}>
                        {scene.name}
                      </option>
                    ))}
                  </select>
                </SelectTarget>
                <button
                  type="button"
                  className="roll-btn"
                  onClick={() => {
                    haptic();
                    const scene = store.saveScene(
                      `${t('scene.defaultName')} ${store.getSnapshot().scenes.length + 1}`,
                    );
                    bump((n) => n + 1);
                    toast(t('scene.saved', { name: scene.name }));
                  }}
                >
                  {t('scene.save')}
                </button>
                <button
                  type="button"
                  className="roll-btn"
                  disabled={scenes.length === 0}
                  onClick={() => {
                    const list = store.getSnapshot().scenes;
                    if (!list.length) return;
                    haptic();
                    store.deleteScene(list[list.length - 1].id);
                    bump((n) => n + 1);
                    toast(t('scene.deleted'));
                  }}
                >
                  {t('scene.delete')}
                </button>
              </div>

              <div className="settings-row" data-setting="fxGraph">
                <span className="settings-label">{t('fxg.title')}</span>
                <button
                  type="button"
                  className="roll-btn"
                  data-act="fx-graph-open"
                  title={t('fxg.hintOn')}
                  onClick={() => {
                    haptic();
                    fxGraphOpen.set(true);
                    onClose();
                  }}
                >
                  {t('fxg.open')}
                </button>
              </div>

              <Suspense fallback={null}>
                <ProjectsRow onOpen={onClose} />
              </Suspense>

              <Suspense fallback={null}>
                <TeachingRow onOpen={onClose} />
              </Suspense>
            </section>

            <section className="settings-section" data-section="instances">
              <h3>{t('settings.instances')}</h3>
              <div className="settings-row" data-setting="instance">
                <span className="settings-label">{t('inst.pick')}</span>
                <div className="seg">
                  {([1, 2] as const).map((instance) => (
                    <button
                      key={instance}
                      type="button"
                      className={store.getSnapshot().layout.activeInstance === instance ? 'active' : ''}
                      aria-pressed={store.getSnapshot().layout.activeInstance === instance}
                      data-instance={instance}
                      onClick={() => {
                        haptic();
                        store.setActiveInstance(instance);
                        bump((n) => n + 1);
                      }}
                    >
                      {instance}
                    </button>
                  ))}
                </div>
                <span className="settings-note">{t('inst.hint')}</span>
              </div>
              <div className="settings-row" data-setting="route">
                <span className="settings-label">{t('inst.route')}</span>
                <SelectTarget>
                  <select
                    aria-label={t('inst.route')}
                    value={store.getSnapshot().layout.instanceMode}
                    onChange={(event) => {
                      haptic();
                      store.setInstanceRouting({ mode: event.target.value as 'single' | 'layer' | 'split' });
                      bump((n) => n + 1);
                    }}
                  >
                    <option value="single">{t('inst.single')}</option>
                    <option value="layer">{t('inst.layer')}</option>
                    <option value="split">{t('inst.split')}</option>
                  </select>
                </SelectTarget>
                {store.getSnapshot().layout.instanceMode === 'split' ? (
                  <span className="settings-inline">
                    <span>{t('inst.splitAt')}</span>
                    <SelectTarget>
                      <select
                        aria-label={t('inst.splitAt')}
                        value={store.getSnapshot().layout.splitNote}
                        onChange={(event) => {
                          haptic();
                          store.setInstanceRouting({ splitNote: Number(event.target.value) });
                          bump((n) => n + 1);
                        }}
                      >
                        {Array.from({ length: 11 }, (_, i) => 36 + i * 4).map((note) => (
                          <option key={note} value={note}>
                            {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][note % 12]}
                            {Math.floor(note / 12) - 1}
                          </option>
                        ))}
                      </select>
                    </SelectTarget>
                  </span>
                ) : null}
              </div>
            </section>

            <section className="settings-section" data-section="performance">
              <h3>{t('settings.performance')}</h3>
              <div className="settings-row" data-setting="temperament">
                <span className="settings-label">{t('tuning.title')}</span>
                <SelectTarget>
                  <select
                    aria-label={t('tuning.title')}
                    value={store.getSnapshot().layout.temperament}
                    onChange={(event) => {
                      haptic();
                      store.setTemperament(event.target.value);
                      toast(t('tuning.changed', { name: temperamentLabel(event.target.value) }));
                    }}
                  >
                    {TEMPERAMENTS.map((temperament) => (
                      <option key={temperament.id} value={temperament.id}>
                        {temperamentLabel(temperament.id)}
                      </option>
                    ))}
                    {store.getSnapshot().layout.customTuning ? (
                      <option value="custom">{temperamentLabel('custom')}</option>
                    ) : null}
                  </select>
                </SelectTarget>
                <button type="button" className="roll-btn" onClick={() => scaleRef.current?.click()}>
                  {t('tuning.import')}
                </button>
              </div>
              <div className="settings-row" data-setting="velocity">
                <span className="settings-label">{t('velocity.title')}</span>
                <SelectTarget>
                  <select
                    aria-label={t('velocity.title')}
                    value={store.getSnapshot().layout.velocityCurve}
                    onChange={(event) => {
                      haptic();
                      store.setVelocityCurve(event.target.value);
                      toast(t('velocity.changed', { name: velocityCurveLabel(event.target.value, lang) }));
                    }}
                  >
                    {VELOCITY_CURVES.map((curve) => (
                      <option key={curve.id} value={curve.id}>
                        {velocityCurveLabel(curve.id, lang)}
                      </option>
                    ))}
                  </select>
                </SelectTarget>
              </div>
              <div className="settings-row">
                <span className="settings-label">{t('audio.title')}</span>
                <button type="button" className="roll-btn" onClick={onOpenAudio}>
                  {t('settings.openAudio')}
                </button>
              </div>
            </section>

            <section className="settings-section" data-section="appearance">
              <h3>{t('settings.appearance')}</h3>
              <div className="settings-row" data-setting="theme">
                <span className="settings-label">{t('theme.label')}</span>
                <div className="d-theme" role="group" aria-label={t('theme.label')}>
                  {(['dark', 'light', 'auto'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`d-theme-btn${theme === mode ? ' on' : ''}`}
                      aria-pressed={theme === mode}
                      title={mode === 'auto' ? t('theme.autoHint') : t(`theme.${mode}`)}
                      onClick={() => {
                        haptic();
                        store.setTheme(mode);
                      }}
                    >
                      {t(`theme.${mode}`)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="roll-btn"
                  aria-pressed={contrast}
                  onClick={() => {
                    store.toggleContrast();
                    toast(store.getSnapshot().layout.contrast ? t('drawer.contrastOn') : t('drawer.contrastOff'));
                  }}
                >
                  {t('drawer.contrast')}
                </button>
                <button
                  type="button"
                  className="roll-btn"
                  onClick={() => {
                    // Load the lazy tables first, then switch: the commit below
                    // re-renders every open panel, and none of them may paint a
                    // key name for a frame (P11.2). A failed load still switches.
                    void loadAllStrings().catch(() => {}).then(() => store.toggleLang());
                  }}
                  title={lang === 'zh' ? 'Switch to English' : '切换为中文'}
                >
                  {lang === 'zh' ? LANG_LABELS.en : LANG_LABELS.zh}
                </button>
              </div>
              <div className="settings-row">
                <span className="settings-label">{t('settings.behaviour')}</span>
                {vibrate ? (
                  <button
                    type="button"
                    className="roll-btn"
                    aria-pressed={hapticsOn}
                    onClick={() => {
                      haptic(HAPTIC.medium);
                      store.toggleHaptics();
                      toast(store.getSnapshot().layout.haptics ? t('drawer.hapticsOn') : t('drawer.hapticsOff'));
                    }}
                  >
                    {t('drawer.haptics')} {hapticsOn ? '✓' : '✕'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="roll-btn"
                  onClick={() => {
                    store.resetLayout();
                    bump((n) => n + 1);
                    toast(t('drawer.resetDone'));
                  }}
                >
                  {t('drawer.reset')}
                </button>
              </div>
            </section>

            <section className="settings-section" data-section="about">
              <h3>{t('settings.about')}</h3>
              <div className="settings-row">
                <span className="settings-label">{t('settings.docs')}</span>
                <button
                  type="button"
                  className="roll-btn"
                  onClick={() => {
                    haptic();
                    onOpenGuide();
                  }}
                  title={t('guide.sub')}
                >
                  {t('drawer.guide')}
                </button>
                <button
                  type="button"
                  className="roll-btn"
                  onClick={() => {
                    haptic();
                    onOpenChangelog();
                  }}
                  title={t('changelog.sub')}
                >
                  {t('drawer.changelog')}
                </button>
                <button
                  type="button"
                  className="roll-btn"
                  title={t('drawer.checkUpdate')}
                  onClick={async () => {
                    haptic();
                    const result = await checkForUpdate();
                    toast(
                      t(
                        result === 'updated'
                          ? 'drawer.updateFound'
                          : result === 'current'
                            ? 'drawer.updateCurrent'
                            : 'drawer.updateUnsupported',
                      ),
                    );
                  }}
                >
                  {t('drawer.checkUpdate')}
                </button>
              </div>
            </section>
          </div>
        </div>
        <input
          ref={scaleRef}
          type="file"
          accept=".scl,text/plain"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void importScale(file);
          }}
        />
      </aside>
    </>
  );
}
