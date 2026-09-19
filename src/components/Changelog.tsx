import { useEffect, type ReactNode } from 'react';
import { getLang, t } from '@/i18n';
// Register this dialog's copy at module scope (P11.2); see `i18n.ts`.
import { loadDocsStrings } from '@/i18n-panels';
void loadDocsStrings();
import { CHANGELOG, CURRENT_VERSION, releaseDateLabel, type Release } from '@/changelog';

const pick = (b: [string, string]): string => (getLang() === 'zh' ? b[0] : b[1]);

/** Minimal inline markup: `**bold**` and `` `code` ``. */
function Inline({ text }: { text: string }): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) return <b key={i}>{part.slice(2, -2)}</b>;
        if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

const KIND_LABELS: Record<Release['kind'], [string, string]> = {
  sound: ['音质', 'Sound'],
  feature: ['新功能', 'Feature'],
  fix: ['修复', 'Fix'],
};

/**
 * Release notes. Opened from the preset drawer next to the guide; the version
 * this build reports is highlighted so "what changed since I last updated" is
 * answerable offline.
 */
export function Changelog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const lang = getLang();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div className={`guide-mask${open ? ' show' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside
        className={`guide changelog${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('changelog.title')}
        aria-hidden={!open}
      >
        <header className="guide-head">
          <span className="guide-mark" aria-hidden="true">
            ★
          </span>
          <div className="guide-head-text">
            <span className="guide-title">{t('changelog.title')}</span>
            <span className="guide-sub">
              {t('changelog.sub')} · <b>v{CURRENT_VERSION}</b>
            </span>
          </div>
          <button type="button" className="d-close" onClick={onClose} aria-label={t('drawer.close')}>
            ✕
          </button>
        </header>

        <div className="guide-body">
          <article className="changelog-list" key={lang}>
            {CHANGELOG.map((release) => {
              const current = release.version === CURRENT_VERSION;
              return (
                <section
                  key={release.version}
                  className={`release${current ? ' current' : ''}`}
                  data-version={release.version}
                >
                  <div className="release-head">
                    <span className="release-version">v{release.version}</span>
                    {current ? (
                      <span className="release-badge">{t('changelog.current')}</span>
                    ) : null}
                    <span className={`release-kind ${release.kind}`}>
                      {pick(KIND_LABELS[release.kind])}
                    </span>
                    <span className="release-date">{releaseDateLabel(release.date, lang)}</span>
                  </div>
                  <ul className="guide-ul">
                    {release.items.map((item, i) => (
                      <li key={i}>
                        <Inline text={pick(item)} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            {/* P141: the shipped list is capped, so say where the rest lives
                instead of leaving a list that silently stops in 1.8.x. */}
            <p className="release-archive-note">{t('changelog.archive')}</p>
            <footer className="guide-foot">{t('changelog.footer')}</footer>
          </article>
        </div>
      </aside>
    </>
  );
}
