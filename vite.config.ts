import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, type Plugin } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function apiMenuPlugin(): Plugin {
  let menuCache: string | null = null;

  const getMenuJson = () => {
    if (!menuCache) {
      try {
        const seedPath = path.resolve(__dirname, 'public/menu.seed.json');
        if (fs.existsSync(seedPath)) {
          menuCache = fs.readFileSync(seedPath, 'utf-8');
        }
      } catch (err) {
        console.warn('Failed to read seed menu:', err);
      }
    }
    return menuCache || '{}';
  };

  return {
    name: 'api-menu-mock',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];

        if (url === '/api/menu' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(getMenuJson());
          return;
        }

        if (url === '/api/admin/menu') {
          if (req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(getMenuJson());
            return;
          }
          if (req.method === 'PUT') {
            let body = '';
            req.on('data', (chunk) => {
              body += chunk;
            });
            req.on('end', () => {
              try {
                JSON.parse(body);
                menuCache = body;
                res.setHeader('Content-Type', 'application/json');
                res.end(body);
              } catch {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'bad_request', message: 'Invalid JSON' }));
              }
            });
            return;
          }
        }

        next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), apiMenuPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
