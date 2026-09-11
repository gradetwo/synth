import { useMemo, useRef, useState } from 'react';
import { store } from '@/state/store';
import { useSynth } from '@/hooks/useSynth';
import { PRESET_CATEGORIES, type PresetCategory } from '@/state/presets';
import { WaveIcon } from './controls';
import { toast } from './Toast';
import { localizeName, t } from '@/i18n';
import { haptic } from '@/hooks/useInputMode';

const SW_COLOR: Record<string, string> = {
  sine: '#4da3ff',
  triangle: '#35d0c5',
  saw: '#ffb340',
  pulse: '#f472b6',
  square: '#a78bfa',
  noise: '#f87171',
};

export function PresetDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { userPresets, currentPresetId } = useSynth();
  const [category, setCategory] = useState<PresetCategory>('ALL');
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

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
      <aside className={`drawer preset-drawer${open ? ' open' : ''}`} aria-hidden={!open} aria-label={t('drawer.title')}>
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
        {/* The settings live *inside* the scroller with the list. Pinned to the
            bottom they took a fixed slice of the drawer no matter how many
            presets there were to look at. */}
        <div className="d-body">
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
          <div className="d-foot-actions preset-actions">
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
                // With an arrangement loaded the code carries the song too; if
                // that makes the link too long for a chat client, the same
                // payload goes out as a `.gs1song` file instead.
                const what = store.shareOrDownload();
                if (what === 'file') {
                  toast(t('drawer.shareFile'));
                  return;
                }
                try {
                  await navigator.clipboard.writeText(store.shareLink());
                  toast(t('drawer.shared'));
                } catch {
                  toast(t('drawer.shareFailed'));
                }
              }}
            >
              {t('drawer.share')}
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
        </div>
      </aside>
    </>
  );
}
