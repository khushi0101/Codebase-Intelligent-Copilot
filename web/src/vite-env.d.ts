/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to "1" for the hosted (Cloudflare Pages) build. */
  readonly VITE_HOSTED?: string;
}
