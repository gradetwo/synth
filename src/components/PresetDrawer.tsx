import { useMemo, useRef, useState } from 'react';
import { store } from '@/state/store';
import { checkForUpdate } from '@/pwa/register';
import { TEMPERAMENTS } from '@/audio/tuning';
import { VELOCITY_CURVES, velocityCurveLabel } from '@/audio/velocity';
import { parseScala } from '@/audio/scala';
import { useSynth } from '@/hooks/useSynth';
import { PRESET_CATEGORIES, type PresetCategory } from '@/state/presets';
import { WaveIcon } from './controls';
import { toast } from './Toast';
import { LANG_LABELS, localizeName, t } from '@/i18n';
import { useLang, useHaptics, useTheme, useContrast } from '@/hooks/useSynth';
import { canVibrate, haptic, HAPTIC } from '@/hooks/useInputMode';

const SW_COLOR: Record<string, string> = {
  sine: '#4da3ff',
  triangle: '#35d0c5',
  saw: '#ffb340',
  pulse: '#f472b6',
  square: '#a78bfa',
  noise: '#f87171',
};

export function PresetDrawer({
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
  const { userPresets, currentPresetId } = useSynth();
  const lang = useLang();
  /** Temperament names are bilingual pairs; pick by the current language. */
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
      toast(t('tuning.imported', { name: scale.name, notes: String(scale.degrees.length) }));
    } catch (err) {
      toast(t('tuning.importFailed', { msg: err instanceof Error ? t(`tuning.${err.message}`) : '' }));
    }
  };
  const theme = useTheme();
  const contrast = useContrast();
  const hapticsOn = useHaptics();
  const vibrate = canVibrate();
  const [category, setCategory] = useState<PresetCategory>('ALL');
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const scaleRef = useRef<HTMLInputElement | null>(null);

  // `userPresets` is the change signal; `allPresets()` reads the store directly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => store.allPresets(), [userPresets]);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (p) =>
        (category === 'ALL' || p.cat === category) &&
        (!q || `${p.name} ${p.tag} ${p.cat}`.toLowerCase().includes(q)),
    );
  }, [all, category, query]);

  return (
    <>
      <div className={`drawer-mask${open ? ' show' : ''}`} onClick={onClose} />
      <aside className={`drawer${open ? ' open' : ''}`} aria-hidden={!open} aria-label={t('drawer.title')}>
        <div className="drawer-head">
          <span className="d-title">{t('drawer.title')}</span>
          <button type="button" className="d-close" onClick={onClose} aria-label={t('drawer.close')}>
            ✕
          </button>
        </div>
        <div className="d-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#59607a" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('drawer.search')}
            autoComplete="off"
            aria-label={t('drawer.search')}
          />
        </div>
        <div className="d-cats">
          {PRESET_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`chip${c === category ? ' active' : ''}`}
              onClick={() => {
                haptic();
                setCategory(c);
              }}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="d-list">
          {items.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--txt-dim)', padding: '30px 0', font: '500 11px var(--mono)' }}>
              NO PRESET FOUND
            </div>
          ) : (
            items.map((p) => (
              <div
                key={p.id}
                className={`pcard${p.id === currentPresetId ? ' current' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  haptic();
                  store.applyPreset(p);
                  toast(t('drawer.loaded', { name: localizeName(p.name) }));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') store.applyPreset(p);
                }}
              >
                <div className="sw" style={{ color: SW_COLOR[p.wave] ?? '#888' }}>
                  <WaveIcon wave={p.wave} />
                </div>
                <div className="pcard-body">
                  <div className="pcard-name">{localizeName(p.name)}</div>
                  <div className="pcard-meta">
                    <em>{p.tag}</em> · {p.cat}
                  </div>
                </div>
                {p.user ? (
                  <button
                    type="button"
                    className="pcard-del"
                    title={t('drawer.delete')}
                    onClick={(e) => {
                      e.stopPropagation();
                      store.deletePreset(p.id);
                      toast(t('drawer.deleted'));
                    }}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
        <div className="d-foot">
          <div className="d-foot-actions">
            <button type="button" className="d-reset" onClick={() => fileRef.current?.click()}>
              {t('drawer.import')}
            </button>
            <button
              type="button"
              className="d-reset"
              onClick={() => {
                store.exportCurrentPreset();
                toast(t('drawer.exported'));
              }}
            >
              {t('drawer.export')}
            </button>
            <button
              type="button"
              className="d-reset"
              onClick={async () => {
                const url = store.shareLink();
                try {
                  await navigator.clipboard.writeText(url);
                  toast(t('drawer.shared'));
                } catch {
                  toast(t('drawer.shareFailed'));
                }
                history.replaceState(null, '', url);
              }}
            >
              {t('drawer.share')}
            </button>
            <button
              type="button"
              className="d-reset"
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
              className="d-reset"
              onClick={() => {
                haptic();
                onOpenChangelog();
              }}
              title={t('changelog.sub')}
            >
              {t('drawer.changelog')}
            </button>
            <label className="d-temperament">
              <span>{t('tuning.title')}</span>
              <select
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
              <button
                type="button"
                className="d-reset"
                onClick={() => scaleRef.current?.click()}
                title={t('tuning.importHint')}
              >
                {t('tuning.import')}
              </button>
            </label>
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
            <button
              type="button"
              className="d-reset"
              onClick={() => {
                haptic();
                onOpenAudio();
              }}
              title={t('audio.sub')}
            >
              {t('audio.title')}
            </button>
            <label className="d-velocity">
              <span>{t('velocity.title')}</span>
              <select
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
            </label>
            <button
              type="button"
              className="d-reset"
              title={t('drawer.checkUpdate')}
              onClick={async () => {
                haptic();
                const result = await checkForUpdate();
                toast(t(result === 'updated'
                  ? 'drawer.updateFound'
                  : result === 'current'
                    ? 'drawer.updateCurrent'
                    : 'drawer.updateUnsupported'));
              }}
            >
              {t('drawer.checkUpdate')}
            </button>
            <button
              type="button"
              className="d-reset"
              onClick={() => store.toggleLang()}
              title={lang === 'zh' ? 'Switch to English' : '切换为中文'}
            >
              {lang === 'zh' ? LANG_LABELS.en : LANG_LABELS.zh}
            </button>
            <div className="d-theme" role="group" aria-label={t('theme.label')}>
              <span className="d-theme-label">{t('theme.label')}</span>
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
              className="d-reset"
              aria-pressed={contrast}
              onClick={() => {
                store.toggleContrast();
                toast(
                  store.getSnapshot().layout.contrast ? t('drawer.contrastOn') : t('drawer.contrastOff'),
                );
              }}
            >
              {t('drawer.contrast')}
            </button>
            {vibrate ? (
              <button
                type="button"
                className="d-reset"
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
              className="d-reset"
              onClick={() => {
                store.resetLayout();
                toast(t('drawer.resetDone'));
              }}
            >
              {t('drawer.reset')}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              const text = await file.text();
              toast(store.importPresetFile(text) ? t('drawer.imported') : t('drawer.importFailed'));
            }}
          />
          <div className="d-foot-count">
            <span dangerouslySetInnerHTML={{ __html: t('drawer.footer', { n: all.length, m: userPresets.length }) }} />
          </div>
        </div>
      </aside>
    </>
  );
}
