/** Stroke-based transport icons shared by the player panel and the piano roll. */
export function TransportIcon({ name }: { name: 'play' | 'pause' | 'stop' | 'loop' | 'record' }) {
  const stroke = {
    viewBox: '0 0 24 24',
    width: 15,
    height: 15,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  const filled = { ...stroke, fill: 'currentColor', stroke: 'none' };
  switch (name) {
    case 'play':
      return (
        <svg {...filled}>
          <path d="M8 5.4v13.2L19 12z" />
        </svg>
      );
    case 'pause':
      return (
        <svg {...filled}>
          <rect x="7" y="5" width="3.6" height="14" rx="1.4" />
          <rect x="13.4" y="5" width="3.6" height="14" rx="1.4" />
        </svg>
      );
    case 'stop':
      return (
        <svg {...filled}>
          <rect x="6.6" y="6.6" width="10.8" height="10.8" rx="2.2" />
        </svg>
      );
    case 'record':
      return (
        <svg {...filled}>
          <circle cx="12" cy="12" r="5.8" />
        </svg>
      );
    case 'loop':
      return (
        <svg {...stroke}>
          <polyline points="17 2 21 6 17 10" />
          <path d="M3 12v-1a4 4 0 0 1 4-4h14" />
          <polyline points="7 22 3 18 7 14" />
          <path d="M21 12v1a4 4 0 0 1-4 4H3" />
        </svg>
      );
  }
}
