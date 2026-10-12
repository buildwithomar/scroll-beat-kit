// brand-from-url — rebrand a beat deck from a live website.
//
//   node scripts/brand-from-url.cjs https://their-site.com
//   node scripts/brand-from-url.cjs https://their-site.com --out path/to/brand.css
//        --port 9335   --keep-wireframe   --dark
//
// Opens the site in headless Chrome and reads what it ACTUALLY RENDERS — not
// what its CSS source says, which is cascades, variables and media queries
// nobody can resolve by reading:
//
//   colours   page background, text, secondary text, raised surfaces,
//             borders, and the PRIMARY button (its fill becomes --accent, its
//             label colour --on-accent) — computed styles, ranked by area
//   type      the faces the headline and body really render in, their weight
//             and tracking, plus how to load them (Google/Typekit links, and
//             the site's own @font-face rules with absolute URLs)
//   shape     button and card corner radius, card shadow
//   logo      the header's logo image or SVG
//   voice     title, description, H1 and the first paragraphs — for the
//             intake interview, so beats can be proposed in their words
//
// and writes a complete brand.css (every token in brand.css, filled),
// a brand.json with where each value came from, and a contrast report. The
// wireframe annotations are switched off unless --keep-wireframe.
//
// It is a strong first draft, not a verdict. Read the report: a site whose
// primary button is outlined, whose hero is a photo, or whose fonts block
// cross-origin loading needs a human decision, and the report says which.
//
// Needs Node 22+ and Google Chrome.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const argv = process.argv.slice(2);
const opt = { url: null, out: null, port: 9335, keepWire: false, dark: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out') opt.out = argv[++i];
  else if (a === '--port') opt.port = +argv[++i];
  else if (a === '--keep-wireframe') opt.keepWire = true;
  else if (a === '--dark') opt.dark = true;
  else if (!a.startsWith('--')) opt.url = a;
  else { console.error('unknown option ' + a); process.exit(2); }
}
if (!opt.url) { console.error('usage: node scripts/brand-from-url.cjs https://site.com [--out brand.css]'); process.exit(2); }
if (!/^https?:\/\//.test(opt.url)) opt.url = 'https://' + opt.url;
const host = new URL(opt.url).hostname.replace(/^www\./, '');
if (!opt.out) opt.out = path.resolve('brand-' + host.replace(/[^a-z0-9.-]/gi, '_') + '.css');

/* Chrome or Chromium, wherever this OS keeps it; CHROME_PATH overrides */
const CH = [process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
  process.env.PROGRAMFILES && process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe',
  process.env['PROGRAMFILES(X86)'] && process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
].find(p => p && fs.existsSync(p)) || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── colour maths ─────────────────────────────────────────────────────────── */
function parseColor(s) {
  const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null;
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 });
function lum(c) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const dist = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
/* how VIVID a colour looks, 0..1 — chroma, not HSV saturation. HSV calls a
   deep navy like #061b31 88% saturated, which threw Stripe's heading ink out as
   "too colourful to be text". Chroma (max − min channel) calls it 0.17: dark
   and quiet, which is what the eye sees. */
