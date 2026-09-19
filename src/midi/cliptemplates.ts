/**
 * Clip templates (P10.2).
 *
 * A clip is a *figure* — a bar of notes, a window that repeats it. This is the
 * figure with the timeline taken off: the notes, named, so the same material can
 * be laid down on any layer as a fresh clip.
 *
 * Storage follows the P7.3 effect-graph templates, and for the same reason: a
 * template is a piece of the player's *workspace*, not of a song. It lives in
 * `LayoutState.clipTemplates` (under `gs1:layout:v1`) and therefore never rides
 * along in a share code, a preset or an exported MIDI file. That is the right
 * side of the line here too — a clip belongs to one song's arrangement, and a
 * share code is a format the player, the recorder and the SMF writer all speak;
 * teaching it a per-song template list would be a format change for a workspace
 * convenience. (Unlike a *take*, a template is not a performance the user would
 * lose by importing someone else's song either: it is a reusable figure.)
 *
 * Applying one never shares state: the template holds its own note array, and
 * the clip it creates is built through `clipFromNotes`, which copies every note.
 * Editing the applied clip cannot reach back into the template, and editing
 * another clip made from the same template cannot reach into this one.
 */

import { clipFromNotes, copyClipNotes, type MidiClip } from './clips';
import type { MidiNote } from './smf';

export interface ClipTemplate {
  id: string;
  /** Shown in the picker; the user can name it anything short. */
  name: string;
  /** The figure, in the clip's own frame (starts relative to the window). */
  notes: MidiNote[];
}

/** Where a template came from, for the save button's default name. */
export function clipTemplateFromClip(clip: MidiClip, id: string, name?: string): ClipTemplate {
  return {
    id,
    name: name?.trim().slice(0, 60) || clip.name.slice(0, 60) || 'Clip',
    notes: copyClipNotes(clip.notes),
  };
}

/**
 * Accept stored templates without trusting them: an entry without an id or a
 * name is dropped, its notes are repaired exactly the way clip notes are, and
 * the same id twice is refused rather than silently shadowed.
 */
export function normalizeClipTemplates(raw: unknown): ClipTemplate[] {
  if (!Array.isArray(raw)) return [];
  const out: ClipTemplate[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, name, notes } = entry as Partial<ClipTemplate>;
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) continue;
    if (typeof name !== 'string') continue;
    if (out.some((template) => template.id === id)) continue;
    // An empty figure is not a template: applying it would add a silent clip.
    const clean = copyClipNotes(Array.isArray(notes) ? notes : []);
    if (clean.length === 0) continue;
    out.push({ id, name: name.trim().slice(0, 60) || 'Clip', notes: clean });
  }
  return out;
}

export function findClipTemplate(templates: ClipTemplate[], id: string): ClipTemplate | null {
  return templates.find((template) => template.id === id) ?? null;
}

/**
 * Build a new clip from a template, on any layer.
 *
 * This is `clipFromNotes` with the template's notes, so an applied template and
 * a cross-layer copy produce the same shape from the same figure — and the new
 * clip owns every one of its notes.
 */
export function clipFromTemplate(
  template: ClipTemplate,
  options: { layer?: number; name?: string; start?: number; length?: number; repeat?: number; bpm?: number } = {},
): MidiClip {
  return clipFromNotes(template.notes, {
    layer: options.layer,
    name: options.name ?? template.name,
    start: options.start,
    // Left to `clipFromNotes` unless asked: the window is derived from the
    // content, so a template dropped on a slower layer still contains it.
    length: options.length,
    repeat: options.repeat,
    bpm: options.bpm,
  });
}
