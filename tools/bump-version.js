// Stamps a fresh ?v= cache-busting tag onto the CSS/JS links in index.html,
// so browsers load new files right after a deploy instead of a cached copy.
// Run before committing changes to css/ or js/: node tools/bump-version.js
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'index.html');
const version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12); // YYYYMMDDHHMM (UTC)

const html = fs.readFileSync(file, 'utf8');
const out = html.replace(/((?:href|src)="(?:css|js)\/[\w-]+\.(?:css|js))(?:\?v=\w+)?"/g, `$1?v=${version}"`);
fs.writeFileSync(file, out);
console.log('index.html assets tagged v=' + version);
