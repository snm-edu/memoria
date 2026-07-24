/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_GAS_API_URL: string;
  readonly VITE_APP_NAME: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Drive動画の直ストリーミング用APIキー（リファラ制限付き・未設定ならDrive埋め込みへフォールバック） */
  readonly VITE_DRIVE_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
