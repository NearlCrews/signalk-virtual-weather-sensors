import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const panelOutput = resolve(repositoryRoot, 'public');

function panelAssetServer(): Plugin {
  return {
    name: 'virtual-weather-sensors-panel-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        const match = /^\/panel-assets\/([a-zA-Z0-9._-]+)$/.exec(pathname);
        if (!match?.[1]) {
          next();
          return;
        }
        const assetName = match[1];
        void readFile(resolve(panelOutput, assetName))
          .then((source) => {
            response.statusCode = 200;
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader(
              'Content-Type',
              assetName.endsWith('.css')
                ? 'text/css; charset=utf-8'
                : 'text/javascript; charset=utf-8'
            );
            response.end(source);
          })
          .catch(next);
      });
    },
  };
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [panelAssetServer(), react()],
  define: { __REMOTE_URL__: JSON.stringify('/panel-assets/remoteEntry.js') },
  server: { host: '127.0.0.1', port: 4176, strictPort: true },
});
