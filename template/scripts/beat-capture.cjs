// beat-capture — measure a beat deck's TIMING and POSITION from screen captures.
//
// The sweep proves nothing is clipped. This proves the choreography: it scrubs
// the deck end to end in small steps, screen-captures every step, and works out
//
//   * when each named part moves, appears and disappears        (DOM geometry)
//   * when the SCREEN changes at all, part or not               (pixel diff)
//   * every still stretch — a beat's rest, or a dead stretch
//     that wants a `cut`                                          (both)
//   * each beat's scroll length, how much of it moves, whether it
//     rests before the hand-off, and who is still moving into it
//   * each beat's resting composition: group centre offset, how
//     much of the screen the subject fills, anything clipped
//
// and writes a contact sheet — every beat's in / mid / out at every width, part
// boxes overlaid, plus a timeline of the whole sequence — so the pattern can be
// LOOKED AT, not just read.
//
//   node scripts/beat-capture.cjs                         # the demo, 390/768/1440
//   node scripts/beat-capture.cjs http://localhost:8769/path/deck.html
//        --sizes 390x844,1440x900   --step 0.005   --out /tmp/my-capture
//        --port 9334   --dpr 1   --live-anim   --strict
//
//   --step     scroll fraction between samples (default 0.01 = 101 frames)
//   --live-anim  leave CSS animations running (default: frozen, so two runs
//              of the same page produce the same numbers)
//   --strict   exit 1 if any dead stretch, missing rest, or mid-beat clip
//
// Parts are the elements marked data-bs-part="name" inside the pin. Name the
// units that MOVE (the slot, not the card inside it). With none marked it falls
// back to the stage's top-level children, which is coarser but still useful.
//
// Needs Node 22+ (global WebSocket) and Google Chrome. Serve the deck over HTTP
// (python3 -m http.server 8769 in the scroll/ folder for the demo). It launches
// its own headless Chrome with a throwaway profile — no stale-engine cache.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');

/* ── args ─────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const opt = { url: 'http://localhost:8769/gallery.html', sizes: '390x844,768x1024,1440x900',
  step: 0.01, out: path.join(require('os').tmpdir(), 'beat-capture'), port: 9334, dpr: 1, liveAnim: false, strict: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--sizes') opt.sizes = argv[++i];
  else if (a === '--step') opt.step = +argv[++i];
  else if (a === '--out') opt.out = argv[++i];
  else if (a === '--port') opt.port = +argv[++i];
  else if (a === '--dpr') opt.dpr = +argv[++i];
  else if (a === '--live-anim') opt.liveAnim = true;
  else if (a === '--strict') opt.strict = true;
  else if (!a.startsWith('--')) opt.url = a;
  else { console.error('unknown option ' + a); process.exit(2); }
}
const SIZES = opt.sizes.split(',').map(s => s.trim().split('x').map(Number));
const MOVE_PX = 0.75;      /* geometry change per step that counts as motion */
/* Screen change. Frames are lossless and the page is frozen apart from the
   scroll, so a still screen diffs to exactly zero — the threshold only has to
   sit above anti-aliasing noise. It must stay LOW: a slow crossfade between two
   pale surfaces moves each pixel one or two levels per step, and a coarse
   threshold reports a whole fading beat as "nothing changing". */
const PIX_LEVEL = 2;       /* per-channel difference that counts as changed */
const PIX_MIN   = 3;       /* changed pixels per frame that count as motion */
/* Motion frames are captured at FULL size. Half size was cheaper, but
   downsampling resamples high-contrast edges (light text on a dark brand)
   slightly differently at each scroll position: a still beat on Vercel's
   black page read as "changing", and the capture reported moves that never
   rest. Seeking straight to the same two frames showed zero changed pixels. */
const ENERGY_SCALE = +(process.env.BEAT_ENERGY_SCALE || 1);
/* Still stretches are judged in SCREENS of scroll — what the reader feels. A
   held composition is fine; a whole screen of scrolling with nothing changing
   reads as a broken page. */
const STILL_WARN = 0.6, STILL_FAIL = 1.0;

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

