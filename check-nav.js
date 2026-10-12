const fs = require('fs');
const s = fs.readFileSync('public/admin.html', 'utf8').split('\n');
s.forEach((line, i) => { if (line.includes('/superadmin')) console.log(`${i + 1}: ${line.trim().slice(0, 90)}`); });
