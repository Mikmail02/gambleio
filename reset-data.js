/**
 * Reset server data – deletes users, sessions, plinko stats.
 * Run: node reset-data.js
 * Then start server: node server.js
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const files = ['users.json', 'sessions.json', 'plinko-stats.json'];

let deleted = 0;
for (const f of files) {
  const p = path.join(DATA_DIR, f);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    console.log('Deleted:', p);
    deleted++;
  }
}
console.log(deleted > 0 ? `\nReset complete. ${deleted} file(s) deleted. Start server with: node server.js` : 'No data files found (already reset).');
