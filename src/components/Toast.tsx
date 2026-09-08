import { useEffect, useState } from 'react';

let push: ((html: string) => void) | null = null;

/** Imperative toast helper usable from anywhere (store, drawers, …). */
export function toast(html: string) {
  push?.(html);
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
