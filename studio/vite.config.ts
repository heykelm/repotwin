import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const studioDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: studioDir,
  plugins: [react()],
  resolve: {
    alias: { '@': path.join(studioDir, 'src') }
  },
  build: {
    outDir: path.join(studioDir, '..', 'dist', 'studio'),
    emptyOutDir: true,
    sourcemap: false
  }
});
