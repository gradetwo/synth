import { useEffect, useMemo, useRef, useState } from 'react';
import { store } from '@/state/store';
import { useSynth } from '@/hooks/useSynth';
// The catalogue's *shape* only: `state/presets.ts` is fetched on open (P9.26),
// and importing the table here would pull it in with this idle-warmed chunk.
import { PRESET_CATEGORIES, type PresetCategory } from '@/state/preset-model';
import { WaveIcon } from './controls';
import { toast } from './Toast';
import { localizeName, t } from '@/i18n';
// The drawer's own copy is `drawer.*` (core) but it shares `player.*` labels
// with the player panel, so it registers that table too (P11.2).
import { loadPlayerStrings } from '@/i18n-panels';
void loadPlayerStrings();
import { haptic } from '@/hooks/useInputMode';

const SW_COLOR: Record<string, string> = {
  sine: '#4da3ff',
  triangle: '#35d0c5',
  saw: '#ffb340',
  pulse: '#f472b6',
  square: '#a78bfa',
  noise: '#f87171',
};

/** How the factory table is arriving, so the list never renders blank. */
type LibraryState = 'loading' | 'ready' | 'failed';

export function PresetDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { userPresets, currentPresetId } = useSynth();
  const [category, setCategory] = useState<PresetCategory>('ALL');
  const [query, setQuery] = useState('');
  const [library, setLibrary] = useState<LibraryState>(
    store.presetsLoaded ? 'ready' : 'loading',
  );
  const fileRef = useRef<HTMLInputElement | null>(null);

  // The factory table is a chunk of its own (P9.26) and this drawer is the one
  // place that always lists it: fetch it on the first open, not on mount, so a
  // visitor who never opens the library never downloads it.
  useEffect(() => {
    if (!open || library === 'ready') return;
    let live = true;
    store.ensurePresets().then(
      () => {
        if (live) setLibrary('ready');
      },
      () => {
        // A failed chunk is reported, not swallowed: the panel says so and
        // offers a retry instead of looking like an empty library.
        if (live) setLibrary('failed');
      },
    );
    return () => {
      live = false;
    };
  }, [open, library]);

  // `userPresets` and `library` are the change signals; `allPresets()` reads the
  // store directly and throws while the table is missing, so it is only called
  // once it is there.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => (library === 'ready' ? store.allPresets() : []), [library, userPresets]);
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
          {library === 'loading' ? (
            <div className="d-status" role="status">
              <span className="d-status-spin" aria-hidden="true" />
              {t('drawer.loading')}
            </div>
          ) : library === 'failed' ? (
            <div className="d-status" role="alert">
              {t('drawer.loadFailed')}
              <button
                type="button"
                className="d-reset"
                onClick={() => setLibrary('loading')}
              >
                {t('drawer.retry')}
              </button>
            </div>
          ) : items.length === 0 ? (
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
                const what = await store.shareOrDownload();
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
            {/* Held back until the table is there: "0 presets" while the chunk
                is in flight would read as an empty library (P9.26). */}
            {library === 'ready' ? (
              <span dangerouslySetInnerHTML={{ __html: t('drawer.footer', { n: all.length, m: userPresets.length }) }} />
            ) : null}
          </div>
          </div>
        </div>
      </aside>
    </>
  );
}
