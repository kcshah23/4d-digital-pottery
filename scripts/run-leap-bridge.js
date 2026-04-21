#!/usr/bin/env node
/**
 * Starts UltraleapTrackingWebSocket if built.
 * Listens on ws://127.0.0.1:6437/v6.json for LeapJS.
 */
import { spawn } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const BUILD_DIR = join(ROOT, 'leap-bridge', 'build');

function findBinary() {
  const names = [
    'Ultraleap-Tracking-WS',
    'UltraleapTrackingWebSocket',
    'ultraleap_tracking_websocket',
    'TrackingWebSocket',
    'LeapWS',
  ];
  for (const name of names) {
    const p = join(BUILD_DIR, name);
    if (existsSync(p)) return p;
  }
  try {
    const entries = readdirSync(BUILD_DIR);
    const exe = entries.find((e) => {
      if (e.startsWith('.') || e.startsWith('CMake') || e.endsWith('.txt') ||
          e.endsWith('.cmake') || e.endsWith('.o') || e.endsWith('.a') ||
          e.endsWith('.dylib') || e.endsWith('.log') || e === 'Makefile') {
        return false;
      }
      const fp = join(BUILD_DIR, e);
      try {
        const st = statSync(fp);
        return st.isFile() && (st.mode & 0o111) !== 0;
      } catch { return false; }
    });
    if (exe) return join(BUILD_DIR, exe);
  } catch (_) {}
  return null;
}

const bin = findBinary();
if (!bin) {
  console.error('');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('[leap-bridge] NO BINARY — nothing will listen on port 6437.');
  console.error('[leap-bridge] Build once:  npm run setup-leap-bridge');
  console.error('[leap-bridge] Expected in: ', BUILD_DIR);
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('');
  process.exit(1);
}

console.log('[leap-bridge] Starting:', bin);

const child = spawn(bin, [], {
  cwd: BUILD_DIR,
  stdio: 'inherit',
  env: {
    ...process.env,
    DYLD_LIBRARY_PATH: BUILD_DIR +
      (process.env.DYLD_LIBRARY_PATH ? ':' + process.env.DYLD_LIBRARY_PATH : ''),
  },
});

child.on('error', (err) => {
  console.error('[leap-bridge] Failed to start:', err.message);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));