function sat(c) { return (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255; }

/* the in-page survey: computed styles of what is on screen, weighted by area */
const SURVEY = `(async () => {
  await (document.fonts ? document.fonts.ready : 0);
  const vw = innerWidth, vh = innerHeight;
  const cs = el => getComputedStyle(el);
  /* Every colour is normalised by PAINTING it: modern sites declare colours in
     oklch()/color() and computed style hands those back unconverted, which no
     rgb parser can read. A 1px canvas turns any CSS colour into plain rgba. */
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true }); const memo = {};
  const N = c => { if (!c) return c; if (memo[c]) return memo[c];
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = 'rgba(0,0,0,0)'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return memo[c] = 'rgba(' + d[0] + ', ' + d[1] + ', ' + d[2] + ', ' + (d[3] / 255).toFixed(3) + ')'; };
  const opaque = c => { const m = /,\\s*([\\d.]+)\\)$/.exec(N(c) || ''); return !!m && +m[1] > 0.05; };
  const vis = el => { const r = el.getBoundingClientRect(); const s = cs(el);
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.1 && r.bottom > 0 && r.top < vh * 3; };
  const area = el => { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh * 3) - Math.max(r.top, 0)); };
  const body = document.body, html = document.documentElement;
  const bg = N(opaque(cs(body).backgroundColor) ? cs(body).backgroundColor : (opaque(cs(html).backgroundColor) ? cs(html).backgroundColor : '#fff'));

  /* text colours, weighted by how much text uses them */
  const texts = {};
  for (const el of document.querySelectorAll('p, li, span, a, h1, h2, h3, h4, small, label, td')) {
    if (!vis(el) || !el.childNodes.length) continue;
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue.trim()).join('');
    if (own.length < 3) continue;
    const c = N(cs(el).color); texts[c] = (texts[c] || 0) + own.length;
  }
  /* buttons: candidates for the primary CTA */
  const buttons = [];
  /* a cookie/consent banner's "Accept" is the most prominent filled button on
     half the web and says nothing about the brand — skip anything inside one */
  const CONSENT = /cookie|consent|gdpr|onetrust|ot-sdk|cmp|usercentrics|didomi|privacy-banner|truste|osano/i;
  const inConsent = el => { for (let n = el; n && n !== body; n = n.parentElement)
    if (CONSENT.test((n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : ''))) return true; return false; };
  for (const el of document.querySelectorAll('a, button, [role=button], input[type=submit]')) {
    if (!vis(el)) continue; const s = cs(el), r = el.getBoundingClientRect();
    const txt = (el.innerText || el.value || '').trim();
    if (!txt || txt.length > 40 || r.height < 24 || r.width < 50) continue;
    if (inConsent(el) || /^(accept|reject|decline|agree|allow|deny|got it|ok|okay)( all)?( cookies)?$/i.test(txt)) continue;
    buttons.push({ bg: N(s.backgroundColor), color: N(s.color), border: s.borderTopWidth + ' ' + s.borderTopStyle,
      radius: s.borderTopLeftRadius, top: r.top, area: r.width * r.height, txt: txt.slice(0, 30), fill: opaque(s.backgroundColor) && N(s.backgroundColor) !== bg });
  }
  /* surfaces: opaque boxes that differ from the page */
  const surfaces = {}, borders = {}, radii = {}, shadows = {};
  for (const el of document.querySelectorAll('div, section, article, aside, header, li, figure, form, nav, main')) {
    if (!vis(el)) continue; const s = cs(el), a = area(el), sbg = N(s.backgroundColor);
    if (opaque(sbg) && sbg !== bg && a < vw * vh * 2.5) surfaces[sbg] = (surfaces[sbg] || 0) + a;
    const bw = parseFloat(s.borderTopWidth) || parseFloat(s.borderBottomWidth);
    const bc = N(parseFloat(s.borderTopWidth) ? s.borderTopColor : s.borderBottomColor);
    if (bw > 0 && bw < 4 && (s.borderTopStyle !== 'none' || s.borderBottomStyle !== 'none') && opaque(bc)) borders[bc] = (borders[bc] || 0) + 1;
    if (opaque(sbg) && sbg !== bg) {
      const rr = parseFloat(s.borderTopLeftRadius); if (rr > 0 && rr < 60) radii[rr] = (radii[rr] || 0) + 1;
      if (s.boxShadow && s.boxShadow !== 'none') shadows[s.boxShadow] = (shadows[s.boxShadow] || 0) + 1;
    }
  }
  /* type */
  const h = document.querySelector('h1') || document.querySelector('h2');
  const p = [...document.querySelectorAll('p')].find(x => vis(x) && x.innerText.trim().length > 40) || body;
  const hs = h ? cs(h) : cs(body), ps = cs(p);
  /* which faces actually rendered — the first family the browser has loaded */
  const loaded = new Set(); if (document.fonts) document.fonts.forEach(f => { if (f.status === 'loaded') loaded.add(f.family.replace(/["']/g, '')); });
  /* font sources: link tags to font services, and @font-face rules */
  const fontLinks = [...document.querySelectorAll('link[href]')].map(l => l.href)
    .filter(u => /fonts\\.googleapis\\.com|use\\.typekit\\.net|fonts\\.bunny\\.net|p\\.typekit\\.net|use\\.fontawesome/.test(u) && !/fontawesome/.test(u));
  const faces = [], crossSheets = [];
  /* @font-face can sit inside @layer / @media / @supports — frameworks put it
     there — so walk nested rule lists, not just the top level */
  const walk = (rules, base) => { for (const r of rules) {
    if (r.type === 5) faces.push({ css: r.cssText, base });
    else if (r.cssRules) walk(r.cssRules, base); } };
  for (const sh of document.styleSheets) {
    let rules; try { rules = sh.cssRules; } catch (e) { if (sh.href) crossSheets.push(sh.href); continue; }
    walk(rules, sh.href || location.href);
  }
  for (const sh of (document.adoptedStyleSheets || [])) { try { walk(sh.cssRules, location.href); } catch (e) {} }
  /* logo: an image or svg in the header/nav, or anything named logo */
  let logo = null;
  const hdr = document.querySelector('header, [role=banner], nav') || body;
  const cand = [...hdr.querySelectorAll('img, svg')].concat([...document.querySelectorAll('img[src*=logo i], img[alt*=logo i], [class*=logo i] img, [class*=logo i] svg')]);
  for (const el of cand) { const r = el.getBoundingClientRect(); if (r.width < 20 || r.height < 10 || r.top > 200) continue;
    if (el.tagName.toLowerCase() === 'img') { logo = { kind: 'img', src: el.currentSrc || el.src, w: r.width, h: r.height }; break; }
    const clone = el.cloneNode(true); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', '0 0 ' + r.width + ' ' + r.height);
    /* currentColor resolves against the header's own text colour */
    logo = { kind: 'svg', svg: clone.outerHTML.replace(/currentColor/g, cs(el).color), w: r.width, h: r.height }; break; }
  const meta = n => (document.querySelector('meta[name="' + n + '"], meta[property="' + n + '"]') || {}).content || '';
  return {
    bg, texts, buttons, surfaces, borders, radii, shadows, fontLinks, faces, crossSheets, logo,
    preloads: [...document.querySelectorAll('link[rel=preload][as=font][href]')].map(l => l.href),
    headFamily: hs.fontFamily, headWeight: hs.fontWeight, headTracking: hs.letterSpacing, headSize: hs.fontSize, headColor: N(hs.color),
    bodyFamily: ps.fontFamily, bodyColor: N(ps.color), themeColor: N((document.querySelector('meta[name="theme-color"]') || {}).content || ''), loaded: [...loaded],
    voice: { title: document.title, description: meta('description') || meta('og:description'),
      h1: h ? h.innerText.trim().slice(0, 200) : '', themeColor: meta('theme-color'),
      paragraphs: [...document.querySelectorAll('p')].filter(vis).map(x => x.innerText.trim()).filter(t => t.length > 40).slice(0, 4) }
  };
})()`;

function getJSON(url) {
  return new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c);
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
}

