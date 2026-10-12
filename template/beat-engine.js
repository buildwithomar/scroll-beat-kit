/* beat-engine.js — a scroll-driven beat sequencer for one pinned stage.
 *
 * WHAT IT IS FOR
 * A "beat deck" is a tall element whose scroll drives a sticky stage through a
 * fixed sequence of beats: a thing assembles, gains parts, splits, resolves.
 * The reader's scroll IS the timeline — no autoplay, no snapping, no anchors,
 * and scrubbing backwards must undo everything exactly.
 *
 * WHAT IT OWNS (so authors cannot get it wrong)
 *   1. story time      — scroll fraction q -> story p, with an optional dead
 *                        stretch skipped, and the deck's height derived from
 *                        the same numbers so the two can never drift apart.
 *   2. read/draw split — all layout reads happen in read(), all style writes in
 *                        draw(). A read after a write forces a synchronous
 *                        layout; three of those per frame is what turns a
 *                        60fps deck into a 20fps one.
 *   3. one scale       — the stage is composed at ONE reference width and
 *                        scaled to fit. Beats are never re-choreographed per
 *                        breakpoint, so a phone gets the same performance a
 *                        desktop does. scale() runs before draw() and its value
 *                        is handed to draw(), so fit math can account for it.
 *   4. the HUD         — ?beatdbg=1 puts the beat map, story time and every
 *                        value the author notes on screen, with [ and ] to jump
 *                        between beats. This replaces scribbling temporary
 *                        calculations into the page and forgetting to remove
 *                        them.
 *   5. rAF coalescing, passive listeners, resize/font reflow, and a static
 *                        fallback for prefers-reduced-motion.
 *
 * USAGE
 *   var deck = BeatScroll.create({
 *     deck: '.bs-deck', pin: '.bs-pin', stage: '.bs-stage',
 *     story: { vh: 800, at: [{ maxWidth: 900, vh: 700 }] },
 *     cut:  [0.50, 0.64],
 *     beats: [
 *       { name: 'assemble', span: [0.00, 0.30] },
 *       { name: 'equip',    span: [0.30, 0.60] },
 *       { name: 'resolve',  span: [0.60, 1.00] }
 *     ],
 *     scale: function (f, m) { return Math.min(1, m.stageW / 1100); },
 *     read:  function (f) { return { cardW: card.offsetWidth }; },
 *     draw:  function (f, m) {
 *       f.set('real', f.ramp(0.05, 0.14));
 *       f.px('sep', m.cardW * 0.62 * f.ease(f.inner('equip')));
 *       f.note('sep budget', m.cardW * 0.62);
 *     }
 *   });
 *
 * Every number in beats/cut/ramp() is STORY time p, never scroll fraction q.
 * Anything outside this file that seeks by scroll (test harnesses, deep links)
 * works in q and must convert — use api.toQ(p) / api.seekP(p).
 *
 * No dependencies. ES5 on purpose: these decks get inlined into single-file
 * pages and pasted into hosts that do not transpile.
 */
