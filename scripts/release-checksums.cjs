const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = process.argv[2] || 'release';
const files = fs.readdirSync(directory).filter(name => /\.(exe|dmg|zip)$/.test(name)).sort();
if (files.length !== 5) throw new Error('Expected Windows installer plus DMG and ZIP for both Mac architectures; received ' + files.length);
const lines = files.map(name => crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex') + '  ' + name);
fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log('Prepared SHA256SUMS.txt for ' + files.length + ' release files');
