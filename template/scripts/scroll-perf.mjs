// scroll-perf — is the deck SMOOTH, in Safari's engine as well as Chrome's?
//
// The other harnesses prove a deck is correct at a moment. This one proves it
// is smooth BETWEEN moments: it scrolls the whole deck the way a person does
// (real wheel input, so the browser's own scrolling machinery runs), in WebKit
// and Chromium, on a desktop and an emulated iPhone, and measures
//
//   frames       frame intervals while scrolling: p50 / p95 / % over 25ms
//                (a dropped frame) and the worst gap
//   JS per frame time spent in every requestAnimationFrame callback — the
//                engine's read + draw — p95 and worst
//   stale        frames drawn with an OLD scroll position: the page has
//                scrolled on but the stage has not caught up. This is the
//                "swimming"/"jumpy" feel: content lagging the thumb.
//   toolbar jump the iPhone address bar showing/hiding resizes the viewport
//                mid-scroll. A deck that derives its geometry from the
//                viewport's height snaps when that happens. We resize by 70px
//                mid-scroll and measure how far the story jumped.
//
// Headless numbers are not a phone's numbers — a real iPhone is slower. Read
// them RELATIVELY: a budget per frame, a regression between runs, one engine
// against the other. Then scroll the published page on a real phone.
//
// One-time setup (any folder):
//   npm i playwright && npx playwright install webkit chromium
// Run (with a server on the scroll/ folder: python3 -m http.server 8769):
//   NODE_PATH=$(npm root) node scripts/scroll-perf.mjs [url] [--only webkit] [--quick]
//
// Exit code 1 if any run fails a deck-attributable budget (JS per frame, stale
// frames, toolbar jump). Frame pacing over budget is a WARN: in headless it
// tracks the machine's load as much as the deck.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); }
catch (e) {
  console.error('Playwright not found. One-time setup:\n  npm i playwright && npx playwright install webkit chromium\n' +
    'then run with NODE_PATH pointing at that folder\'s node_modules, e.g.\n  NODE_PATH=$(npm root) node scripts/scroll-perf.mjs');
  process.exit(2);
}

const args = process.argv.slice(2);
const url = args.find(a => !a.startsWith('--')) || 'http://localhost:8769/gallery.html';
const only = (args[args.indexOf('--only') + 1] || '').split(',').filter(Boolean);
const quick = args.includes('--quick');

/* budgets — generous for headless, strict enough to catch real trouble */
const BUDGET = { p95Frame: 26, dropPct: 8, jsP95: 6, staleMax: 2, jumpMax: 0.01 };

const RUNS = [
  { name: 'webkit  · desktop 1440', engine: 'webkit', ctx: { viewport: { width: 1440, height: 900 } } },
  { name: 'webkit  · iPhone 14',   engine: 'webkit', ctx: 'iPhone 14' },
  { name: 'chromium· desktop 1440', engine: 'chromium', ctx: { viewport: { width: 1440, height: 900 } } },
  { name: 'chromium· iPhone 14',   engine: 'chromium', ctx: 'iPhone 14' }
].filter(r => !only.length || only.includes(r.engine));

/* in-page: time every rAF callback (the engine runs inside one), and record
   each frame's scroll position next to the story position the stage shows */
const INIT = `(() => {
  const rec = window.__perf = { frames: [], js: [] };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(t => { const a = performance.now(); try { cb(t); } finally { rec.js.push(performance.now() - a); } });
  const tick = t => {
    const d = window.deck;
    if (d && d.frame) {
      const deckTop = d.deck.getBoundingClientRect().top + scrollY;
      const pinH = (d.pin && d.pin.offsetHeight) || innerHeight;
      const total = d.deck.offsetHeight - pinH;
      const qNow = total > 0 ? Math.min(1, Math.max(0, (scrollY - deckTop) / total)) : 0;
      rec.frames.push({ t, y: scrollY, q: d.frame.q, qNow, p: d.frame.p });
    }
    raf(tick);
  };
  raf(tick);
})()`;

const pct = (arr, q) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