/* ── a minimal PNG decoder (8-bit, non-interlaced — what CDP emits) ──────────
   Pixel diffing is the half of this harness that sees what the DOM cannot: a
   canvas, a background-image swap, a CSS animation, a part nobody tagged. */
function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, depth = 0, ctype = 0, inter = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; inter = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (depth !== 8 || !bpp || inter) throw new Error('unsupported PNG (depth ' + depth + ', type ' + ctype + ')');
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, px = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
    prev = cur;
  }
  return { w, h, bpp, px };
}
function pixelDiff(A, B) {
  if (!A || !B || A.w !== B.w || A.h !== B.h) return { frac: 0, count: 0 };
  const n = A.w * A.h, ch = Math.min(3, A.bpp); let changed = 0;
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let c = 0; c < ch; c++) d = Math.max(d, Math.abs(A.px[i * A.bpp + c] - B.px[i * B.bpp + c]));
    if (d > PIX_LEVEL) changed++;
  }
  return { frac: changed / n, count: changed };
}

/* ── CDP plumbing ─────────────────────────────────────────────────────────── */
function getJSON(url) {
  return new Promise((res, rej) => http.get(url, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej));
}
async function connect(port) {
  for (let i = 0; i < 100; i++) {
    try { return await getJSON('http://localhost:' + port + '/json/version'); } catch (e) { await sleep(100); }
  }
  throw new Error('Chrome did not open its debugging port ' + port);
}

/* the in-page probe: frame state plus every part's box and EFFECTIVE opacity
   (the product through every ancestor — an element at opacity 1 inside a
   parent at 0 is invisible, and reading only its own value says otherwise) */
const MEASURE = `(() => {
  const d = window.deck, f = d.frame, vw = innerWidth, vh = innerHeight;
  let els = [...d.pin.querySelectorAll('[data-bs-part]')], auto = false;
  if (!els.length) { auto = true; const sc = d.pin.querySelector('.bs-scale') || d.stage;
    els = sc ? [...sc.children].flatMap(c => c.children.length ? [...c.children] : [c]) : []; }
  const seen = {};
  const parts = els.map(el => {
    const r = el.getBoundingClientRect(); let o = 1, n = el;
    while (n && n.nodeType === 1) { const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') { o = 0; break; }
      o *= parseFloat(cs.opacity); n = n.parentElement; }
    /* a relay block stays at opacity 1 while its WORDS fade row by row, so
       its visibility is how much of its text is showing: the mean word opacity */
    const ws = el.querySelectorAll('.bs-w');
    if (ws.length && o > 0) { let sum = 0; for (const w of ws) sum += parseFloat(getComputedStyle(w).opacity); o *= sum / ws.length; }
    let name = el.getAttribute('data-bs-part') || (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.classList[0] ? '.' + el.classList[0] : ''));
    seen[name] = (seen[name] || 0) + 1; if (seen[name] > 1) name += '#' + seen[name];
    return { name, x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), o: +o.toFixed(3) };
  });
  /* the text column's box: in a split layout the visual must never wander
     into it, and nothing crosses the screen edge when it does */
  const tx = d.pin.querySelector('.bs-text'), tr = tx && tx.getBoundingClientRect();
  const text = tr ? { x: tr.left, y: tr.top, w: tr.width, h: tr.height } : null;
  /* centring is judged inside the STAGE: in a split layout the visual is
     meant to sit off the screen's centre, on its own column's */
  const sr = d.stage && d.stage.getBoundingClientRect();
  const stage = sr ? { x: sr.left, w: sr.width } : { x: 0, w: vw };
  return { p: f.p, q: f.q, beat: f.beat, beatName: f.beatName, scale: f.scale, scrollY, total: f.total, vw, vh, parts, auto, text, stage,
    layout: d.deck.getAttribute('data-layout') || 'stack' };
})()`;
const SETTLE = `new Promise(r => { let done = false; const go = () => { if (!done) { done = true; r(1); } };
  requestAnimationFrame(() => requestAnimationFrame(go)); setTimeout(go, 120); })`;

