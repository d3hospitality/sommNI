// The wineLENS backend's glasses bottles (site/public/g2/bottles), served to a test page so browser
// tests never reach the real backend. `down: true` simulates an outage (connection refused).
const fs = require('node:fs');
const path = require('node:path');
const DIR = path.resolve(__dirname, '../site/public/g2/bottles');

async function serveG2Bottles(target, { down = false } = {}) {
  const requests = [];
  await target.route('**/g2/bottles/**', route => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
    requests.push(name);
    if (down) return route.abort('connectionrefused');
    const file = path.join(DIR, name);
    if (!/^[\w.-]+\.(png|json)$/.test(name) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': name.endsWith('.json') ? 'application/json' : 'image/png' }, body: fs.readFileSync(file) });
  });
  return requests;
}
module.exports = { serveG2Bottles, G2_DIR: DIR };
