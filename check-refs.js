const fs = require('fs');
const s = fs.readFileSync('server.js', 'utf8').split('\n');
s.forEach((line, i) => { if (line.includes('chatsArchive')) console.log(`${i + 1}: ${line.trim().slice(0, 70)}`); });