(async () => {
  if (!CH) { console.error('Chrome/Chromium not found. Install Chrome, or set CHROME_PATH to its executable.'); process.exit(1); }
  const profile = path.join(require('os').tmpdir(), 'brand-from-url-' + process.pid);
  const chrome = spawn(CH, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--remote-debugging-port=' + opt.port, '--user-data-dir=' + profile, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  process.on('exit', cleanup);
  let ver = null;
  for (let i = 0; i < 100 && !ver; i++) { try { ver = await getJSON('http://localhost:' + opt.port + '/json/version'); } catch (e) { await sleep(100); } }
  if (!ver) throw new Error('Chrome did not open its debugging port');
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0, sid = null; const pending = new Map();
  /* every webfont the browser actually loads, straight from DevTools: family,
     weight, style, unicode-range and the file URL. This is the ground truth —
     it does not care whether the @font-face lives in a cross-origin bundle, a
     framework's CSS module or a FontFace() call, all of which defeated reading
     the rules (Leadpages' Manrope, via next/font, was invisible to them). */
  const loadedFonts = [];
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.method === 'CSS.fontsUpdated' && m.params && m.params.font && m.params.font.src) loadedFonts.push(m.params.font);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej });
    ws.send(JSON.stringify(sid ? { id: i, method, params, sessionId: sid } : { id: i, method, params })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  sid = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Page.enable'); await send('Runtime.enable');
  await send('DOM.enable'); await send('CSS.enable');    /* for CSS.fontsUpdated */
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  console.log('reading ' + opt.url + ' …');
  await send('Page.navigate', { url: opt.url });
  for (let i = 0; i < 200; i++) {
    await sleep(100);
    const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (r.result.value === 'complete') break;
  }
  await sleep(1800);   /* late webfonts, cookie banners, hydration */
  const r = await send('Runtime.evaluate', { expression: SURVEY, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('survey failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  const S = r.result.value;
  sid = null; try { await Promise.race([send('Browser.close'), sleep(1500)]); } catch (e) {}
  try { ws.close(); } catch (e) {}

  /* ── decide the tokens ─────────────────────────────────────────────────── */
  const notes = [], src = {};
  const bg = parseColor(S.bg) || { r: 255, g: 255, b: 255, a: 1 };
  const dark = opt.dark !== null ? opt.dark : lum(bg) < 0.25;
  const ranked = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ c: parseColor(c), raw: c, n })).filter(x => x.c && x.c.a > 0.5);

  const textR = ranked(S.texts).filter(x => contrast(x.c, bg) > 1.6);
  /* ink = the STRONGEST text colour the site uses widely, not the paragraph
     colour: many sites set paragraphs in a soft grey and headings in a deep
     one, and the deck's headline is the heading, not the paragraph. The
     paragraph grey then becomes --dim. */
  const totalText = textR.reduce((a, x) => a + x.n, 0) || 1;
  const common = textR.filter(x => x.n / totalText >= 0.08 && sat(x.c) < 0.35);
  const headColor = parseColor(S.headColor);
  const inkCands = common.map(x => x.c).concat(headColor && headColor.a > 0.5 ? [headColor] : []);
  let ink = inkCands.sort((a, b) => contrast(b, bg) - contrast(a, bg))[0] || parseColor(S.bodyColor) ||
    (dark ? { r: 245, g: 245, b: 245 } : { r: 20, g: 20, b: 20 });
  src.ink = 'strongest widely-used text colour';
  const bodyC = parseColor(S.bodyColor);
  let dim = (bodyC && dist(bodyC, ink) > 30 && sat(bodyC) < 0.35 && contrast(bodyC, bg) >= 3) ? bodyC
    : (textR.find(x => dist(x.c, ink) > 40 && sat(x.c) < 0.35 && contrast(x.c, bg) >= 3) || {}).c;
  if (!dim) { dim = mix(ink, bg, 0.42); src.dim = 'derived: ink 58% toward bg'; } else src.dim = 'most-used secondary text colour';
  if (contrast(dim, bg) < 4.5) { notes.push('secondary text (--dim) is ' + contrast(dim, bg).toFixed(1) + ':1 on the page — below 4.5:1 for small copy; pulled toward --ink'); dim = mix(dim, ink, 0.35); }

  /* the primary CTA: a FILLED button, high in the page, saturated, big */
  const btns = S.buttons.filter(b => b.fill).map(b => ({ ...b, c: parseColor(b.bg), on: parseColor(b.color) })).filter(b => b.c);
  btns.forEach(b => { b.score = b.area * (0.3 + sat(b.c)) * (b.top < 900 ? 2 : 1) * (contrast(b.c, bg) > 1.3 ? 1 : 0.2); });
  btns.sort((a, b) => b.score - a.score);
  let accent, onAccent, radiusPill = '99px';
  if (btns.length) {
    /* the SHAPE comes from the most prominent button; the COLOUR prefers a
       chromatic one. A white or black CTA is often just the page's inverse,
       and the brand's signature colour sits on a smaller button or the links. */
    const top = btns[0];
    let pick = top;
    if (sat(top.c) < 0.15) {
      const chroma = btns.find(b => sat(b.c) >= 0.25 && b.score >= top.score * 0.08);
      if (chroma) { pick = chroma; notes.push('the most prominent button ("' + top.txt + '") is colourless; --accent uses the brand-coloured "' + chroma.txt + '" instead'); }
      else {
        const link = textR.find(x => sat(x.c) >= 0.3 && contrast(x.c, bg) >= 3);
        if (link) { accent = link.c; notes.push('no coloured button — --accent is the brand-coloured text/link colour; the CTA itself is ' + hex(top.c)); }
      }
    }
    if (!accent) { accent = pick.c; onAccent = pick.on; src.accent = 'button "' + pick.txt + '"'; }
    else src.accent = 'coloured link/text';
    const br = parseFloat(top.radius); radiusPill = br >= 18 ? '99px' : (br || 0) + 'px';
    src.radiusPill = 'primary button radius ' + top.radius;
  } else {
    const outlined = S.buttons.find(b => /solid/.test(b.border));
    const theme = parseColor(S.themeColor || '');
    const tc = (theme && theme.a > 0.5 ? theme : null) || (outlined && parseColor(outlined.color));
    accent = tc || ink; onAccent = bg;
    notes.push('no filled button found — --accent taken from ' + (tc ? 'an outlined button / theme colour' : 'the ink colour') + '; check it');
    src.accent = 'fallback';
  }
  if (!onAccent || contrast(onAccent, accent) < 3) onAccent = contrast({ r: 255, g: 255, b: 255 }, accent) > contrast({ r: 17, g: 17, b: 17 }, accent) ? { r: 255, g: 255, b: 255 } : { r: 17, g: 17, b: 17 };

  const surf = ranked(S.surfaces).filter(x => dist(x.c, accent) > 40 && dist(x.c, bg) > 6 && dist(x.c, bg) < 120);
  let panel = surf.length ? surf[0].c : null;
  if (panel) src.panel = 'most-used raised surface'; else { panel = dark ? mix(bg, { r: 255, g: 255, b: 255 }, 0.06) : (lum(bg) > 0.9 ? mix(bg, { r: 0, g: 0, b: 0 }, 0.025) : mix(bg, { r: 255, g: 255, b: 255 }, 0.5)); src.panel = 'derived from bg'; }
  const brd = ranked(S.borders).filter(x => dist(x.c, bg) > 12 && contrast(x.c, bg) < 3.5);
  let line = brd.length ? brd[0].c : mix(bg, ink, 0.16); src.line = brd.length ? 'most-used border colour' : 'derived: ink 16% into bg';
  /* the deck leans on its borders to separate the subject from the page: a
     border the site gets away with at 1.1:1 vanishes on a deck. Step it toward
     ink until it reads. */
  if (contrast(line, bg) < 1.25) {
    const was = hex(line);
    for (let t = 0.05; t <= 0.6 && contrast(line, bg) < 1.25; t += 0.05) line = mix(brd.length ? brd[0].c : bg, ink, t);
    notes.push('border colour ' + was + ' was too faint on the page (' + contrast(parseColor('rgb(' + parseInt(was.slice(1, 3), 16) + ',' + parseInt(was.slice(3, 5), 16) + ',' + parseInt(was.slice(5, 7), 16) + ')'), bg).toFixed(2) + ':1); stepped toward --ink to ' + hex(line));
  }
  if (dist(panel, bg) < 10) notes.push('--panel is almost the page colour — the subject is separated by its border/shadow only');
  const fill = mix(panel, ink, 0.07), fillStrong = mix(panel, ink, 0.13);

  /* type: the family stacks as rendered, the first loaded face first */
  const fam = s => (s || '').split(',').map(x => x.trim()).filter(Boolean);
  const pickStack = s => { const f = fam(s); return f.length ? f.join(', ') : 'system-ui, sans-serif'; };
  const display = pickStack(S.headFamily), bodyF = pickStack(S.bodyFamily);
  const used = new Set([...fam(S.headFamily), ...fam(S.bodyFamily)].map(x => x.replace(/["']/g, '').toLowerCase()));
  const rendered = fam(S.headFamily).map(x => x.replace(/["']/g, '')).find(x => S.loaded.includes(x));
  if (!rendered && S.loaded.length === 0) notes.push('no webfonts loaded on the page — the headline renders in a system face');

  /* font loading: service links as @import, own @font-face rules made absolute */
  const imports = S.fontLinks.map(u => '@import url("' + u + '");');
  const absol = (css, base) => css.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => { try { return 'url("' + new URL(u, base).href + '")'; } catch (e) { return m; } });
  let faces = S.faces.filter(f => { const m = /font-family:\s*["']?([^;"']+)/i.exec(f.css); return m && used.has(m[1].trim().toLowerCase()); })
    .map(f => absol(f.css, f.base));
  /* cross-origin sheets (a CDN, the norm for Next.js and most builders): the
     page cannot read them, so fetch them here. All of them — capping at a dozen
     missed Linear's, whose @font-face lives in a later bundle. */
  for (const href of S.crossSheets.slice(0, 60)) {
    try { const t = await (await fetch(href)).text();
      (t.match(/@font-face\s*{[^}]*}/g) || []).forEach(css => { const m = /font-family:\s*["']?([^;"']+)/i.exec(css);
        if (m && used.has(m[1].trim().toLowerCase())) faces.push(absol(css, href)); });
    } catch (e) {}
  }
  /* the browser's own record of loaded fonts fills any used family the rules
     missed — and is trusted over them, since it is what actually rendered */
  /* families that already had a readable rule, decided ONCE before adding —
     so every weight of a missing family is added, not just the first */
  const hadRule = new Set(faces.map(css => { const m = /font-family:\s*["']?([^;"']+)/i.exec(css); return m ? m[1].trim().toLowerCase() : ''; }));
  const seenSrc = new Set();
  for (const lf of loadedFonts) {
    const f = lf.fontFamily.replace(/["']/g, '');
    if (!used.has(f.toLowerCase()) || hadRule.has(f.toLowerCase()) || seenSrc.has(lf.src)) continue;
    seenSrc.add(lf.src);
    faces.push('/* from browser */ @font-face { font-family: "' + f + '"; src: url("' + lf.src + '"); font-weight: ' + (lf.fontWeight || 'normal') +
      '; font-style: ' + (lf.fontStyle || 'normal') + ';' + (lf.unicodeRange && !/^U\+0-10FFFF$/i.test(lf.unicodeRange) ? ' unicode-range: ' + lf.unicodeRange + ';' : '') + ' font-display: swap; }');
  }

  /* last resort: a used family with no rule, but a font file the page
     PRELOADS (<link rel=preload as=font>) — common for a site's one key face.
     The pairing is an inference when the page preloads several files, so it
     is reported as one. */
  const hasRule = f => faces.some(css => new RegExp('font-family:\\s*["\']?' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']?\\s*;', 'i').test(css));
  const missing = [...new Set([...fam(S.headFamily), ...fam(S.bodyFamily)].map(x => x.replace(/["']/g, '')))]
    .filter(f => S.loaded.includes(f) && !hasRule(f));
  if (missing.length && S.preloads.length) {
    missing.forEach((f, i) => { const u = S.preloads[Math.min(i, S.preloads.length - 1)];
      faces.push('@font-face { font-family: "' + f + '"; src: url("' + u + '"); font-weight: 100 900; font-display: swap; }');
      notes.push('"' + f + '" had no readable @font-face; paired with the preloaded file ' + u.split('/').pop().split('?')[0] +
        (S.preloads.length > 1 ? ' (one of ' + S.preloads.length + ' preloads — check it is the right one)' : '')); });
  }
  faces = [...new Set(faces)];
  /* Latin subsets only: a site ships one face per alphabet (cyrillic, greek,
     vietnamese …) and a deck in English needs one of them, not forty-five */
  faces = faces.filter(css => { const m = /unicode-range:\s*([^;}]+)/i.exec(css);
    return !m || /U\+0+(-|,|;|\s|$)|U\+0000-00FF|U\+0-FF|U\+20-7E/i.test(m[1]); });

  /* Download the files and point the rules at the local copies. Hot-linking
     cannot work: a font host serves its own site and refuses every other
     origin (CORS), so a deck that links the brand's fonts silently renders in
     a system face. That is exactly what the first version of this script
     produced on all three test sites. */
  const fontDir = path.join(path.dirname(path.resolve(opt.out)), path.basename(opt.out, '.css') + '-fonts');
  let got = 0, failed = 0; const fetched = {};
  for (let i = 0; i < faces.length; i++) {
    const urls = [...faces[i].matchAll(/url\("([^"]+)"\)/g)].map(m => m[1]).filter(u => /^https?:/.test(u));
    for (const u of urls) {
      if (!fetched[u]) {
        try {
          const res = await fetch(u, { headers: { Referer: opt.url, Origin: new URL(opt.url).origin } });
          if (!res.ok) throw new Error(res.status);
          const name = (new URL(u).pathname.split('/').pop() || 'font').replace(/[^a-z0-9._-]/gi, '_').slice(-80);
          fs.mkdirSync(fontDir, { recursive: true });
          let file = name, k = 1; while (fs.existsSync(path.join(fontDir, file))) file = (k++) + '-' + name;
          fs.writeFileSync(path.join(fontDir, file), Buffer.from(await res.arrayBuffer()));
          fetched[u] = path.basename(fontDir) + '/' + file; got++;
        } catch (e) { fetched[u] = null; failed++; }
      }
      if (fetched[u]) faces[i] = faces[i].split('url("' + u + '")').join('url("' + fetched[u] + '")');
    }
  }
  if (faces.length) notes.push(faces.length + ' @font-face rule(s), ' + got + ' file(s) downloaded to ' + path.basename(fontDir) + '/' +
    (failed ? ' (' + failed + ' failed — those faces still point at ' + host + ' and will fall back)' : '') +
    '. Brand fonts are licensed to the brand: fine for their own deck, check the licence before using them anywhere else');
  else if (!S.fontLinks.length) notes.push('no loadable font rules found — the deck will use the font stack\'s fallbacks; add the brand\'s font files by hand');

  /* Checked against the FINISHED file, after the Latin filter and the
     downloads, and only for the family each stack leads with — that is the
     face the site renders; the rest of a stack is fallbacks nobody needs. */
  const famOf = css => { const m = /font-family:\s*["']?([^;"']+)/i.exec(css); return m ? m[1].trim().toLowerCase() : ''; };
  const primaries = [...new Set([fam(S.headFamily)[0], fam(S.bodyFamily)[0]].filter(Boolean).map(x => x.replace(/["']/g, '')))];
  const unfound = primaries
    .filter(f => !/^(system-ui|sans-serif|serif|monospace|-apple-system|blinkmacsystemfont|arial|helvetica( neue)?|georgia|times( new roman)?)$/i.test(f))
    /* found = a rule for it whose every file was downloaded (a face still
       pointing at the brand's server will be refused, so it does not count) */
    .filter(f => !faces.some(css => famOf(css) === f.toLowerCase() && fetchedAll(css)))
    .filter(f => !S.fontLinks.some(u => u.toLowerCase().includes(f.toLowerCase().replace(/\s+/g, '+'))));
  /* a face nothing on the page would hand over may still be a Google font:
     the same family name there is very likely the same face. Ask Google, and
     load it from there if it exists — CORS-open, no files to copy. */
  for (const f of unfound) {
    const g = 'https://fonts.googleapis.com/css2?family=' + f.replace(/\s+/g, '+') + ':wght@300;400;500;600;700;800&display=swap';
    let ok = false;
    try { const res = await fetch(g, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/130' } }); ok = res.ok; } catch (e) {}
    if (!ok) { try { const res = await fetch('https://fonts.googleapis.com/css2?family=' + f.replace(/\s+/g, '+') + '&display=swap'); ok = res.ok; if (ok) imports.push('@import url("https://fonts.googleapis.com/css2?family=' + f.replace(/\s+/g, '+') + '&display=swap");'); } catch (e) {} }
    else imports.push('@import url("' + g + '");');
    notes.push(ok
      ? '"' + f + '" renders on the site but its file could not be read from the page; loaded from Google Fonts under the same name instead (check it looks right)'
      : '"' + f + '" renders on the site but its font file could not be located, and Google Fonts has no family by that name — copy the file in by hand, or the deck falls back for it');
  }
  function fetchedAll(css) { return ![...css.matchAll(/url\("([^"]+)"\)/g)].some(m => /^https?:/.test(m[1])); }

  const radius = (Object.entries(S.radii).sort((a, b) => b[1] - a[1])[0] || ['12'])[0];
  const shadow = (Object.entries(S.shadows).sort((a, b) => b[1] - a[1])[0] || ['none'])[0];
  const tracking = S.headTracking === 'normal' ? '-0.01em' : (parseFloat(S.headTracking) / parseFloat(S.headSize)).toFixed(3) + 'em';

  /* logo → a data URI for svg (portable), the URL for an image */
  let logoTok = 'none', logoH = '0px';
  if (S.logo) {
    logoH = Math.round(Math.min(40, Math.max(20, S.logo.h))) + 'px';
    logoTok = S.logo.kind === 'img' ? 'url("' + S.logo.src + '")'
      : 'url("data:image/svg+xml;utf8,' + encodeURIComponent(S.logo.svg) + '")';
    src.logo = 'header ' + S.logo.kind;
  } else notes.push('no header logo found — --brand-logo left empty');

  /* ── the checks that decide whether the brand is usable as-is ─────────── */
  const checks = [
    ['ink on bg', contrast(ink, bg), 7],
    ['dim on bg', contrast(dim, bg), 4.5],
    ['on-accent on accent', contrast(onAccent, accent), 4.5],
    ['accent on bg (tabs, emphasis)', contrast(accent, bg), 3],
    ['line on bg (borders visible)', contrast(line, bg), 1.25]
  ];
  let emColor = 'var(--accent)';
  if (contrast(accent, bg) < 3) { emColor = 'inherit'; notes.push('accent is too pale on the page for emphasised words — <em> keeps the ink colour'); }

  const T = (k, v, c) => '  --' + k + ': ' + v + ';' + (c ? '   /* ' + c + ' */' : '');
  const css = [
    '/* brand.css — generated from ' + opt.url + ' by scripts/brand-from-url.cjs',
    ' * on ' + new Date().toISOString().slice(0, 10) + '. Every value is read from the live, rendered site; see',
    ' * ' + path.basename(opt.out).replace(/\.css$/, '') + '.json for where each one came from. Edit freely — this',
    ' * is a first draft of the brand, not the last word on it. */',
    ...imports,
    ...faces,
    ':root {',
    T('bg', hex(bg), 'page background'),
    T('panel', hex(panel), src.panel),
    T('ink', hex(ink), src.ink),
    T('dim', hex(dim), src.dim),
    T('line', hex(line), src.line),
    T('accent', hex(accent), src.accent),
    T('on-accent', hex(onAccent)),
    T('good', 'var(--accent)', 'no invented success colour'),
    T('fill', hex(fill), 'placeholder blocks: ink 7% into panel'),
    T('fill-strong', hex(fillStrong)),
    '',
    T('font-display', display),
    T('font-body', bodyF),
    T('font-mono', 'ui-monospace, SFMono-Regular, Menlo, monospace'),
    T('display-weight', S.headWeight || '700'),
    T('display-tracking', tracking),
    T('em-color', emColor),
    T('em-decoration', 'none'),
    '',
    T('radius', Math.round(+radius) + 'px', 'most-used card radius'),
    T('radius-pill', radiusPill, src.radiusPill || ''),
    T('edge', '1px solid var(--line)'),
    T('edge-strong', '1px solid var(--line)'),
    T('shadow', shadow),
    '',
    T('surface-image', 'none'),
    T('surface-size', 'auto'),
    '',
    T('brand-logo', logoTok),
    T('logo-height', logoH),
    '',
    T('bs-row-dur', '0.5'),
    T('bs-rise', '0.55'),
    T('bs-lift', '0.32'),
    T('bs-relay', '0.032'),
    '',
    T('wf-labels', opt.keepWire ? 'block' : 'none'),
    T('wf-outline', opt.keepWire ? '1.5px dashed var(--line)' : 'none'),
    '}',
    ''
  ].join('\n');
  fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true });
  fs.writeFileSync(opt.out, css);
  const jsonOut = opt.out.replace(/\.css$/, '') + '.json';
  fs.writeFileSync(jsonOut, JSON.stringify({ url: opt.url, dark, sources: src, notes,
    contrast: Object.fromEntries(checks.map(c => [c[0], +c[1].toFixed(2)])),
    candidates: { buttons: btns.slice(0, 5).map(b => ({ text: b.txt, bg: hex(b.c), color: b.on && hex(b.on) })),
      textColours: textR.slice(0, 6).map(x => hex(x.c)), surfaces: surf.slice(0, 5).map(x => hex(x.c)) },
    fonts: { display, body: bodyF, loaded: S.loaded, imports: S.fontLinks, faces: faces.length },
    voice: S.voice }, null, 1));

  /* ── report ─────────────────────────────────────────────────────────────── */
  console.log('');
  console.log('brand  ' + host + (dark ? '  (dark page)' : ''));
  console.log('  bg ' + hex(bg) + '   panel ' + hex(panel) + '   ink ' + hex(ink) + '   dim ' + hex(dim) + '   line ' + hex(line));
  console.log('  accent ' + hex(accent) + ' on ' + hex(onAccent) + '   (' + src.accent + ')');
  console.log('  display ' + display.split(',')[0] + ' ' + (S.headWeight || '') + (rendered ? '  rendered' : '') + '   body ' + bodyF.split(',')[0]);
  console.log('  radius ' + Math.round(+radius) + 'px   pill ' + radiusPill + '   shadow ' + (shadow === 'none' ? 'none' : 'yes') + '   logo ' + (S.logo ? S.logo.kind : 'none'));
  console.log('');
  for (const [name, v, min] of checks) console.log((v >= min ? '  ok    ' : '  LOW   ') + name.padEnd(32) + v.toFixed(2) + ':1  (want ' + min + ')');
  /* every brand-coloured candidate seen, so a wrong accent is a one-line fix */
  const chromaSeen = [...new Set([...btns.map(b => b.c), ...textR.map(x => x.c), ...ranked(S.surfaces).map(x => x.c)]
    .filter(c => sat(c) >= 0.25).map(hex))].slice(0, 6);
  console.log('');
  console.log('  accent candidates seen: ' + (chromaSeen.length ? chromaSeen.join('  ') : 'none — the site is monochrome above the fold') +
    '   (set --accent to another if the pick is wrong)');
  if (notes.length) { console.log(''); notes.forEach(n => console.log('  note  ' + n)); }
  console.log('');
  console.log('voice  ' + (S.voice.h1 || S.voice.title).replace(/\s+/g, ' ').slice(0, 110));
  console.log('');
  console.log('wrote ' + opt.out);
  console.log('      ' + jsonOut);
  console.log('preview on the demo:  gallery.html?brand=' + path.relative(path.resolve(__dirname, '..'), path.resolve(opt.out)));
  cleanup();
  /* exit once stdout has drained — a bare process.exit() drops piped output */
  process.stdout.write('', () => process.exit(0));
})().catch(e => { console.error('brand-from-url failed: ' + e.message); process.exit(1); });
