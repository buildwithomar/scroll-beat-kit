// Parse-check every inline <script> block in the landing page.
// Catches a broken edit to the scroll engine before you go looking in a browser.
//
//   node _qa/syntax-check.cjs index.html
//
// Note: must stay .cjs — the project's package.json sets "type": "module",
// so a .js file here is treated as ESM and `require` throws.
const fs = require('fs');
const html = fs.readFileSync(process.argv[2] || 'index.html', 'utf8');
const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc=/.test(m[1]));
let bad = 0;
blocks.forEach((m, i) => {
  try { new Function(m[2]); }
  catch (e) { bad++; console.log('SYNTAX ERROR in inline block ' + i + ': ' + e.message); }
});
console.log(bad ? bad + ' block(s) failed' : 'all ' + blocks.length + ' inline scripts parse clean');
process.exit(bad ? 1 : 0);
