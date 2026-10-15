const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const arch = process.argv[2] || process.arch;
const folder = process.platform === 'win32' ? 'win-unpacked' : arch === 'arm64' ? 'mac-arm64' : 'mac';
const executable = process.platform === 'win32'
  ? path.resolve('dist', folder, 'Vinyl Archive.exe')
  : path.resolve('dist', folder, 'Vinyl Archive.app', 'Contents', 'MacOS', 'Vinyl Archive');
if (!fs.existsSync(executable)) throw new Error('Packaged application missing: ' + executable);
const child = spawn(executable, ['--smoke-test'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', done = false;
function finish(code) {
  if (done) return; done = true; clearTimeout(timer);
  const match = output.match(/DESKTOP_SMOKE (\{[^\n]+\})/);
  let result; try { result = match && JSON.parse(match[1]); } catch {}
  process.exitCode = code === 0 && result?.startupComplete && result.library && result.audio && !result.nodeExposed ? 0 : 1;
  // GPU helper processes can retain inherited pipes after Electron has exited,
  // notably when testing an Intel binary through Rosetta on a hosted Mac.
  child.stdout.destroy(); child.stderr.destroy(); child.unref();
}
const timer = setTimeout(() => {
  console.error('Packaged application smoke test timed out');
  child.kill('SIGKILL'); finish(1);
}, 90000);
child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk); });
child.stderr.on('data', chunk => process.stderr.write(chunk));
child.on('error', error => { console.error(error.message); finish(1); });
child.on('exit', code => setTimeout(() => finish(code), 200));
child.on('close', finish);
