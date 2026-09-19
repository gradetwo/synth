/**
 * Project manager (P10.4).
 *
 * The panel is a lazy chunk: it is the one place that opens a project, restores
 * a snapshot or imports a `.gs1proj`, and none of that copy or code has any
 * business in the first screen. Its string table is registered by the drop-in
 * import below, so the first frame it paints already has both languages (the
 * idle preload in `i18n.ts` normally beats it anyway).
 *
 * Everything the panel does goes through `state/projects.ts`, which owns the
 * list, the quota rules and the refusal reasons; the panel's only job is to turn
 * a reason into copy a player can act on. Two families are named dynamically —
 * `project.bad.*` for a file that cannot be read and `project.fail.*` for an
 * operation storage refused — and `projects.test.ts` checks that every reason
 * the model can return has a key here.
 */

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getLang, t } from '@/i18n';
import { toast } from './Toast';
// Registers the panel's copy as part of loading this chunk (P11.2), the same
// pattern the preset drawer uses for the player strings.
import { loadProjectStrings } from '@/i18n-panels';
void loadProjectStrings();
import { downloadText } from '@/state/share';
import { PROJECT_EXTENSION, projectManager, type ProjectSummary } from '@/state/projects';
import { haptic } from '@/hooks/useInputMode';
import './projects.css';

/** A download name that survives every filesystem in the way. */
function fileName(name: string): string {
  return (name.split(' · ')[0] || 'gs1-project').replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
}

