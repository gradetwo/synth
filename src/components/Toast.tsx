import { useEffect, useState } from 'react';

let push: ((html: string) => void) | null = null;

/**
 * Toasts interpolate names that come from outside the app — an imported file's
 * name, a patch name, a song title — into strings that already carry `<b>`
 * markup. Only that one tag is allowed through, so a file called
 * `<img onerror=…>.wav` is shown as text instead of being executed.
 */
export function sanitiseToast(html: string): string {
  return html.replace(/<(?!\/?b>)[^>]*>/g, '');
}

/** Imperative toast helper usable from anywhere (store, drawers, …). */
export function toast(html: string) {
  push?.(sanitiseToast(html));
}

export function ToastHost() {
  const [html, setHtml] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    push = (message: string) => {
      setHtml(message);
      setVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setVisible(false), 2400);
    };
    return () => {
      push = null;
      window.clearTimeout(timer);
    };
  }, []);

  return <div className={`toast${visible ? ' show' : ''}`} role="status" dangerouslySetInnerHTML={{ __html: html }} />;
}
