const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../scripts/smoke-package.cjs');
test('packaged smoke verification completes even if a helper retains stdout', { skip: process.platform === 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vinyl-smoke-pipes-'));
  const bin = path.join(root, 'dist/mac/Vinyl Archive.app/Contents/MacOS/Vinyl Archive');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  const pidFile = path.join(root, 'helper.pid');
  const result = { startupComplete: true, library: true, audio: true, nodeExposed: false };
  fs.writeFileSync(bin, '#!/usr/bin/env node\n' + `const fs=require('fs'),{spawn}=require('child_process');const p=spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{stdio:['ignore',1,2]});fs.writeFileSync(${JSON.stringify(pidFile)},String(p.pid));console.log('DESKTOP_SMOKE '+${JSON.stringify(JSON.stringify(result))});process.exit(0);`);
  fs.chmodSync(bin, 0o755);
  t.after(() => { if (fs.existsSync(pidFile)) { try { process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 'SIGKILL'); } catch {} } fs.rmSync(root, { recursive: true, force: true }); });
  const run = spawnSync(process.execPath, [script, 'x64'], { cwd: root, encoding: 'utf8', timeout: 4000 });
  assert.equal(run.error, undefined); assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /DESKTOP_SMOKE/);
});
