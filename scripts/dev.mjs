// `npm run dev`: the app with hot reload (Vite, http://localhost:5173) and the
// API in the Workers runtime (Wrangler, port 8787), which Vite forwards /api/*
// to. Both read .env.local. The local D1 cache lives in .wrangler/.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const run = (args) => spawn('npx', args, { stdio: 'inherit' });

// Wrangler serves dist/ too, so it has to exist before the first build.
mkdirSync('dist', { recursive: true });

run(['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local']).on('exit', (code) => {
  if (code) process.exit(code);
  const children = [run(['wrangler', 'dev', '--port', '8787']), run(['vite'])];
  // When either stops (or Ctrl+C), stop both.
  const stop = () => children.forEach((child) => child.kill());
  children.forEach((child) => child.on('exit', () => {
    stop();
    process.exit();
  }));
  process.on('SIGINT', stop);
});