async function run(R) {
  const browser = await pw[R.engine].launch();
  const ctxOpts = typeof R.ctx === 'string' ? { ...pw.devices[R.ctx] } : R.ctx;
  if (R.engine === 'chromium' && typeof R.ctx === 'string') delete ctxOpts.defaultBrowserType;
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  await page.addInitScript(INIT);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.deck && window.deck.frame, null, { timeout: 15000 });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(500);

  const geo = await page.evaluate(() => {
    const d = window.deck, top = d.deck.getBoundingClientRect().top + scrollY;
    return { top, height: d.deck.offsetHeight, vh: innerHeight };
  });
  /* start just above the deck, scroll through to just past it */
  await page.evaluate(y => { document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, y); }, Math.max(0, geo.top - 40));
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__perf.frames.length = 0; window.__perf.js.length = 0; });

  const distance = (quick ? 0.4 : 1) * (geo.height - geo.vh) + 80;
  const STEP = 40;                       /* px per wheel event, ~ a brisk trackpad */
  const steps = Math.ceil(distance / STEP);
  let jump = null;
  const vp = page.viewportSize();
  /* Mobile WebKit takes no wheel input, so phones are driven by scrollBy,
     paced to the display: one step per animation frame, as a finger fling
     delivers. Desktop gets real wheel events through the browser. */
  const touch = !!(ctxOpts.isMobile || ctxOpts.hasTouch);
  for (let i = 0; i < steps; i++) {
    /* scrollBy from a TIMER, not from inside requestAnimationFrame: real
       touch scrolling lands before the frame's rAF callbacks, so the engine
       draws it the same frame. Scrolling from inside rAF delays every scroll
       event a frame and reads as 97% "stale" — the harness's lag, not the
       deck's. */
    if (touch) await page.evaluate(s => new Promise(r => setTimeout(() => { scrollBy(0, s); r(); }, 16)), STEP);
    else { await page.mouse.move(vp.width / 2, vp.height / 2); await page.mouse.wheel(0, STEP); await page.waitForTimeout(16); }
    /* the address bar collapsing, mid-scroll: viewport 70px taller */
    if (i === Math.floor(steps * 0.45)) {
      const before = await page.evaluate(() => window.deck.frame.p);
      await page.setViewportSize({ width: vp.width, height: vp.height + 70 });
      await page.waitForTimeout(120);
      const after = await page.evaluate(() => window.deck.frame.p);
      await page.setViewportSize(vp);
      await page.waitForTimeout(120);
      const back = await page.evaluate(() => window.deck.frame.p);
      jump = Math.max(Math.abs(after - before), Math.abs(back - after));
    }
  }
  await page.waitForTimeout(400);
  const rec = await page.evaluate(() => window.__perf);
  const engineStats = await page.evaluate(() => window.deck.perf ? window.deck.perf() : null);
  await browser.close();

  const F = rec.frames;
  const gaps = [];
  for (let i = 1; i < F.length; i++) gaps.push(F[i].t - F[i - 1].t);
  /* stale: the stage shows a different scroll position than the page has.
     Judged a frame LATER (the engine draws in the frame after a scroll), so
     only lag that persists past one frame counts. */
  let stale = 0, moving = 0;
  for (let i = 2; i < F.length; i++) {
    if (Math.abs(F[i].y - F[i - 1].y) < 0.5) continue;
    moving++;
    if (Math.abs(F[i - 1].q - F[i - 2].qNow) > 0.002 && Math.abs(F[i].q - F[i - 1].qNow) > 0.002) stale++;
  }
  const res = {
    name: R.name, frames: F.length,
    p50: pct(gaps, 0.5), p95: pct(gaps, 0.95), drop: gaps.length ? 100 * gaps.filter(g => g > 25).length / gaps.length : 0,
    worst: gaps.length ? Math.max(...gaps) : 0,
    jsP95: pct(rec.js, 0.95), jsMax: rec.js.length ? Math.max(...rec.js) : 0,
    stale: moving ? 100 * stale / moving : 0, jump, engine: engineStats
  };
  /* FAIL only on what the DECK causes, deterministically: its JS per frame,
     frames that lag the scroll, the toolbar jump. Frame PACING in headless —
     emulated iPhone WebKit especially — swings with the machine's load: the
     untouched gallery measured p95 22ms, then 32ms, minutes apart, with its JS
     at a steady 1ms. Failing on that fails good decks at random, so pacing
     WARNS, and a real phone is the authority on it. */
  res.fail = []; res.warn = [];
  if (res.p95 > BUDGET.p95Frame) res.warn.push('p95 frame ' + res.p95.toFixed(1) + 'ms');
  if (res.drop > BUDGET.dropPct) res.warn.push(res.drop.toFixed(1) + '% dropped frames');
  if (res.jsP95 > BUDGET.jsP95) res.fail.push('JS p95 ' + res.jsP95.toFixed(2) + 'ms/frame');
  if (res.stale > BUDGET.staleMax) res.fail.push(res.stale.toFixed(1) + '% stale frames');
  if (res.jump !== null && res.jump > BUDGET.jumpMax) res.fail.push('toolbar resize jumped the story by ' + res.jump.toFixed(3));
  return res;
}

let bad = 0;
console.log('scroll-perf  ' + url + (quick ? '  (quick)' : ''));
console.log('budgets: p95 frame ≤ ' + BUDGET.p95Frame + 'ms · dropped ≤ ' + BUDGET.dropPct + '% · JS p95 ≤ ' + BUDGET.jsP95 +
  'ms · stale ≤ ' + BUDGET.staleMax + '% · toolbar jump ≤ ' + BUDGET.jumpMax + ' of story\n');
for (const R of RUNS) {
  let r;
  try { r = await run(R); } catch (e) { console.log('ERROR  ' + R.name + ': ' + e.message.split('\n')[0]); bad++; continue; }
  if (r.fail.length) bad++;
  console.log((r.fail.length ? 'FAIL  ' : r.warn.length ? 'WARN  ' : 'PASS  ') + r.name.padEnd(24) +
    'frames ' + String(r.frames).padStart(4) + ' · p50 ' + r.p50.toFixed(1) + ' p95 ' + r.p95.toFixed(1) + 'ms · dropped ' + r.drop.toFixed(1) + '%' +
    ' · JS p95 ' + r.jsP95.toFixed(2) + ' max ' + r.jsMax.toFixed(1) + 'ms · stale ' + r.stale.toFixed(1) + '%' +
    ' · toolbar jump ' + (r.jump === null ? '—' : r.jump.toFixed(4)) +
    (r.engine ? ' · engine p95 ' + r.engine.p95.toFixed(2) + ' max ' + r.engine.max.toFixed(1) + 'ms' : ''));
  if (r.fail.length) console.log('      ' + r.fail.join(' · '));
  if (r.warn.length) console.log('      pacing: ' + r.warn.join(' · ') + ' — headless pacing varies with machine load; ' +
    (r.jsP95 <= BUDGET.jsP95 ? 'the deck\'s own JS is within budget, so re-run, and judge pacing on a real phone' : 'and the JS is heavy too, so start there'));
}
/* exit only once stdout has drained: process.exit() straight after console.log
   drops whatever is still in flight to a PIPE, and the whole report vanished
   whenever this was piped into grep or tail */
process.stdout.write('', () => process.exit(bad ? 1 : 0));
