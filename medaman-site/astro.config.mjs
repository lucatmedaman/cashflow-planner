// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// TEST-opzet: `site` wijst naar een tijdelijke preview-URL, nooit naar medaman.be.
// Pas dit aan naar de URL die Netlify/Cloudflare Pages toekent.
export default defineConfig({
  site: 'https://medaman-preview.netlify.app',
  integrations: [sitemap()],
  build: { format: 'directory' },
  compressHTML: true,
});
