import { useMemo, useState } from 'react';
import { store } from '@/state/store';
import { useSynth } from '@/hooks/useSynth';
import { PRESET_CATEGORIES, type PresetCategory } from '@/state/presets';
import { WaveIcon } from './controls';
import { toast } from './Toast';

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
      <aside className={`drawer${open ? ' open' : ''}`} aria-hidden={!open} aria-label="预设库">
        <div className="drawer-head">
          <span className="d-title">PRESET LIBRARY · 预设库</span>
          <button type="button" className="d-close" onClick={onClose} aria-label="关闭">
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
            placeholder="搜索音色 / 风格 / 分类…"
            autoComplete="off"
            aria-label="搜索预设"
          />
        </div>
        <div className="d-cats">
          {PRESET_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`chip${c === category ? ' active' : ''}`}
              onClick={() => setCategory(c)}
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
                  store.applyPreset(p);
                  toast(`已载入预设 <b>${p.name.split(' · ')[0]}</b>`);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') store.applyPreset(p);
                }}
              >
                <div className="sw" style={{ color: SW_COLOR[p.wave] ?? '#888' }}>
                  <WaveIcon wave={p.wave} />
                </div>
                <div className="pcard-body">
                  <div className="pcard-name">{p.name}</div>
                  <div className="pcard-meta">
                    <em>{p.tag}</em> · {p.cat}
                  </div>
                </div>
                {p.user ? (
                  <button
                    type="button"
                    className="pcard-del"
                    title="删除预设"
                    onClick={(e) => {
                      e.stopPropagation();
                      store.deletePreset(p.id);
                      toast('已删除用户预设');
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
          共 <b>{all.length}</b> 个预设 · {userPresets.length} 个本地收藏 · 点击卡片即刻载入
        </div>
      </aside>
    </>
  );
}
