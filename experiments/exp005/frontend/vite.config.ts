import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 연습 앱과 같은 프록시 구조를 사용하되 기존 시제품과 포트가 겹치지 않게 합니다.
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5175, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8005' } },
  preview: { host: '127.0.0.1', port: 5175, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8005' } },
});
