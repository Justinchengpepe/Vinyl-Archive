const { startServer } = require('../server');
const server = startServer();
server.once('listening', () => process.parentPort.postMessage({ type: 'ready', port: server.address().port }));
server.on('error', error => { console.error(error.message); process.exit(1); });
