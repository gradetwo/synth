import { useEffect, useState } from 'react';

/** One run of toast text, and whether the message asked for it to be bold. */
export interface ToastSegment {
  bold: boolean;
  text: string;
}

let push: ((segments: ToastSegment[]) => void) | null = null;

/**
 * Split a toast message into text segments around the `<b>` spans the messages
 * are written with.
 *
 * The messages interpolate names that come from outside the app — an imported
 * file's name, a patch name, a song title — into strings that already carry
 * `<b>` markup. Nothing here is ever injected as HTML: `ToastBody` renders each
 * segment as a text node inside (or outside) a real `<b>` element, so React
 * escapes whatever a file name carries. A file called `<img onerror=…>.wav` is
 * therefore *shown as text*, which is what the toast promises, and there is no
 * sanitizer left to get wrong — the regex this replaces stripped tags and left
 * `<script` behind whenever the input had no closing `>` (CodeQL
 * `js/incomplete-multi-character-sanitization`).
 */
export function toastSegments(html: string): ToastSegment[] {
  const segments: ToastSegment[] = [];
  let bold = false;
  for (const part of html.split(/(<\/?b>)/)) {
    if (part === '<b>') bold = true;
    else if (part === '</b>') bold = false;
    else if (part) segments.push({ bold, text: part });
  }
  return segments;
}

/** The toast's text, with `<b>` spans as elements and everything else escaped. */
export function ToastBody({ segments }: { segments: ToastSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.bold ? <b key={index}>{segment.text}</b> : segment.text,
      )}
    </>
  );
}

/** Imperative toast helper usable from anywhere (store, drawers, …). */
export function toast(html: string) {
  push?.(toastSegments(html));
}

export function ToastHost() {
  const [segments, setSegments] = useState<ToastSegment[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    push = (message: ToastSegment[]) => {
      setSegments(message);
      setVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setVisible(false), 2400);
    };
    return () => {
      push = null;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className={`toast${visible ? ' show' : ''}`} role="status">
      <ToastBody segments={segments} />
    </div>
  );
}
