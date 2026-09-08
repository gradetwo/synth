import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { store } from '@/state/store';
import { useCollapsed } from '@/hooks/useSynth';
import { MODULE_META, type ModuleId } from '@/state/layout';
import { ParamLed } from './controls';

/**
 * Drag-to-reorder container.
 *
 * Pointer-based so it works identically with a mouse, a pen and a finger. The
 * module order lives in the store and is persisted; the grid simply re-renders
 * in the new order while the drag is in flight.
 */
const DragContext = createContext<(id: ModuleId) => void>(() => undefined);

export function ModulesGrid({ children }: { children: ReactNode }) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<ModuleId | null>(null);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const grid = gridRef.current;
      if (!grid) return;
      const modules = Array.from(grid.querySelectorAll<HTMLElement>('[data-module-id]'));
      const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
      const pad = 14;
      for (const el of modules) {
        const id = el.dataset.moduleId as ModuleId;
        if (id === dragging) continue;
        const rect = el.getBoundingClientRect();
        if (
          event.clientX >= rect.left - pad &&
          event.clientX <= rect.right + pad &&
          event.clientY >= rect.top - pad &&
          event.clientY <= rect.bottom + pad
        ) {
          // Insert before or after depending on which half of the target the
          // pointer is in (horizontal in a grid, vertical in one column).
          const before =
            columns > 1
              ? event.clientX < rect.left + rect.width / 2
              : event.clientY < rect.top + rect.height / 2;
          if (before) store.moveModuleBefore(dragging, id);
          else store.moveModuleAfter(dragging, id);
          break;
        }
      }
    };
    const onEnd = () => setDragging(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
  }, [dragging]);

  useEffect(() => {
    document.body.classList.toggle('module-dragging', dragging !== null);
    return () => document.body.classList.remove('module-dragging');
  }, [dragging]);

  return (
    <DragContext.Provider value={setDragging}>
      <div className={`modules-grid${dragging ? ' is-dragging' : ''}`} ref={gridRef}>
        {children}
      </div>
    </DragContext.Provider>
  );
}

/** Standard module chrome: screws, header, collapse toggle and drag grip. */
export function ModuleShell({
  id,
  children,
  className,
}: {
  id: ModuleId;
  children: ReactNode;
  className?: string;
}) {
  const collapsed = useCollapsed(id);
  const meta = MODULE_META[id];
  const startDrag = useContext(DragContext);

  return (
    <section
      className={`module${collapsed ? ' collapsed' : ''}${className ? ` ${className}` : ''}`}
      data-module-id={id}
      style={{ ['--mc' as string]: meta.color, ['--span' as string]: String(meta.span) }}
    >
      <span className="screw tl" />
      <span className="screw tr" />
      <span className="screw bl" />
      <span className="screw br" />

      <div className="module-head">
        <span className="bar" />
        <span className="title">{meta.title}</span>
        <span className="sub">{meta.sub}</span>
        <span className="spacer" />
        {meta.ledId !== undefined ? <ParamLed id={meta.ledId} label={`${meta.title} 开关`} /> : null}
        <button
          type="button"
          className="module-grip"
          title="拖动排序"
          aria-label={`拖动 ${meta.title} 排序`}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            startDrag(id);
          }}
        >
          <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
            <circle cx="2.5" cy="3" r="1.2" fill="currentColor" />
            <circle cx="7.5" cy="3" r="1.2" fill="currentColor" />
            <circle cx="2.5" cy="7" r="1.2" fill="currentColor" />
            <circle cx="7.5" cy="7" r="1.2" fill="currentColor" />
            <circle cx="2.5" cy="11" r="1.2" fill="currentColor" />
            <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className="module-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `${meta.title} 展开` : `${meta.title} 收起`}
          title={collapsed ? '展开' : '收起'}
          onClick={() => store.toggleCollapsed(id)}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d={collapsed ? 'M3 1.5 L7.5 5 L3 8.5' : 'M1.5 3 L5 7.5 L8.5 3'}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {!collapsed ? <div className="module-body">{children}</div> : null}
    </section>
  );
}
