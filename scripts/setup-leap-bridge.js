#!/usr/bin/env node
/**
 * Clones and builds UltraleapTrackingWebSocket so the pottery app can connect.
 * Requirements: git, cmake, and libwebsockets (brew install libwebsockets on macOS).
 */
import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const BRIDGE_DIR = join(ROOT, 'leap-bridge');
const REPO = 'https://github.com/ultraleap/UltraleapTrackingWebSocket.git';

async function run(cmd, args, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: 'inherit', shell: false });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function main() {
  console.log('Setting up UltraleapTrackingWebSocket for Leap Motion → WebSocket bridge...\n');

  if (!existsSync(join(BRIDGE_DIR, 'CMakeLists.txt'))) {
    console.log('Cloning UltraleapTrackingWebSocket...');
    if (existsSync(BRIDGE_DIR)) {
      console.log('  (removing existing leap-bridge folder)');
      const { rmSync } = await import('fs');
      rmSync(BRIDGE_DIR, { recursive: true });
    }
    mkdirSync(BRIDGE_DIR, { recursive: true });
    await run('git', ['clone', '--depth', '1', REPO, BRIDGE_DIR]);
    console.log('Cloned.\n');
  }

  const buildDir = join(BRIDGE_DIR, 'build');
  if (!existsSync(buildDir)) mkdirSync(buildDir, { recursive: true });

  console.log('Building with CMake...');
  await run('cmake', ['..'], buildDir);
  await run('cmake', ['--build', '.'], buildDir);
  console.log('\nBuild complete. Binary is in leap-bridge/build/');
}

main().catch((e) => {
  console.error('\nSetup failed:', e.message);
  console.error('\nYou need: git, cmake, and libwebsockets.');
  console.error('  macOS: brew install cmake libwebsockets');
  console.error('  Or install UltraleapTrackingWebSocket manually: https://github.com/ultraleap/UltraleapTrackingWebSocket');
  process.exit(1);
});