(function (global) {
  'use strict';

  /* ── small maths, shared with authors via the frame object ───────────────── */
  function clamp(v, a, b) {
    if (a === undefined) a = 0;
    if (b === undefined) b = 1;
    return v < a ? a : (v > b ? b : v);
  }
  /* in-out quad: the default for anything that travels. Linear travel reads as
     mechanical at these durations; a symmetric ease reads as weight. */
  function ease(v) { return v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2; }
  /* out-quad: for anything ALREADY MOVING at the first pixel of scroll that has
     to settle — intros especially. An in-out curve there reads as a hesitation
     before the page responds to the reader. */
  function easeOut(v) { return 1 - (1 - v) * (1 - v); }
  /* cubic pair for the row relay: an out-cubic arrival is what reads as
     "snappy" (most of the move in the first third), and its in-cubic mirror
     lets a leaving row linger a beat before it goes */
  function easeOutCubic(v) { return 1 - Math.pow(1 - v, 3); }
  function easeInCubic(v) { return v * v * v; }
  function ramp01(v, a, b) { return b === a ? (v >= b ? 1 : 0) : clamp((v - a) / (b - a)); }
  /* a trapezoid: rises a->b, holds at 1, falls c->d. Presence is built from it. */
  function win(v, a, b, c, d) { return Math.min(ramp01(v, a, b), 1 - ramp01(v, c, d)); }

  function pick(sel, root) {
    if (!sel) return null;
    if (typeof sel !== 'string') return sel;
    return (root || document).querySelector(sel);
  }

  function create(cfg) {
    var deck  = pick(cfg.deck);
    var pin   = pick(cfg.pin) || deck;
    var stage = pick(cfg.stage) || pin;
    if (!deck || !cfg.beats || !cfg.beats.length) {
      /* A missing deck is not worth throwing over — these pages are often
         published as fragments, and a hard throw takes the rest of the page's
         scripts down with it. */
      if (global.console) console.warn('[beat-scroll] no deck or no beats; engine idle');
      return null;
    }

    var beats  = cfg.beats;
    var n      = beats.length;
    var cut    = cfg.cut && cfg.cut.length === 2 ? cfg.cut : null;
    var cutLen = cut ? Math.max(0, cut[1] - cut[0]) : 0;
    var FADE   = cfg.fade === undefined ? 0.030 : cfg.fade;
    var REST   = cfg.rest === undefined ? 0.78  : cfg.rest;
    /* the relay's window on EACH side of a boundary: the outgoing block exits
       across [b - RELAY, b], the incoming one enters across [b, b + RELAY] */
    var RELAY  = cfg.relay;
    if (RELAY === undefined) {
      /* the brand can set it: --bs-relay in brand.css */
      var tokR = parseFloat(getComputedStyle(pin).getPropertyValue('--bs-relay'));
      RELAY = isNaN(tokR) ? 0.032 : tokR;
    }
    var LAST   = n - 1;
    var byName = {};
    var i;
    for (i = 0; i < n; i++) if (beats[i].name) byName[beats[i].name] = i;

    /* ── the beat map is checked, not trusted ──────────────────────────────
       Gaps and overlaps in the map are the commonest source of "the animation
       stalls for a moment" and "two lines are on screen at once". They are
       invisible in the code and obvious here. */
    var problems = [];
    if (Math.abs(beats[0].span[0]) > 1e-9) problems.push('first beat does not start at 0 (' + beats[0].span[0] + ')');
    if (Math.abs(beats[LAST].span[1] - 1) > 1e-9) problems.push('last beat does not end at 1 (' + beats[LAST].span[1] + ')');
    for (i = 0; i < n; i++) {
      if (beats[i].span[1] <= beats[i].span[0]) problems.push('beat ' + i + ' (' + (beats[i].name || '?') + ') has a non-positive span');
      if (i && Math.abs(beats[i].span[0] - beats[i - 1].span[1]) > 1e-9)
        problems.push('gap/overlap between beat ' + (i - 1) + ' and ' + i + ': ' + beats[i - 1].span[1] + ' -> ' + beats[i].span[0]);
    }
    if (cut && cutLen > 0) {
      var inside = false;
      for (i = 0; i < n; i++) if (cut[0] >= beats[i].span[0] && cut[1] <= beats[i].span[1]) inside = true;
      if (!inside) problems.push('cut [' + cut[0] + ',' + cut[1] + '] straddles a beat boundary — it must sit inside ONE beat\'s dead stretch');
    }
    if (problems.length && global.console)
      console.warn('[beat-scroll] beat map problems:\n  ' + problems.join('\n  '));

    /* ── story time ────────────────────────────────────────────────────────
       q is what the reader does (0..1 of the pinned scroll); p is where we are
       in the story. They differ only across the cut: a stretch of story time
       in which nothing moves is skipped, so the reader never pushes through
       dead scroll. It is done here rather than by re-timing every beat, because
       dozens of literal thresholds hang off these numbers and re-deriving them
       by hand is exactly how timing bugs get in. */
    function storyP(qq) {
      var u = qq * (1 - cutLen);
      return !cut || u < cut[0] ? u : u + cutLen;
    }
    /* the inverse, for harnesses and deep links that only know scroll */
    function scrollQ(pp) {
      if (!cut || pp <= cut[0]) return pp / (1 - cutLen);
      return (pp - cutLen) / (1 - cutLen);
    }

    /* ── the deck's height is DERIVED, never typed ─────────────────────────
       Pinned scroll = height - one screen, and the engine skips cutLen of the
       story, so the height must be one screen + story.vh × (1 − cutLen) for
       every beat outside the cut to keep the scroll length it was designed
       with. "One screen" is the LOCKED viewport height, in pixels (below). Typing 788vh into a
       stylesheet and later changing the cut silently re-times the whole
       sequence; deriving it makes that impossible.

       story.at lets short viewports carry less scroll: the same beats, fewer
       pixels of thumb-work, which is what keeps a phone feeling as brisk as a
       desktop rather than three times as long. */
    function storyVh() {
      var base = (cfg.story && cfg.story.vh) || 700;
      var at = (cfg.story && cfg.story.at) || [];
      var vwNow = global.innerWidth, best = base, bestW = Infinity;
      for (var k = 0; k < at.length; k++)
        if (vwNow <= at[k].maxWidth && at[k].maxWidth < bestW) { best = at[k].vh; bestW = at[k].maxWidth; }
      return best;
    }
    /* ── the viewport height is LOCKED, not read live ─────────────────────
       A phone's address bar slides away as the reader scrolls, changing the
       viewport's height by 50–110px mid-scroll. A deck sized in vh and mapped
       through innerHeight re-maps the whole story every time that happens:
       measured, it snapped the story 3–5% — hundreds of pixels — in WebKit
       and Chromium alike. That is the "jumpy on Safari" feel.

       So the pin and the deck are sized in PIXELS from one locked height,
       re-taken only for a real change: a new width (rotation, a resized
       window) or a height change bigger than any toolbar. The pinned range is
       deck − pin, both from the same lock, so scroll → story never moves. */
    var LOCK_SLACK = 140;                 /* px — larger than any browser toolbar */
    var lockW = -1, lockH = -1;
    function viewportChanged() {
      var w = global.innerWidth, h = global.innerHeight;
      if (w !== lockW || Math.abs(h - lockH) > LOCK_SLACK) { lockW = w; lockH = h; return true; }
      return false;
    }
    var appliedKey = null;
    function sizeDeck() {
      var vh = storyVh(), key = vh + ':' + lockH;
      if (key === appliedKey) return;
      appliedKey = key;
      if (pin !== deck) pin.style.height = lockH + 'px';
      deck.style.height = Math.round(lockH + lockH * vh / 100 * (1 - cutLen)) + 'px';
    }

    /* ── presence and inner ───────────────────────────────────────────────
       presence(i): 0..1..0 across the beat, with FADE-wide cross-windows
         centred ON the boundaries, so the outgoing beat is at exactly the
         strength the incoming one lacks and the pair always sums to 1. Inset
         windows instead of centred ones leave a dead gap at every hand-off —
         tolerable for the stage, fatal for a narrator whose whole job is
         continuity. First and last beats are open-ended, so nothing fades at
         the edges of the deck.
       inner(i): the beat's own 0..1, finished at REST of its span, so every
         beat gets a moment of rest before the hand-off.

       Use inner() for a move that should COMPLETE AND STAY. Use presence() for
       one that must also come back out. Using inner() for something that has to
       leave is why fans hang open and cards stay swivelled for the rest of the
       page. */
    function presenceAt(p, i) {
      var s = beats[i].span[0], e = beats[i].span[1];
      return win(p,
        i === 0    ? -1 : s - FADE, i === 0    ? -0.9 : s + FADE,
        i === LAST ?  2 : e - FADE, i === LAST ?  3   : e + FADE);
    }
    function innerAt(p, i) {
      var s = beats[i].span[0], e = beats[i].span[1];
      return clamp((p - s) / ((e - s) * REST));
    }
    function idx(ref) {
      if (typeof ref === 'number') return ref;
      var j = byName[ref];
      if (j === undefined && global.console) console.warn('[beat-scroll] unknown beat "' + ref + '"');
      return j === undefined ? 0 : j;
    }

    /* ── writes ────────────────────────────────────────────────────────────
       Custom properties are written to the pin, so CSS anywhere inside the
       stage can read them. Identical writes are skipped: the style recalc they
       trigger is small, but it is paid on every frame of a long scroll. */
    var wrote = {};
    function put(name, str) {
      if (wrote[name] === str) return;
      wrote[name] = str;
      pin.style.setProperty('--' + name, str);
    }
    /* --bsScale goes on the scale wrapper itself, not the pin. A custom
       property set on the pin restyles EVERYTHING inside the pin, every frame
       it changes — the camera changes on most frames of a move, and Safari
       pays for that restyle far more than Chrome does. */
    var scaleEl = (stage && stage.querySelector && stage.querySelector('.bs-scale')) || pin;
    var lastScale = null;
    function putScale(str) { if (str === lastScale) return; lastScale = str; scaleEl.style.setProperty('--bsScale', str); }
    /* --bsP / --bsQ / --n-<beat> / --i-<beat> change on (almost) every frame,
       so writing them to the pin is a whole-subtree restyle per frame. They are
       OFF unless a deck's CSS needs them: create({ cssVars: true }). */
    var CSSVARS = cfg.cssVars === true;
    var tabOn = [];
    /* frame cost, for the HUD and the harnesses: run() time, last 240 frames */
    var costs = [], costAt = 0;

    var notes = [];          /* author's working numbers, for the HUD */
    var ticking = false;
    var hud = null;
    var tabEls = null;

    /* ── beat tabs (opt-in) ────────────────────────────────────────────────
       A static row of chips above the copy, one per beat, showing where the
       reader is in the sequence. This is the ONE place the engine writes
       markup, and it earns the exception: every deck wants the same row, and
       hand-rolling it per deck is how four decks end up with four slightly
       different ideas of which chip is active mid-hand-off.

       It must sit OUTSIDE the roll window. Inside, the chips would roll away
       with the line they belong to — the whole point of the row is that it
       stays put while the copy changes beneath it.

       Each chip gets `--on` = that beat's presence (smooth, so the highlight
       crossfades through a hand-off) and `.is-on` for the single strongest
       beat (binary, for things like colour that should not be half-way). With
       `seek` left on they are real buttons that jump to their beat; with
       `seek: false` the row is decorative and hidden from assistive tech. */
    function buildTabs(decorative) {
      if (!cfg.tabs) return;
      var host = pick(cfg.tabs.into || cfg.tabs);
      if (!host) {
        if (global.console) console.warn('[beat-scroll] tabs: no host element found');
        return;
      }
      /* With motion reduced there is no pinned scroll to jump into, so the row
         is built as plain text rather than as buttons that would go nowhere. */
      var seekable = cfg.tabs.seek !== false && !decorative;
      var label = cfg.tabs.label || function (b, i) { return 'Beat ' + (i + 1); };
      host.className += (host.className ? ' ' : '') + 'bs-tabs';
      while (host.firstChild) host.removeChild(host.firstChild);
      tabEls = [];
      for (var i = 0; i < n; i++) {
        var el = document.createElement(seekable ? 'button' : 'span');
        el.className = 'bs-tab';
        el.textContent = label(beats[i], i);
        if (seekable) {
          el.type = 'button';
          /* jump to the beat's MIDPOINT — its resting composition. Jumping to
             the opening lands the reader mid-move, which reads as a glitch. */
          el.addEventListener('click', (function (j) {
            return function () { api.seekP((beats[j].span[0] + beats[j].span[1]) / 2, true); };
          })(i));
        }
        host.appendChild(el);
        tabEls.push(el);
      }
      if (!seekable) host.setAttribute('aria-hidden', 'true');
    }

    var frame = {
      /* state, refreshed every frame */
      p: 0, q: 0, scrollPx: 0, total: 0, storyTotal: 0, deckTop: 0,
      vw: 0, vh: 0, scale: 1, beat: 0, beatName: '', why: 'init',
      /* maths */
      clamp: clamp, ease: ease, easeOut: easeOut, win: win,
      /* story-time helpers — the workhorses */
      ramp: function (a, b) { return ramp01(this.p, a, b); },
      eramp: function (a, b) { return ease(ramp01(this.p, a, b)); },
      presence: function (ref) { return presenceAt(this.p, idx(ref)); },
      inner: function (ref) { return innerAt(this.p, idx(ref)); },
      span: function (ref) { return beats[idx(ref)].span; },
      /* relay(beat): the SEQUENTIAL hand-off, for copy. presence() crossfades
         — the outgoing and incoming beats overlap, which is right for the stage
         and wrong for text: parked mid-hand-off it prints two messages at once.
         relay() never overlaps: `exit` runs 0->1 across the RELAY window before
         the beat's end, and the next beat's `enter` only starts at that end.
         The first beat enters just after the deck opens; the last never exits.
           { enter, exit, on }   on = enter * (1 - exit) */
      relay: function (ref, w) {
        var i = idx(ref), s = beats[i].span[0], e = beats[i].span[1];
        if (w === undefined) w = RELAY;
        var en = i === 0 ? ramp01(this.p, 0.004, 0.004 + w) : ramp01(this.p, s, s + w);
        var ex = i === LAST ? 0 : ramp01(this.p, e - w, e);
        return { enter: en, exit: ex, on: en * (1 - ex) };
      },
      /* writes */
      set: function (name, v) { put(name, typeof v === 'number' ? v.toFixed(3) : String(v)); return v; },
      px:  function (name, v) { put(name, v.toFixed(1) + 'px'); return v; },
      deg: function (name, v) { put(name, v.toFixed(2) + 'deg'); return v; },
      raw: function (name, v) { put(name, String(v)); return v; },
      /* class toggles are re-evaluated every frame on purpose: a class set once
         on the way down never comes off when the reader scrubs back up. */
      toggle: function (elm, cls, on) { if (elm) elm.classList.toggle(cls, !!on); },
      /* a working number you want to see while checking. Shown by ?beatdbg=1,
         free otherwise — this is where temporary on-page calculations go, so
         they never need adding and removing by hand again. */
      note: function (label, v) { notes.push([label, v]); return v; },
      /* conversions for harnesses and deep links */
      toQ: scrollQ, toP: storyP
    };

    function run(why) {
      var t0 = global.performance ? performance.now() : 0;
      /* ── every layout READ happens before the first write ──────────────── */
      var rect  = deck.getBoundingClientRect();
      /* the LOCKED height, not innerHeight: see sizeDeck(). The pinned range is
         the deck minus the pin, and both were sized from this one number. */
      var vh    = lockH > 0 ? lockH : (global.innerHeight || document.documentElement.clientHeight);
      var vw    = global.innerWidth;
      var total = deck.offsetHeight - vh;
      var q     = total > 0 ? clamp(-rect.top / total) : 0;
      var p     = storyP(q);

      frame.q = q; frame.p = p; frame.total = total; frame.why = why;
      frame.vw = vw; frame.vh = vh;
      frame.scrollPx = global.scrollY || global.pageYOffset || 0;
      frame.deckTop = rect.top + frame.scrollPx;
      /* scroll px per unit of story time — what an intro that runs on PAGE
         scroll rather than deck scroll needs to find its end point */
      frame.storyTotal = total / (1 - cutLen);

      var strongest = 0, best = -1;
      var pres = [], inn = [], j;
      for (j = 0; j < n; j++) {
        pres[j] = presenceAt(p, j);
        inn[j]  = innerAt(p, j);
        if (pres[j] > best) { best = pres[j]; strongest = j; }
      }
      frame.beat = strongest;
      frame.beatName = beats[strongest].name || String(strongest);

      notes.length = 0;
      var m = (cfg.read ? cfg.read(frame) : {}) || {};
      if (m.stageW === undefined) m.stageW = stage ? stage.clientWidth : vw;

      /* ── scale is resolved BEFORE draw and handed to it ─────────────────
         Anything inside the scaled wrapper travels in scaled pixels, so a fit
         budget that ignores the scale is wrong by exactly this factor. Passing
         it in makes that mistake hard to make. */
      var sc = cfg.scale ? cfg.scale(frame, m) : 1;
      if (!(sc > 0)) sc = 1;
      frame.scale = sc;
      putScale(sc.toFixed(3));

      /* ── writes ──────────────────────────────────────────────────────── */
      put('bsBeat', String(strongest));        /* changes a handful of times */
      if (CSSVARS) {
        put('bsP', p.toFixed(4));
        put('bsQ', q.toFixed(4));
        for (j = 0; j < n; j++) {
          var key = beats[j].name || String(j);
          put('n-' + key, pres[j].toFixed(3));
          put('i-' + key, inn[j].toFixed(3));
        }
      }
      /* tabs: written only when a value actually changes — between hand-offs
         nothing does, and nine elements restyled every frame for nothing is
         exactly the kind of cost that only shows on a phone */
      if (tabEls) for (j = 0; j < n; j++) {
        var on = pres[j].toFixed(3), live = j === strongest, st = tabOn[j] || (tabOn[j] = {});
        if (st.on !== on) { st.on = on; tabEls[j].style.setProperty('--on', on); }
        if (st.live !== live) {
          st.live = live;
          tabEls[j].classList.toggle('is-on', live);
          if (tabEls[j].tagName === 'BUTTON') {
            if (live) tabEls[j].setAttribute('aria-current', 'true');
            else tabEls[j].removeAttribute('aria-current');
          }
        }
      }
      if (cfg.draw) cfg.draw(frame, m);
      if (hud) hud.paint(frame, pres, inn, notes);
      if (t0) { costs[costAt] = performance.now() - t0; costAt = (costAt + 1) % 240; }
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      global.requestAnimationFrame(function () { ticking = false; run('scroll'); });
    }
    /* Resizes are coalesced into one frame, and classified: an address bar
       sliding (same width, a small height change) changes NOTHING the deck
       depends on — the lock holds — so it is drawn like a scroll frame, with
       no re-measuring. Only a real change re-sizes the deck and tells read()
       to measure again (why === 'resize'). */
    var resizing = false;
    function onResize() {
      if (resizing) return;
      resizing = true;
      global.requestAnimationFrame(function () {
        resizing = false;
        if (viewportChanged()) { sizeDeck(); run('resize'); }
        else run('scroll');
      });
    }

    var reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ── reduced motion ───────────────────────────────────────────────────
       Collapse the deck to its own content height and draw ONE frame at the
       resting story position, so the sequence still delivers its end state —
       the page must make its point without the motion, not go blank. Nothing
       listens to scroll afterwards. */
    function drawStatic() {
      deck.style.height = 'auto';
      deck.setAttribute('data-bs-static', '');
      var sp = cfg.staticP === undefined ? 0.995 : cfg.staticP;
      frame.p = sp; frame.q = scrollQ(sp);
      frame.vw = global.innerWidth; frame.vh = global.innerHeight;
      frame.scrollPx = 0; frame.total = 0; frame.storyTotal = 0; frame.deckTop = 0;
      frame.beat = LAST; frame.beatName = beats[LAST].name || String(LAST);
      frame.why = 'reduced-motion';
      notes.length = 0;
      var mm = (cfg.read ? cfg.read(frame) : {}) || {};
      if (mm.stageW === undefined) mm.stageW = stage ? stage.clientWidth : frame.vw;
      frame.scale = cfg.scale ? (cfg.scale(frame, mm) || 1) : 1;
      putScale(frame.scale.toFixed(3));
      put('bsP', sp.toFixed(4));
      put('bsBeat', String(LAST));
      buildTabs(true);
      if (tabEls) for (var t = 0; t < n; t++) {
        tabEls[t].style.setProperty('--on', t === LAST ? '1' : '0');
        tabEls[t].classList.toggle('is-on', t === LAST);
      }
      for (var j = 0; j < n; j++) {
        var k = beats[j].name || String(j);
        put('n-' + k, j === LAST ? '1.000' : '0.000');
        put('i-' + k, '1.000');
      }
      if (cfg.draw) cfg.draw(frame, mm);
    }

    function start() {
      /* The page ships with `bs-nojs` on <html> so a failed or blocked script
         degrades to the readable static layout rather than a collapsed stage.
         Reaching this line means the engine is alive, so the class comes off. */
      document.documentElement.classList.remove('bs-nojs');
      if (reduced && cfg.reducedMotion !== 'animate') { drawStatic(); return; }
      viewportChanged();          /* take the first lock */
      sizeDeck();
      buildTabs();
      if (/beatdbg/.test(location.search + location.hash)) hud = makeHud(api, beats);
      global.addEventListener('scroll', onScroll, { passive: true });
      global.addEventListener('resize', onResize);
      global.addEventListener('orientationchange', onResize);
      /* Fonts change every box on the page. A deck seated before they land is
         seated against the fallback's metrics. */
      if (document.fonts && document.fonts.addEventListener)
        document.fonts.addEventListener('loadingdone', function () { run('fontsdone'); });
      global.addEventListener('load', function () { run('load'); });
      run('init');
      /* Two frames later: the first pass can run before the stage's own styles
         have been applied, and anything measured then is measured against a
         half-built layout. */
      global.requestAnimationFrame(function () {
        global.requestAnimationFrame(function () { run('raf2'); });
      });
    }

    var api = {
      deck: deck, pin: pin, stage: stage, beats: beats, frame: frame,
      update: run,
      /* seek by STORY time — what you want when checking a beat.
         smooth=true is for a reader clicking a tab; the default instant jump is
         for harnesses, which need the frame to be readable on the next line. */
      seekP: function (p, smooth) { return this.seekQ(scrollQ(p), smooth); },
      /* seek by SCROLL fraction — what harnesses and the HUD use */
      seekQ: function (q, smooth) {
        var top = deck.getBoundingClientRect().top + (global.scrollY || 0);
        var t = Math.round(top + clamp(q) * (deck.offsetHeight - (lockH > 0 ? lockH : global.innerHeight)));
        if (smooth && !reduced) {
          global.scrollTo({ top: t, behavior: 'smooth' });
          return t;   /* the scroll listener drives the frames from here */
        }
        document.documentElement.style.scrollBehavior = 'auto';
        global.scrollTo({ top: t, behavior: 'instant' });
        run('seek');
        return t;
      },
      toQ: scrollQ, toP: storyP, cutLen: cutLen, cut: cut,
      /* the hand-off width and rest fraction, so harnesses (beat-capture)
         judge rests against the engine's real numbers, not a copy of them */
      fade: FADE, rest: REST, relayW: RELAY,
      /* what a frame costs: run() — the read, the scale, the draw — over the
         last 240 frames, in ms. A phone is several times slower than the
         machine that measured it; keep the p95 well under 4ms here. */
      perf: function () {
        var c = costs.slice().sort(function (a, b) { return a - b; }), len = c.length;
        if (!len) return { frames: 0, avg: 0, p95: 0, max: 0 };
        var sum = 0; for (var i = 0; i < len; i++) sum += c[i];
        return { frames: len, avg: sum / len, p95: c[Math.min(len - 1, Math.floor(len * 0.95))], max: c[len - 1] };
      },
      map: function () {
        var out = [];
        for (var j = 0; j < beats.length; j++) out.push({
          i: j, name: beats[j].name || String(j), span: beats[j].span,
          qStart: scrollQ(beats[j].span[0]), qEnd: scrollQ(beats[j].span[1])
        });
        return out;
      }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
    return api;
  }

  /* ── the HUD: add ?beatdbg=1 to the URL ──────────────────────────────────
     Every value that used to get typed into the page as a temporary note lives
     here instead: story time, scroll position, the beat map with each beat's
     presence and inner, the resolved scale, and whatever draw() passed to
     f.note(). [ and ] step between beats, \ jumps to the current beat's
     midpoint — which is how you check a beat's resting composition without
     hunting for the scroll position by hand. */
  function makeHud(api, beats) {
    var box = document.createElement('div');
    box.setAttribute('data-bs-hud', '');
    box.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'left:8px', 'top:8px', 'max-width:min(92vw,420px)',
      'padding:8px 10px', 'border-radius:8px', 'background:rgba(6,8,14,.9)', 'color:#9ff',
      'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace', 'white-space:pre',
      'pointer-events:none', 'box-shadow:0 2px 18px rgba(0,0,0,.5)'
    ].join(';');
    document.body.appendChild(box);

    function bar(v) {
      var w = Math.round(clamp(v) * 10), s = '';
      for (var i = 0; i < 10; i++) s += i < w ? '#' : '.';
      return s;
    }
    document.addEventListener('keydown', function (e) {
      var m = api.map(), cur = api.frame.beat, t = null;
      if (e.key === ']') t = m[Math.min(m.length - 1, cur + 1)].span[0] + 0.001;
      else if (e.key === '[') t = m[Math.max(0, cur - 1)].span[0] + 0.001;
      else if (e.key === '\\') t = (m[cur].span[0] + m[cur].span[1]) / 2;
      if (t !== null) { e.preventDefault(); api.seekP(t); }
    });

    return {
      paint: function (f, pres, inn, notes) {
        var L = [];
        L.push('beat ' + f.beat + '  ' + f.beatName + '      [ ] jump   \\ midpoint');
        L.push('p ' + f.p.toFixed(4) + '   q ' + f.q.toFixed(4) + '   scale ' + f.scale.toFixed(3));
        L.push('scroll ' + Math.round(f.scrollPx) + ' of deck ' + Math.round(f.total) +
               '   vw ' + f.vw + '  vh ' + f.vh + ' (locked)');
        var pf = api.perf();
        L.push('frame cost  avg ' + pf.avg.toFixed(2) + '  p95 ' + pf.p95.toFixed(2) + '  max ' + pf.max.toFixed(1) + ' ms' +
               (pf.p95 > 4 ? '   ← heavy for a phone' : ''));
        L.push('');
        for (var i = 0; i < beats.length; i++) {
          var nm = (beats[i].name || String(i));
          while (nm.length < 10) nm += ' ';
          L.push((i === f.beat ? '>' : ' ') + nm +
                 ' n ' + bar(pres[i]) + ' ' + pres[i].toFixed(2) +
                 '  i ' + inn[i].toFixed(2) +
                 '  ' + beats[i].span[0].toFixed(2) + '-' + beats[i].span[1].toFixed(2));
        }
        if (notes.length) {
          L.push('');
          for (var j = 0; j < notes.length; j++) {
            var v = notes[j][1];
            L.push('  ' + notes[j][0] + ' = ' + (typeof v === 'number' ? (Math.round(v * 1000) / 1000) : v));
          }
        }
        box.textContent = L.join('\n');
      }
    };
  }

  /* ── rows: the narrator's row-by-row relay ───────────────────────────────
     BeatScroll.rows(host, { item: '.bs-line' }) prepares every copy block in
     `host` for a reveal that runs ROW BY ROW: each block's text is wrapped
     word by word (inline markup such as <em> is kept), words are grouped into
     the visual rows the browser actually wrapped them into, and draw() moves a
     whole row at a time.

       read:  if (f.why !== 'scroll') narr.measure();   // rows change with layout
       draw:  var r = f.relay(k); narr.draw(k, r.enter, r.exit);

     Why rows and not the block: a block that slides as one slab is a
     transform; a reveal that walks down the lines is TYPOGRAPHY — it reads in
     the order the eye does. Why no mask: a row that rises out of an
     overflow:hidden edge is sliced by it on the way in. Here each row only
     travels a fraction of its own line height while it fades, so it never
     needs clipping, and nothing at the edge of a frame chops it.

     Rows are measured with offsetTop (layout), not getBoundingClientRect,
     because the words carry transforms mid-reveal and a transformed box would
     put a rising word on the wrong row.

     opts: item     selector for the blocks             (default '.bs-line')
           rowDur   share of the window ONE row takes   (default 0.5)
           rise     em a row rises from as it enters    (default 0.55)
           lift     em a row lifts by as it exits       (default 0.32) */
  function rows(sel, opts) {
    var host = pick(sel);
    if (!host) { if (global.console) console.warn('[beat-scroll] rows: no host'); return null; }
    opts = opts || {};
    /* motion feel: an explicit option wins, then the brand's CSS token
       (--bs-row-dur / --bs-rise / --bs-lift, from brand.css), then the default
       — so a rebrand can make the copy snappier or calmer without touching JS */
    var hs = getComputedStyle(host);
    function tok(name, fallback) {
      var v = parseFloat(hs.getPropertyValue(name));
      return isNaN(v) ? fallback : v;
    }
    var D = opts.rowDur || tok('--bs-row-dur', 0.5),
        RISE = opts.rise === undefined ? tok('--bs-rise', 0.55) : opts.rise,
        LIFT = opts.lift === undefined ? tok('--bs-lift', 0.32) : opts.lift;
    var els = [].slice.call(host.querySelectorAll(opts.item || '.bs-line'));
    host.classList.add('bs-relay');
    /* The stacking is the relay's whole geometry, so it is set HERE, not left
       to a stylesheet. When it lived only in beat-engine.css, a preview that
       had cached the previous CSS laid the blocks out one after another: the
       hidden first block kept its space and the live one was pushed down out
       of the box and onto the stage. Inline, the relay works whatever CSS the
       page happens to have. (The reduced-motion rules override it with
       !important.) */
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    for (var e = 0; e < els.length; e++) {
      els[e].style.position = 'absolute';
      els[e].style.top = '0';
      els[e].style.left = '0';
      els[e].style.right = '0';
    }

    /* wrap every word in a span, leaving the whitespace between them as text
       so the browser still wraps the line exactly as it would have */
    function wrap(root) {
      var walker = document.createTreeWalker(root, 4 /* SHOW_TEXT */, null, false), nodes = [], t;
      while ((t = walker.nextNode())) nodes.push(t);
      for (var i = 0; i < nodes.length; i++) {
        var parts = nodes[i].nodeValue.split(/(\s+)/), frag = document.createDocumentFragment();
        for (var j = 0; j < parts.length; j++) {
          if (!parts[j]) continue;
          if (/^\s+$/.test(parts[j])) { frag.appendChild(document.createTextNode(parts[j])); continue; }
          var w = document.createElement('span');
          w.className = 'bs-w';
          w.textContent = parts[j];
          frag.appendChild(w);
        }
        nodes[i].parentNode.replaceChild(frag, nodes[i]);
      }
      var words = [].slice.call(root.querySelectorAll('.bs-w'));
      /* An underlined <em>/<a> keeps painting its decoration on the gaps and
         line-box edges BETWEEN its now-inline-block words — it does not fade
         with them, so a fully hidden row leaves a few stray dots hanging in
         the box. Move the decoration onto the words themselves (inherit alone
         is not enough: the parent would still draw its own). */
      for (var k = 0; k < words.length; k++) {
        var par = words[k].parentElement;
        if (!par || par === root || par.getAttribute('data-bs-deco') === 'moved') continue;
        var cs = getComputedStyle(par);
        if (!cs.textDecorationLine || cs.textDecorationLine === 'none') continue;
        var kids = par.querySelectorAll(':scope > .bs-w');
        for (var m = 0; m < kids.length; m++) {
          kids[m].style.textDecoration = cs.textDecoration;
          kids[m].style.textUnderlineOffset = cs.textUnderlineOffset;
        }
        par.style.textDecoration = 'none';
        par.setAttribute('data-bs-deco', 'moved');
      }
      return words;
    }
    var blocks = els.map(function (el) { return { el: el, words: wrap(el), rows: [], cache: [] }; });

    function measure() {
      var tallest = 0;
      for (var b = 0; b < blocks.length; b++) {
        var B = blocks[b], rowsNow = [], cur = null, top = -1e9;
        for (var k = 0; k < B.words.length; k++) {
          var w = B.words[k], y = w.offsetTop, h = w.offsetHeight || 1;
          /* a new row when this word starts clearly below the current one —
             half its own height, so a bigger headline word and a smaller
             label word on different rows can never be merged */
          if (!cur || y > top + h * 0.5) { cur = []; rowsNow.push(cur); top = y; }
          cur.push(w);
        }
        B.rows = rowsNow;
        B.cache = [];
        if (B.el.offsetHeight > tallest) tallest = B.el.offsetHeight;
      }
      host.style.height = Math.ceil(tallest) + 'px';
      return tallest;
    }

    function draw(k, enter, exit) {
      var B = blocks[k]; if (!B) return 0;
      var R = B.rows.length, S = R > 1 ? (1 - D) / (R - 1) : 0, shown = 0;
      for (var r = 0; r < R; r++) {
        /* each row runs its own short 0..1 inside the window, staggered top
           to bottom on the way in AND on the way out */
        var t = easeOutCubic(clamp((enter - r * S) / D));
        var u = easeInCubic(clamp((exit - r * S) / D));
        var op = t * (1 - u), y = (1 - t) * RISE - u * LIFT;
        shown += op;
        var key = op.toFixed(3) + '|' + y.toFixed(3);
        if (B.cache[r] === key) continue;           /* identical writes skipped */
        B.cache[r] = key;
        var tf = 'translate3d(0,' + y.toFixed(3) + 'em,0)';
        for (var w = 0; w < B.rows[r].length; w++) {
          B.rows[r][w].style.opacity = op.toFixed(3);
          B.rows[r][w].style.transform = tf;
        }
      }
      /* only a block with text actually showing takes pointer events */
      if (R && shown / R > 0.5) B.el.setAttribute('data-bs-top', '');
      else B.el.removeAttribute('data-bs-top');
      return R ? shown / R : 0;
    }

    return { host: host, blocks: blocks, measure: measure, draw: draw };
  }

  /* ── poses: moves chained on one timeline ────────────────────────────────
     BeatScroll.poses(base, steps) — one step per beat, in beat order:

       var tl = BeatScroll.poses(
         { ry: 0, panes: 1, chips: 0 },                       // the pose before beat 0
         [ { pose: { chips: 1 } },                            // beat 0 rests here
           { pose: { ry: 180 }, stage: { ry: [0.15, 0.9] } }, // beat 1: a flip
           { pose: { ry: 720 } } ]);                          // beat 2: 1.5 turns more
       draw: var P = tl.at(f);   P.ry, P.panes, P.chips …

     Each step's pose is MERGED onto the one before, so a beat states only what
     it changes, and every move starts from where the last one rested — which
     is what makes moves chain (split, then fold back; flip, then spin). Inside
     its beat a step moves from the previous rest pose to its own across
     `move` (default [0.06, 0.6] of the beat's span), eased; `stage` gives any
     property its own window, so a beat can retract the chips first and flip
     second. After `move` the pose RESTS until the beat ends — the rest every
     beat needs before the hand-off.

     Numbers interpolate; degrees simply add up (540 is a turn and a half).
     Non-numbers switch at the midpoint of their window. Scrubbing back plays
     every move in reverse exactly, because the pose is a pure function of p. */
  function poses(base, steps) {
    function merge(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
    var rest = [], cur = merge(base, {});
    for (var i = 0; i < steps.length; i++) { cur = merge(cur, steps[i].pose || {}); rest.push(cur); }
    return {
      rest: rest,
      at: function (f) {
        var p = f.p, k = steps.length - 1;
        for (var j = 0; j < steps.length; j++) { var sp = f.span(j); if (p < sp[1]) { k = j; break; } }
        var from = k ? rest[k - 1] : merge(base, {}), to = rest[k], st = steps[k] || {};
        var span = f.span(k), s = span[0], len = span[1] - span[0];
        var mv = st.move || [0.06, 0.6], stage = st.stage || {}, out = { beat: k };
        for (var key in to) {
          var w = stage[key] || mv;
          var u = ease(ramp01(p, s + len * w[0], s + len * w[1]));
          var a = from[key], b = to[key];
          out[key] = (typeof a === 'number' && typeof b === 'number') ? a + (b - a) * u : (u < 0.5 ? (a === undefined ? b : a) : b);
        }
        return out;
      }
    };
  }

  global.BeatScroll = { create: create, rows: rows, poses: poses, clamp: clamp, ease: ease, easeOut: easeOut,
    easeOutCubic: easeOutCubic, easeInCubic: easeInCubic, win: win };
})(typeof window !== 'undefined' ? window : this);