function when(ms: number, lang: string): string {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function ProjectPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Bumped after every mutation so the list re-reads the manager.
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);
  const [editing, setEditing] = useState<{ id: string; kind: 'name' | 'tags' } | null>(null);
  const [draft, setDraft] = useState('');
  const [snapshotName, setSnapshotName] = useState('');
  /** A storage condition worth keeping on screen: a full disk or a read-only list. */
  const [warning, setWarning] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const lang = getLang();

  const projects = projectManager.list();
  const active = projects.find((project) => project.active) ?? null;

  /** Say why something was refused: a toast always, a banner when it persists. */
  const fail = (reason: string, family: 'fail' | 'bad' = 'fail') => {
    const message = t(`project.${family}.${reason}`);
    if (family === 'fail' && (reason === 'quota' || reason === 'readonly' || reason === 'unavailable')) {
      setWarning(message);
    }
    toast(message);
  };

  const create = () => {
    const name = t('project.defaultName', { n: projects.length + 1 });
    const result = projectManager.create(name);
    if (!result.ok) return fail(result.reason);
    setWarning(null);
    toast(t('project.created', { name }));
    refresh();
  };

  const switchTo = (project: ProjectSummary) => {
    const result = projectManager.switchTo(project.id);
    if (!result.ok) {
      fail(result.reason);
      refresh();
      return;
    }
    if (result.degraded) {
      setWarning(t('project.switchDegraded'));
      toast(t('project.switchDegraded'));
    } else {
      setWarning(null);
      toast(t('project.switched', { name: project.name }));
    }
    refresh();
  };

  const commitEdit = () => {
    if (!editing) return;
    const { id, kind } = editing;
    setEditing(null);
    const result = kind === 'name' ? projectManager.rename(id, draft) : projectManager.setTags(id, draft.split(','));
    if (!result.ok) return fail(result.reason);
    if (kind === 'name') toast(t('project.renamed'));
    refresh();
  };

  const duplicate = (project: ProjectSummary) => {
    const result = projectManager.duplicate(project.id);
    if (!result.ok) return fail(result.reason);
    toast(t('project.duplicated'));
    refresh();
  };

  const remove = (project: ProjectSummary) => {
    const result = projectManager.remove(project.id);
    if (!result.ok) return fail(result.reason);
    toast(t('project.deleted'));
    refresh();
  };

  const exportOne = (project: ProjectSummary) => {
    const text = projectManager.exportText(project.id);
    if (!text) return fail('damaged');
    downloadText(`${fileName(project.name)}${PROJECT_EXTENSION}`, text);
    toast(t('project.exported', { name: project.name }));
  };

  const importFile = async (file: File) => {
    const name = file.name.replace(/\.[^.]+$/, '') || t('project.title');
    const result = projectManager.importText(await file.text(), name);
    if (!result.ok) return fail(result.reason, 'bad');
    setWarning(result.degraded ? t('project.switchDegraded') : null);
    toast(t('project.imported', { name }));
    refresh();
  };

  const saveSnapshot = () => {
    if (!active) return;
    const name = snapshotName.trim() || `${t('project.snapshot')} ${active.snapshots.length + 1}`;
    const result = projectManager.saveSnapshot(active.id, name);
    setSnapshotName('');
    if (!result.ok) return fail(result.reason);
    toast(t('project.snapshotSaved', { name }));
    refresh();
  };

  const restoreSnapshot = (snapshotId: string) => {
    if (!active) return;
    const result = projectManager.restoreSnapshot(active.id, snapshotId);
    if (!result.ok) return fail(result.reason);
    if (result.degraded) {
      setWarning(t('project.switchDegraded'));
      toast(t('project.switchDegraded'));
    } else {
      toast(t('project.snapshotRestored'));
    }
    refresh();
  };

  const deleteSnapshot = (snapshotId: string) => {
    if (!active) return;
    const result = projectManager.deleteSnapshot(active.id, snapshotId);
    if (!result.ok) return fail(result.reason);
    refresh();
  };

  return (
    <>
      <div className={`drawer-mask${open ? ' show' : ''}`} onClick={onClose} />
      <aside
        className={`drawer project-drawer${open ? ' open' : ''}`}
        aria-hidden={!open}
        aria-label={t('project.title')}
      >
        <div className="drawer-head">
          <span className="d-title">{t('project.title')}</span>
          <button type="button" className="d-close" onClick={onClose} aria-label={t('drawer.close')}>
            ✕
          </button>
        </div>
        <div className="d-body">
          <div className="project-body">
            {warning ? (
              <div className="project-warn" role="alert" data-role="project-warning">
                {warning}
              </div>
            ) : null}

            <div className="project-actions">
              <button type="button" className="roll-btn" data-act="project-new" onClick={create}>
                {t('project.new')}
              </button>
              <button
                type="button"
                className="roll-btn"
                data-act="project-import"
                onClick={() => fileRef.current?.click()}
              >
                {t('project.import')}
              </button>
              {active ? (
                <button
                  type="button"
                  className="roll-btn"
                  data-act="project-export"
                  onClick={() => exportOne(active)}
                >
                  {t('project.export')}
                </button>
              ) : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={`.gs1proj,application/json`}
              hidden
              data-role="project-file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void importFile(file);
              }}
            />
            <p className="project-hint">{t('project.hint')}</p>

            {projects.length === 0 ? (
              <div className="project-empty" data-role="project-empty">
                {t('project.empty')}
              </div>
            ) : null}

            <div className="project-list">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className={`project-row${project.active ? ' active' : ''}${project.damaged ? ' damaged' : ''}`}
                  data-project={project.id}
                  data-active={project.active ? '1' : undefined}
                >
                  <div className="project-head">
                    {editing?.id === project.id && editing.kind === 'name' ? (
                      <input
                        className="project-input"
                        data-role="project-name-input"
                        value={draft}
                        autoFocus
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitEdit();
                          if (event.key === 'Escape') setEditing(null);
                        }}
                      />
                    ) : (
                      <span className="project-name" data-role="project-name">
                        {project.name}
                      </span>
                    )}
                    {project.active ? <span className="project-flag">{t('project.active')}</span> : null}
                    {project.damaged ? (
                      <span className="project-flag bad">{t('project.damaged')}</span>
                    ) : null}
                    <span className="project-meta">{when(project.updatedAt, lang)}</span>
                  </div>

                  {editing?.id === project.id && editing.kind === 'tags' ? (
                    <input
                      className="project-input"
                      data-role="project-tags-input"
                      value={draft}
                      autoFocus
                      placeholder={t('project.tagsHint')}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitEdit();
                        if (event.key === 'Escape') setEditing(null);
                      }}
                    />
                  ) : project.tags.length ? (
                    <div className="project-chips">
                      {project.tags.map((tag) => (
                        <span className="project-chip" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="project-row-actions">
                    {!project.active && !project.damaged ? (
                      <button
                        type="button"
                        className="roll-btn"
                        data-act="project-switch"
                        onClick={() => switchTo(project)}
                      >
                        {t('project.switch')}
                      </button>
                    ) : null}
                    {editing?.id === project.id ? (
                      <>
                        <button type="button" className="roll-btn" data-act="project-save" onClick={commitEdit}>
                          {t('project.save')}
                        </button>
                        <button
                          type="button"
                          className="roll-btn"
                          data-act="project-cancel"
                          onClick={() => setEditing(null)}
                        >
                          {t('project.cancel')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="roll-btn"
                          data-act="project-rename"
                          onClick={() => {
                            setEditing({ id: project.id, kind: 'name' });
                            setDraft(project.name);
                          }}
                        >
                          {t('project.rename')}
                        </button>
                        <button
                          type="button"
                          className="roll-btn"
                          data-act="project-tags"
                          onClick={() => {
                            setEditing({ id: project.id, kind: 'tags' });
                            setDraft(project.tags.join(', '));
                          }}
                        >
                          {t('project.tags')}
                        </button>
                        <button
                          type="button"
                          className="roll-btn"
                          data-act="project-duplicate"
                          onClick={() => duplicate(project)}
                        >
                          {t('project.duplicate')}
                        </button>
                        <button
                          type="button"
                          className="roll-btn"
                          data-act="project-export-row"
                          disabled={project.damaged}
                          onClick={() => exportOne(project)}
                        >
                          {t('project.export')}
                        </button>
                        <button
                          type="button"
                          className="roll-btn"
                          data-act="project-delete"
                          disabled={project.active}
                          onClick={() => remove(project)}
                        >
                          {t('project.delete')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {active ? (
              <section className="project-snaps" data-role="project-snapshots">
                <div className="project-head">
                  <span className="project-name">{t('project.snapshot')}</span>
                </div>
                <p className="project-hint">{t('project.snapshotHint')}</p>
                <div className="project-actions">
                  <input
                    className="project-input"
                    data-role="project-snapshot-name"
                    value={snapshotName}
                    placeholder={t('project.snapshotName')}
                    onChange={(event) => setSnapshotName(event.target.value)}
                  />
                  <button
                    type="button"
                    className="roll-btn"
                    data-act="project-snapshot-save"
                    onClick={saveSnapshot}
                  >
                    {t('project.snapshotSave')}
                  </button>
                </div>
                {active.snapshots.length === 0 ? (
                  <div className="project-empty">{t('project.snapshotNone')}</div>
                ) : (
                  active.snapshots.map((snapshot) => (
                    <div className="project-snap" key={snapshot.id} data-snapshot={snapshot.id}>
                      <span className="project-name">{snapshot.name}</span>
                      <span className="project-meta">{when(snapshot.createdAt, lang)}</span>
                      <span className="project-row-actions">
                        <button
                          type="button"
                          className="roll-btn"
                          data-act="snapshot-restore"
                          onClick={() => restoreSnapshot(snapshot.id)}
                        >
                          {t('project.snapshotRestore')}
                        </button>
                        <button
                          type="button"
                          className="roll-btn"
                          data-act="snapshot-delete"
                          onClick={() => deleteSnapshot(snapshot.id)}
                        >
                          {t('project.snapshotDelete')}
                        </button>
                      </span>
                    </div>
                  ))
                )}
              </section>
            ) : null}
          </div>
        </div>
      </aside>
    </>
  );
}

/**
 * The settings-drawer row that opens the panel (P10.4).
 *
 * This default export is the chunk's whole entry point: the settings drawer
 * knows only "there is a row here", through one `lazy()`, so neither the row's
 * copy nor the panel's code is in the entry bundle.
 *
 * The panel is rendered through a *portal* rather than in place. The settings
 * drawer is a transformed, off-canvas `position: fixed` element, and a fixed
 * descendant of it would be positioned relative to that drawer — off-screen the
 * moment the drawer slides away, which is exactly what happens when this row
 * opens the panel.
 */
export default function ProjectsRow({ onOpen }: { onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="settings-row" data-setting="projects">
        <span className="settings-label">{t('project.title')}</span>
        <button
          type="button"
          className="roll-btn"
          data-act="projects-open"
          onClick={() => {
            haptic();
            // The two drawers must not stack: close the settings one first.
            onOpen();
            setOpen(true);
          }}
        >
          {t('project.open')}
        </button>
      </div>
      {open ? createPortal(<ProjectPanel open onClose={() => setOpen(false)} />, document.body) : null}
    </>
  );
}
