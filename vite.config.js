import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const manifest = JSON.parse(readFileSync(new URL('./public/version.json', import.meta.url), 'utf8'));
if (!/^[0-9][\w.\-]*$/.test(manifest.version)) throw new Error('Invalid app version');

export default defineConfig({
  base: '/vocab-expedition-wy8/',
  define: { __APP_VERSION__: JSON.stringify(manifest.version) },
  plugins: [{
    name: 'legacy-version-bridge',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace('</head>', `<!-- Legacy update bridge: const APP_VERSION='${manifest.version}'; -->\n</head>`);
      },
    },
  }],
  build: { target: 'es2022' },
});
