// bundle — one self-contained HTML file from a deck and its local files.
//
//   node scripts/bundle.cjs gallery.html --out ~/somewhere/gallery.html
//   node scripts/bundle.cjs my-deck/index.html --brand my-deck/brand.css --out dist/index.html
//
// Inlines every LOCAL <link rel="stylesheet"> and <script src> (the engine,
// its CSS, the brand file) so the page works from a single URL — a publish
// link, a CMS block, an email preview. Remote URLs are left alone.
//
// --brand swaps the file the deck links as id="brand" for another brand file
// before inlining it. A brand's url() references (its downloaded fonts) are
// resolved relative to the BRAND file and inlined as data: URIs, so they
// survive the move; anything over 2 MB is left as a path with a warning.
// Brand fonts are licensed to the brand: bundle them only into that brand's
// own deck.
'use strict';
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const src = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--out' && argv[argv.indexOf(a) - 1] !== '--brand');
const out = argv[argv.indexOf('--out') + 1];
const brand = argv.includes('--brand') ? argv[argv.indexOf('--brand') + 1] : null;
if (!src || !argv.includes('--out')) { console.error('usage: node scripts/bundle.cjs <deck.html> --out <file.html> [--brand <brand.css>]'); process.exit(2); }

const base = path.dirname(path.resolve(src));
let html = fs.readFileSync(src, 'utf8');
const local = href => !/^(https?:)?\/\//i.test(href) && !/^data:/i.test(href);
const clean = href => href.split(/[?#]/)[0];
const MIME = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

/* url(...) inside a stylesheet are relative to THAT stylesheet: inline them */
function inlineUrls(css, from) {
  return css.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => {
    if (!local(u) || u.startsWith('#') || /^\.+$/.test(u)) return m;   /* "url(...)" in a comment */
    const file = path.resolve(path.dirname(from), clean(u));
    if (!fs.existsSync(file)) { console.warn('  missing ' + u + ' (left as is)'); return m; }
    const buf = fs.readFileSync(file);
    if (buf.length > 2 * 1024 * 1024) { console.warn('  ' + u + ' is over 2 MB — left as a path'); return m; }
    const ext = path.extname(file).slice(1).toLowerCase();
    return 'url("data:' + (MIME[ext] || 'application/octet-stream') + ';base64,' + buf.toString('base64') + '")';
  });
}

let n = 0;
html = html.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, tag => {
  const href = (/href=["']([^"']+)["']/i.exec(tag) || [])[1];
  if (!href || !local(href)) return tag;
  const isBrand = /id=["']brand["']/i.test(tag);
  const file = isBrand && brand ? path.resolve(brand) : path.resolve(base, clean(href));
  if (!fs.existsSync(file)) { console.warn('  missing stylesheet ' + href + ' (left as a link)'); return tag; }
  n++;
  /* </style inside CSS would end the element early */
  const css = inlineUrls(fs.readFileSync(file, 'utf8'), file).replace(/<\/style/gi, '<\\/style');
  return '<style' + (isBrand ? ' id="brand"' : '') + ' data-bundled="' + path.basename(file) + '">\n' + css + '\n</style>';
});
html = html.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi, (tag, a, href, b) => {
  if (!local(href)) return tag;
  const file = path.resolve(base, clean(href));
  if (!fs.existsSync(file)) { console.warn('  missing script ' + href + ' (left as a link)'); return tag; }
  n++;
  const js = fs.readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script');
  return '<script data-bundled="' + path.basename(file) + '">\n' + js + '\n</script>';
});

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, html);
console.log('bundled ' + n + ' file(s) into ' + out + '  (' + Math.round(html.length / 1024) + ' KB)');
