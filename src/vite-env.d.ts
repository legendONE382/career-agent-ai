/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional: Gemini key used directly in the browser (local dev / static hosting only). */
  readonly VITE_GEMINI_API_KEY?: string;
  /** Optional: model override for direct (browser) mode. */
  readonly VITE_GEMINI_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
