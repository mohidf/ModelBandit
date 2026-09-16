import { defineConfig } from 'vite';

// Served from https://mohidf.github.io/ModelRouter/ so asset URLs need the repo prefix.
export default defineConfig({
  base: '/ModelRouter/',
  server: {
    fs: { allow: ['..'] },   // the demo imports the real classifier and scoring code from ../backend
  },
});
