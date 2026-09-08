import { useEffect, useState, type ReactNode } from 'react';
import { getLang, t } from '@/i18n';
import { GUIDE_SECTIONS, type Bi, type Block } from '@/guide/content';

const pick = (b: Bi): string => (getLang() === 'zh' ? b[0] : b[1]);

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

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'h':
      return <h3 className="guide-h">{pick(block.text)}</h3>;
    case 'p':
      return (
        <p className="guide-p">
          <Inline text={pick(block.text)} />
        </p>
      );
    case 'tip':
      return (
        <p className="guide-tip">
          <Inline text={pick(block.text)} />
        </p>
      );
    case 'ul':
      return (
        <ul className="guide-ul">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline text={pick(item)} />
            </li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol className="guide-ol">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline text={pick(item)} />
            </li>
          ))}
        </ol>
      );
    case 'table':
      return (
        <div className="guide-table-wrap">
          <table className="guide-table">
            <thead>
              <tr>
                {block.head.map((cell, i) => (
                  <th key={i}>{pick(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>
                      <Inline text={pick(cell)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'steps':
      return (
        <div className="guide-steps">
          {block.items.map((step, i) => (
            <div className="guide-step" key={i}>
              <div className="guide-step-n">{i + 1}</div>
              <div>
                <div className="guide-step-t">{pick(step.title)}</div>
                <div className="guide-step-b">
                  <Inline text={pick(step.body)} />
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}

/**
 * Full-screen manual. Opened from the preset drawer next to the language
 * switcher; entirely offline.
 */
export function Guide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [active, setActive] = useState(GUIDE_SECTIONS[0].id);
  const lang = getLang();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const section = GUIDE_SECTIONS.find((s) => s.id === active) ?? GUIDE_SECTIONS[0];

  return (
    <>
      <div className={`guide-mask${open ? ' show' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside
        className={`guide${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('guide.title')}
        aria-hidden={!open}
      >
        <header className="guide-head">
          <span className="guide-mark" aria-hidden="true">
            ?
          </span>
          <div className="guide-head-text">
            <span className="guide-title">{t('guide.title')}</span>
            <span className="guide-sub">{t('guide.sub')}</span>
          </div>
          <button type="button" className="d-close" onClick={onClose} aria-label={t('drawer.close')}>
            ✕
          </button>
        </header>

        <div className="guide-body">
          <nav className="guide-nav" aria-label={t('guide.toc')}>
            {GUIDE_SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`guide-tab${s.id === active ? ' active' : ''}`}
                aria-pressed={s.id === active}
                onClick={() => setActive(s.id)}
              >
                {pick(s.title)}
              </button>
            ))}
          </nav>

          <article className="guide-content" key={`${section.id}-${lang}`}>
            <h2 className="guide-title-main">{pick(section.title)}</h2>
            <p className="guide-intro">{pick(section.intro)}</p>
            {section.blocks.map((block, i) => (
              <BlockView key={i} block={block} />
            ))}
            <footer className="guide-foot">{t('guide.footer')}</footer>
          </article>
        </div>
      </aside>
    </>
  );
}
