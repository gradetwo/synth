/** App version, injected by Vite from package.json (falls back in tests/dev). */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