/* ── the capture ──────────────────────────────────────────────────────────── */
(async () => {
  if (!CH) { console.error('Chrome/Chromium not found. Install Chrome, or set CHROME_PATH to its executable.'); process.exit(1); }
  const probe = await new Promise(r => http.get(opt.url, res => { res.resume(); r(res.statusCode); }).on('error', () => r(0)));
  if (probe !== 200) {
    console.error('Cannot load ' + opt.url + ' (status ' + probe + '). Serve the folder first:  python3 -m http.server 8769');
    process.exit(1);
  }
  fs.mkdirSync(opt.out, { recursive: true });
  const profile = path.join(require('os').tmpdir(), 'beat-capture-chrome-' + process.pid);
  const chrome = spawn(CH, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--remote-debugging-port=' + opt.port, '--user-data-dir=' + profile, '--window-size=1600,1200', 'about:blank'],
    { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  process.on('exit', cleanup);

  const ver = await connect(opt.port);
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let sid = null;
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej });
    ws.send(JSON.stringify(sid ? { id: i, method, params, sessionId: sid } : { id: i, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  sid = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Page.enable'); await send('Runtime.enable');
  if (!opt.liveAnim) await send('Animation.enable');

  const shot = async (m, scale) => {
    const r = await send('Page.captureScreenshot', { format: 'png',
      clip: { x: 0, y: m.scrollY, width: m.vw, height: m.vh, scale } });
    return Buffer.from(r.data, 'base64');
  };

  const pageUrl = opt.url.replace(/[?&]beatdbg=1/, '');
  const runs = [];
  for (const [W, H] of SIZES) {
    const tag = W + 'x' + H, dir = path.join(opt.out, tag);
    fs.mkdirSync(dir, { recursive: true });
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: opt.dpr, mobile: W < 700 });
    await send('Page.navigate', { url: pageUrl });
    let ok = false;
    for (let i = 0; i < 150 && !ok; i++) {
      await sleep(100);
      try { ok = await ev(`document.readyState === 'complete' && !!(window.deck && window.deck.seekQ)`); } catch (e) {}
    }
    if (!ok) { console.error(tag + ': no beat engine on the page (window.deck). beat-capture needs the engine.'); process.exit(1); }
    /* the HUD is for people; a scrolling page background behind a pinned stage
       would make every pixel "move" — pin it, so the diff sees only the stage */
    await ev(`(() => { history.scrollRestoration = 'manual';
      const s = document.createElement('style'); s.textContent =
        '[data-bs-hud]{display:none!important} html,body{background-attachment:fixed!important} *{caret-color:transparent!important}';
      document.head.appendChild(s); return document.fonts ? document.fonts.ready.then(() => 1) : 1; })()`);
    if (!opt.liveAnim) await send('Animation.setPlaybackRate', { playbackRate: 0 });
    await sleep(400);
    const info = await ev(`(() => { const d = window.deck; return { map: d.map(), fade: d.fade, rest: d.rest, cut: d.cut || null }; })()`);
    if (info.fade === undefined) { info.fade = 0.03; info.rest = 0.78; }

    /* pass 1 — scrub in scroll steps: what the READER experiences */
    const samples = []; let prevImg = null;
    const N = Math.round(1 / opt.step);
    for (let i = 0; i <= N; i++) {
      const q = Math.min(1, i * opt.step);
      await ev(`window.deck.seekQ(${q})`); await ev(SETTLE);
      const m = await ev(MEASURE);
      const img = decodePNG(await shot(m, ENERGY_SCALE));
      const df = i ? pixelDiff(prevImg, img) : { frac: 0, count: 0 };
      m.energy = df.frac; m.changed = df.count; prevImg = img;
      samples.push(m);
    }

    /* pass 2 — every beat's opening, rest and close, full size, kept */
    const shots = [];
    for (const b of info.map) {
      const [s, e] = b.span, edge = Math.min(0.02, (e - s) * 0.15);
      for (const [label, p] of [['in', s + edge], ['mid', (s + e) / 2], ['out', e - edge]]) {
        await ev(`window.deck.seekP(${p})`); await ev(SETTLE); await sleep(60);
        const m = await ev(MEASURE);
        const file = b.i + '-' + b.name + '-' + label + '.png';
        fs.writeFileSync(path.join(dir, file), await shot(m, 1));
        shots.push({ beat: b.i, name: b.name, label, p, file: tag + '/' + file, m });
      }
    }
    runs.push(analyse(tag, W, H, info, samples, shots));
    console.log('captured ' + tag + '  (' + samples.length + ' frames, ' + shots.length + ' stills)');
  }
  /* close the browser through the protocol: SIGKILL on the main process alone
     orphans its renderer helpers, and repeated runs pile them up */
  sid = null;
  try { await Promise.race([send('Browser.close'), sleep(1500)]); } catch (e) {}
  await Promise.race([new Promise(r => chrome.once('exit', r)), sleep(2000)]);
  try { ws.close(); } catch (e) {}

  const report = { url: opt.url, step: opt.step, frozenAnimations: !opt.liveAnim, runs };
  fs.writeFileSync(path.join(opt.out, 'report.json'), JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(opt.out, 'report.md'), markdown(report));
  fs.writeFileSync(path.join(opt.out, 'sheet.html'), sheet(report));
  console.log('');
  process.stdout.write(markdown(report));
  console.log('\ncontact sheet -> ' + path.join(opt.out, 'sheet.html'));
  const bad = runs.reduce((n, r) => n + r.warnings.filter(w => w.level === 'fail').length, 0);
  cleanup();
  /* exit once stdout has drained — a bare process.exit() drops piped output */
  process.stdout.write('', () => process.exit(opt.strict && bad ? 1 : 0));
})().catch(e => { console.error('beat-capture failed: ' + e.message); process.exit(1); });

/* ── analysis ─────────────────────────────────────────────────────────────── */
function analyse(tag, W, H, info, S, shots) {
  const map = info.map, total = S[S.length - 1].total || S[0].total;
  const names = S[0].parts.map(p => p.name);
  const isStage = n => !/^line:/.test(n);
  const visible = (pt, vw, vh) => pt.o > 0.02 && pt.w > 1 && pt.h > 1 &&
    pt.x < vw && pt.x + pt.w > 0 && pt.y < vh && pt.y + pt.h > 0;

  /* per step: who moved, how far, and did the screen change */
  const steps = [];
  for (let i = 1; i < S.length; i++) {
    const a = S[i - 1], b = S[i], movers = [];
    let dom = 0;
    for (let k = 0; k < b.parts.length; k++) {
      const pa = a.parts[k], pb = b.parts[k]; if (!pa || !pb) continue;
      const d = Math.abs(pb.x - pa.x) + Math.abs(pb.y - pa.y) + Math.abs(pb.w - pa.w) + Math.abs(pb.h - pa.h) + 60 * Math.abs(pb.o - pa.o);
      /* a part that is invisible on both sides of the step is not motion anyone sees */
      if (d > MOVE_PX && (visible(pa, a.vw, a.vh) || visible(pb, b.vw, b.vh))) movers.push(pb.name);
      dom = Math.max(dom, d);
    }
    steps.push({ q0: a.q, q1: b.q, p0: a.p, p1: b.p, movers, dom, energy: b.energy,
      moving: movers.length > 0 || b.changed >= PIX_MIN });
  }

  /* per part: when it moves, and when it can be seen */
  const parts = names.map((name, k) => {
    const moves = [], vis = [];
    steps.forEach(st => { if (st.movers.includes(name)) moves.push([st.q0, st.q1, st.p0, st.p1]); });
    S.forEach(s => { const pt = s.parts[k]; if (pt && visible(pt, s.vw, s.vh)) vis.push([s.q, s.p]); });
    return { name, stage: isStage(name), moving: merge(moves), visible: mergeVis(vis, opt.step) };
  });

  /* still stretches, classified against the beat map */
  const still = [];
  let run = null;
  steps.forEach(st => {
    if (!st.moving) { if (!run) run = { q0: st.q0, p0: st.p0, n: 0 }; run.q1 = st.q1; run.p1 = st.p1; run.n++; }
    else if (run) { still.push(run); run = null; }
  });
  if (run) still.push(run);
  const boundaries = map.slice(1).map(b => b.span[0]);
  const VH = S[0].vh;
  const stills = still.filter(r => r.n >= 2).map(r => {
    const px = Math.round((r.q1 - r.q0) * total), screens = +(px / VH).toFixed(2);
    const beat = map.find(b => r.p0 >= b.span[0] - 1e-6 && r.p0 < b.span[1]) || map[map.length - 1];
    const leadsIntoHandoff = boundaries.some(bd => bd - r.p1 >= -1e-6 && bd - r.p1 <= info.fade + opt.step * 2);
    /* WHERE it is names it; HOW LONG it is judges it */
    const where = r.q1 >= 0.999 ? 'end hold' : leadsIntoHandoff ? 'rest before hand-off' : 'hold mid-beat';
    let kind = where, level = 'ok';
    if (screens >= STILL_FAIL) { kind = 'dead stretch (' + where + ') — cut candidate'; level = 'fail'; }
    else if (screens >= STILL_WARN) { kind = 'long ' + where + ' — consider a cut'; level = 'warn'; }
    return { q: [r.q0, r.q1], p: [r.p0, r.p1], px, screens, beat: beat.name, kind, level };
  });

  /* per beat: timing and composition */
  const beats = map.map(b => {
    const inside = steps.filter(st => (st.q0 + st.q1) / 2 >= b.qStart && (st.q0 + st.q1) / 2 < b.qEnd);
    const moved = inside.filter(st => st.moving).length;
    const restFrom = b.span[0] + (b.span[1] - b.span[0]) * info.rest;
    const restWin = [restFrom, b.span[1] - info.fade];
    const late = new Set();
    inside.forEach(st => { if (st.p0 >= restWin[0] && st.p1 <= restWin[1]) st.movers.filter(isStage).forEach(n => late.add(n)); });
    /* a beat RESTS if its composition holds still somewhere in its back half —
       the moment the reader takes it in before the next one starts */
    const half = b.span[0] + (b.span[1] - b.span[0]) * 0.5;
    /* a too-long hold still counts as a rest: it is already reported as a
       dead stretch, and "never rests" on top of it would point the wrong way */
    const myStills = stills.filter(s => s.beat === b.name && s.p[1] > half);
    const rest = myStills.length ? myStills[myStills.length - 1] : null;
    const movers = parts.filter(pt => pt.moving.some(m => m[3] > b.span[0] && m[2] < b.span[1])).map(pt => pt.name);
    const mid = shots.find(s => s.beat === b.i && s.label === 'mid');
    return { i: b.i, name: b.name, span: b.span, q: [b.qStart, b.qEnd],
      scrollPx: Math.round((b.qEnd - b.qStart) * total),
      motionPct: inside.length ? Math.round(100 * moved / inside.length) : 0,
      rest: rest ? { p: rest.p, px: rest.px, kind: rest.kind } : null,
      movingIntoHandoff: [...late], movers, composition: mid ? compose(mid.m) : null };
  });

  /* the narrator must never show two blocks at once: any frame where more than
     one line:* part has text visible is an overlap */
  const overlaps = [];
  S.forEach(s => {
    const on = s.parts.filter(pt => /^line:/.test(pt.name) && pt.o > 0.02).map(pt => pt.name);
    if (on.length > 1) overlaps.push({ p: s.p, on });
  });
  const warnings = [];
  if (overlaps.length) warnings.push({ level: 'fail', text: 'narrator blocks overlap in ' + overlaps.length +
    ' frame(s), first at p ' + overlaps[0].p.toFixed(3) + ': ' + overlaps[0].on.join(' + ') });
  stills.filter(s => s.level !== 'ok').forEach(s => warnings.push({ level: s.level,
    text: s.kind + ' in "' + s.beat + '": p ' + s.p[0].toFixed(3) + '–' + s.p[1].toFixed(3) + ' — ' + s.px + 'px (' + s.screens + ' screens) of scroll with nothing changing' }));
  beats.forEach(b => {
    if (b.motionPct < 5) warnings.push({ level: 'fail', text: '"' + b.name + '" barely moves (' + b.motionPct + '% of its scroll) — merge it or give it a move' });
    if (!b.rest && b.i < beats.length - 1) warnings.push({ level: 'warn', text: '"' + b.name + '" never rests before its hand-off' +
      (b.movingIntoHandoff.length ? ' — still moving: ' + b.movingIntoHandoff.join(', ') : '') });
    const c = b.composition; if (!c) return;
    if (c.clipped.length) warnings.push({ level: 'fail', text: '"' + b.name + '" at rest clips: ' + c.clipped.join(', ') });
    if (c.intoText.length) warnings.push({ level: 'fail', text: '"' + b.name + '" at rest runs into the text: ' + c.intoText.join(', ') });
    if (Math.abs(c.dxPct) > 8) warnings.push({ level: 'warn', text: '"' + b.name + '" at rest sits ' + c.dxPct + '% of the width off-centre (' + c.dx + 'px)' });
    if (W < 700 && c.fill < 0.45) warnings.push({ level: 'warn', text: '"' + b.name + '" at rest fills only ' + Math.round(c.fill * 100) + '% of a phone\'s width — the camera may be pulling back too far' });
  });
  return { tag, w: W, h: H, total, fade: info.fade, rest: info.rest, cut: info.cut, layout: S[0].layout,
    beats, parts, stills, warnings, shots: shots.map(s => ({ beat: s.beat, name: s.name, label: s.label, p: s.p, file: s.file, parts: s.m.parts, vw: s.m.vw, vh: s.m.vh, scale: s.m.scale })),
    timeline: steps.map(st => [+st.q0.toFixed(4), +st.p0.toFixed(4), +st.energy.toFixed(4), st.moving ? 1 : 0]) };

  function compose(m) {
    const vis = m.parts.filter(pt => isStage(pt.name) && visible(pt, m.vw, m.vh) && pt.o > 0.05);
    if (!vis.length) return null;
    const L = Math.min(...vis.map(v => v.x)), R = Math.max(...vis.map(v => v.x + v.w));
    const T = Math.min(...vis.map(v => v.y)), B = Math.max(...vis.map(v => v.y + v.h));
    const st = m.stage || { x: 0, w: m.vw };
    const dx = Math.round((L + R) / 2 - (st.x + st.w / 2));
    /* overlap with the text column, in px — 2px of tolerance for shadows */
    const t = m.text, hit = t ? vis.filter(v => v.x < t.x + t.w - 2 && v.x + v.w > t.x + 2 && v.y < t.y + t.h - 2 && v.y + v.h > t.y + 2).map(v => v.name) : [];
    return { box: [Math.round(L), Math.round(T), Math.round(R - L), Math.round(B - T)], dx, dxPct: +(100 * dx / st.w).toFixed(1),
      fill: +((R - L) / st.w).toFixed(2), scale: +m.scale.toFixed(3),
      clipped: vis.filter(v => v.x < -1 || v.x + v.w > m.vw + 1).map(v => v.name), intoText: hit };
  }
}
function merge(segs) {
  const out = [];
  for (const s of segs) { const last = out[out.length - 1];
    if (last && s[0] - last[1] < 1e-6) { last[1] = s[1]; last[3] = s[3]; } else out.push(s.slice()); }
  return out.map(s => s.map(v => +v.toFixed(4)));
}
function mergeVis(pts, step) {
  const out = [];
  for (const [q, p] of pts) { const last = out[out.length - 1];
    if (last && q - last[1] <= step * 1.5) { last[1] = q; last[3] = p; } else out.push([q, q, p, p]); }
  return out.map(s => s.map(v => +v.toFixed(4)));
}

/* ── output ───────────────────────────────────────────────────────────────── */
function markdown(rep) {
  const L = ['# beat-capture — ' + rep.url, '',
    'step ' + rep.step + ' of scroll · CSS animations ' + (rep.frozenAnimations ? 'frozen' : 'live'), ''];
  for (const r of rep.runs) {
    L.push('## ' + r.tag + '  —  layout ' + r.layout + '  ·  deck scroll ' + r.total + 'px' + (r.cut ? '  ·  cut p ' + r.cut.join('–') : ''), '');
    L.push('| beat | story p | scroll px | moving | rest before hand-off | at rest: offset · fill · camera |');
    L.push('|---|---|---|---|---|---|');
    for (const b of r.beats) {
      const c = b.composition;
      L.push('| ' + b.i + ' ' + b.name + ' | ' + b.span[0].toFixed(2) + '–' + b.span[1].toFixed(2) + ' | ' + b.scrollPx + ' | ' + b.motionPct + '% | ' +
        (b.rest ? b.rest.px + 'px · ' + (b.rest.px / r.h).toFixed(2) + ' scr (' + b.rest.kind + ')' : (b.i === r.beats.length - 1 ? 'end of deck' : '**none**')) + ' | ' +
        (c ? (c.dx >= 0 ? '+' : '') + c.dx + 'px · ' + Math.round(c.fill * 100) + '% · ' + c.scale : '—') + ' |');
    }
    L.push('', '**Who moves when** (story p):', '');
    for (const pt of r.parts) {
      if (!pt.moving.length && !pt.visible.length) continue;
      L.push('- `' + pt.name + '` moves ' + (pt.moving.length ? pt.moving.map(m => m[2].toFixed(3) + '–' + m[3].toFixed(3)).join(', ') : 'never') +
        ' · visible ' + (pt.visible.length ? pt.visible.map(v => v[2].toFixed(3) + '–' + v[3].toFixed(3)).join(', ') : 'never'));
    }
    L.push('');
    if (r.warnings.length) r.warnings.forEach(w => L.push((w.level === 'fail' ? 'FAIL  ' : 'WARN  ') + w.text));
    else L.push('OK  every beat moves, rests and hands off; nothing clipped at rest');
    L.push('');
  }
  return L.join('\n');
}

function sheet(rep) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>beat-capture sheet</title><style>
body{margin:0;padding:24px;background:#f3f3f0;color:#1f1f1d;font:13px/1.45 ui-monospace,Menlo,monospace;
  background-image:radial-gradient(#cfcfc8 1px,transparent 1.3px);background-size:16px 16px}
h1{font-size:15px;margin:0 0 4px} h2{font-size:14px;margin:34px 0 10px;padding-top:14px;border-top:1.5px dashed #a6a69e}
.w{margin:2px 0} .fail{color:#b3261e} .warn{color:#8a5a00} .ok{color:#2d6a2d}
.row{display:flex;gap:10px;margin:10px 0 18px;align-items:flex-start}
.row>b{width:110px;flex:none;padding-top:4px}
figure{margin:0;position:relative;border:1.5px dashed #a6a69e;background:#fff}
figure img{display:block} figure svg{position:absolute;inset:0;pointer-events:none}
figcaption{padding:4px 6px;font-size:11px;color:#77776f;border-top:1.5px dashed #a6a69e}
.tl{background:#fbfbf9;border:1.5px dashed #a6a69e;margin:6px 0 4px}
label{user-select:none;cursor:pointer}
.nobox figure svg{display:none}
</style></head><body>
<h1>beat-capture — ${esc(rep.url)}</h1>
<div>step ${rep.step} · animations ${rep.frozenAnimations ? 'frozen' : 'live'} ·
<label><input type="checkbox" id="bx" checked> part boxes</label></div>
<div id="app"></div>
<script>
const R = ${JSON.stringify(rep)};
const app = document.getElementById('app');
document.getElementById('bx').onchange = e => document.body.classList.toggle('nobox', !e.target.checked);
const h = (t, a, k) => { const e = document.createElement(t); if (a) Object.assign(e, a); (k || []).forEach(c => e.append(c)); return e; };
const NS = 'http://www.w3.org/2000/svg';
const s = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
for (const r of R.runs) {
  app.append(h('h2', { textContent: r.tag + ' — ' + r.total + 'px of scroll' }));
  (r.warnings.length ? r.warnings : [{ level: 'ok', text: 'every beat moves, rests and hands off; nothing clipped at rest' }])
    .forEach(w => app.append(h('div', { className: 'w ' + w.level, textContent: (w.level === 'ok' ? 'OK ' : w.level.toUpperCase() + ' ') + w.text })));
  /* the timeline: beats, screen change, and one lane per part */
  const lanes = r.parts.filter(p => p.moving.length || p.visible.length);
  const W = 1000, top = 34, lane = 13, H = top + 46 + lanes.length * lane + 8, X = q => 120 + q * (W - 130);
  const svg = s('svg', { width: W, height: H, class: 'tl', viewBox: '0 0 ' + W + ' ' + H });
  r.beats.forEach((b, i) => {
    svg.append(s('rect', { x: X(b.q[0]), y: 0, width: X(b.q[1]) - X(b.q[0]), height: H, fill: i % 2 ? '#efefea' : '#fbfbf9' }));
    const t = s('text', { x: X(b.q[0]) + 4, y: 14, 'font-size': 11, fill: '#1f1f1d' }); t.textContent = (i + 1) + ' ' + b.name + '  ' + b.scrollPx + 'px'; svg.append(t);
    const t2 = s('text', { x: X(b.q[0]) + 4, y: 27, 'font-size': 10, fill: '#77776f' }); t2.textContent = 'moving ' + b.motionPct + '%'; svg.append(t2);
  });
  r.stills.forEach(st => svg.append(s('rect', { x: X(st.q[0]), y: top, width: Math.max(1, X(st.q[1]) - X(st.q[0])), height: H - top,
    fill: st.level === 'fail' ? 'rgba(179,38,30,.16)' : st.level === 'warn' ? 'rgba(138,90,0,.14)' : 'rgba(45,106,45,.08)' })));
  const lab = s('text', { x: 4, y: top + 30, 'font-size': 10, fill: '#77776f' }); lab.textContent = 'screen change'; svg.append(lab);
  const mx = Math.max(0.01, ...r.timeline.map(t => t[2]));
  let d = ''; r.timeline.forEach((t, i) => { d += (i ? 'L' : 'M') + X(t[0]).toFixed(1) + ' ' + (top + 40 - 36 * t[2] / mx).toFixed(1); });
  svg.append(s('path', { d, fill: 'none', stroke: '#1f1f1d', 'stroke-width': 1.2 }));
  lanes.forEach((p, k) => {
    const y = top + 48 + k * lane;
    const t = s('text', { x: 4, y: y + 9, 'font-size': 10, fill: p.stage ? '#1f1f1d' : '#77776f' }); t.textContent = p.name.slice(0, 18); svg.append(t);
    p.visible.forEach(v => svg.append(s('rect', { x: X(v[0]), y: y + 2, width: Math.max(1, X(v[1]) - X(v[0])), height: 8, fill: '#dcdcd6' })));
    p.moving.forEach(m => svg.append(s('rect', { x: X(m[0]), y: y + 2, width: Math.max(1.5, X(m[1]) - X(m[0])), height: 8, fill: '#1f1f1d' })));
  });
  app.append(svg, h('div', { textContent: 'x = reader scroll · grey = visible · black = moving · green/amber/red band = rest / long rest / dead stretch', style: 'color:#77776f;font-size:11px' }));
  /* the stills: every beat's in / mid / out, part boxes overlaid */
  const TW = r.w >= 1000 ? 300 : r.w >= 700 ? 230 : 170;
  r.beats.forEach(b => {
    const row = h('div', { className: 'row' }, [h('b', { textContent: (b.i + 1) + ' ' + b.name })]);
    r.shots.filter(x => x.beat === b.i).forEach(x => {
      const k = TW / x.vw, ht = Math.round(x.vh * k);
      const ov = s('svg', { width: TW, height: ht });
      x.parts.filter(pt => pt.o > 0.05 && !/^line:/.test(pt.name)).forEach(pt => {
        ov.append(s('rect', { x: pt.x * k, y: pt.y * k, width: pt.w * k, height: pt.h * k, fill: 'none', stroke: '#b3261e', 'stroke-width': 1, 'stroke-dasharray': '3 2' }));
        const t = s('text', { x: pt.x * k + 2, y: pt.y * k + 9, 'font-size': 8, fill: '#b3261e' }); t.textContent = pt.name; ov.append(t);
      });
      const cap = x.label + ' · p ' + x.p.toFixed(3) + ' · camera ' + x.scale.toFixed(2);
      /* fixed to the thumbnail's width: a caption wider than a phone still
         would otherwise stretch the frame and show a white strip beside it */
      row.append(h('figure', { style: 'width:' + TW + 'px' }, [h('a', { href: x.file, target: '_blank' }, [h('img', { src: x.file, width: TW, height: ht })]), ov, h('figcaption', { textContent: cap })]));
    });
    app.append(row);
  });
}
</script></body></html>`;
}
function esc(t) { return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
