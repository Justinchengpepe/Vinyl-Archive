const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const arch = process.argv[2] || process.arch;
const folder = process.platform === 'win32' ? 'win-unpacked' : arch === 'arm64' ? 'mac-arm64' : 'mac';
const executable = process.platform === 'win32'
  ? path.resolve('dist', folder, 'Vinyl Archive.exe')
  : path.resolve('dist', folder, 'Vinyl Archive.app', 'Contents', 'MacOS', 'Vinyl Archive');
if (!fs.existsSync(executable)) throw new Error('Packaged application missing: ' + executable);
const args = ['--smoke-test'];
const child = spawn(executable, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', done = false;
const timer = setTimeout(() => { child.kill(); console.error('Packaged application smoke test timed out'); process.exitCode = 1; }, 90000);
child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk); });
child.stderr.on('data', chunk => process.stderr.write(chunk));
child.on('error', error => { clearTimeout(timer); console.error(error.message); process.exitCode = 1; });
child.on('close', code => {
  if (done) return; done = true; clearTimeout(timer);
  const match = output.match(/DESKTOP_SMOKE (\{[^\n]+\})/);
  let result; try { result = match && JSON.parse(match[1]); } catch {}
  if (code !== 0 || !result?.startupComplete || !result.library || !result.audio || result.nodeExposed) process.exitCode = 1;
});
