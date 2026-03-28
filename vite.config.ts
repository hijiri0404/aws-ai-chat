/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  test: {
    globals: true, // describe, it, expect などをグローバルで使用可能に
    environment: "jsdom", // React コンポーネントのテストのため
    // setupFiles: "./src/setupTests.ts", // テスト実行前のセットアップファイル（オプション）
  },
})
