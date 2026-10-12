const fs = require('fs');
let s = fs.readFileSync('server.js', 'utf8');
// include uid in the presence list (needed for per-user timeouts in privateadmin)
s = s.replace(
  "for (const [, u] of presence[room] || []) list.push({ name: u.name, admin: !!u.admin, since: u.since });",
  "for (const [, u] of presence[room] || []) list.push({ name: u.name, uid: u.uid, admin: !!u.admin, since: u.since });"
);
fs.writeFileSync('server.js', s);
console.log('uid in presence list:', s.includes('name: u.name, uid: u.uid') ? 'YES' : 'NO');
