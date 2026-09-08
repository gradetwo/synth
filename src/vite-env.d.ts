/// <reference types="vite/client" />

/** Injected by Vite from package.json. */
declare const __APP_VERSION__: string;

declare module '*?url' {
  const src: string;
  export default src;
}

declare module '*.wasm?url' {
  const src: string;
  export default src;
}
