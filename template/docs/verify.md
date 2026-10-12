# How to prove it

The rule: **judge a beat deck from a measurement or a screenshot, never from
reading the code.** Every entry below is something that read correctly and was
wrong on screen, or read as broken and was fine.

## Set up

```bash
cd <the scroll/ folder>      # or wherever the deck lives
python3 -m http.server 8769
```

`file://` does not work for any harness that looks inside an iframe: Chrome
treats each local file as its own origin, so the harness silently fails to seek
and shows you an unscrolled page that looks exactly like a rendering bug.

## The six checks, in order

### 1. The HUD, while you build — `?beatdbg=1`

Story time, scroll position, the beat map with each beat's presence and inner as
bars, the resolved camera scale, and every value you passed to `f.note()`.
`[` and `]` jump beat to beat, `\` goes to the current beat's midpoint.

This replaces typing working calculations into the page as temporary notes —
which then get forgotten, or worse, half-removed. Put them in `f.note()` and
they cost nothing when the flag is off.

Check per beat: does it open, rest, and hand off? Is anything still moving when
the next line has already arrived? Is there a stretch where `p` changes and
nothing does — that is a candidate for a `cut`.

### 2. The capture: timing and position, measured from the screen

```bash
node scripts/beat-capture.cjs                                  # the demo
node scripts/beat-capture.cjs http://localhost:8769/path/deck.html \
     --sizes 390x844,768x1024,1440x900 --out /tmp/my-capture --strict
```

It launches its own headless Chrome (a throwaway profile, so never a stale
engine), and for each size it does two passes:

1. **Scrub** the deck in 1% steps of reader scroll (`--step`). At each step it
   reads every `data-bs-part` element's box and **effective** opacity, and
   screen-captures the frame. Consecutive frames are diffed pixel by pixel, so
   it sees motion the DOM can't report: a counter ticking, an untagged
   element, a background swap, a canvas.
2. **Still** every beat's in / mid / out at full size, and record where each
   part sits in it.

From that it writes `report.md`, `report.json` and `sheet.html` into `--out`:

| it reports | so you can |
|---|---|
| each part's moving and visible ranges, in story `p` | check a move lands in the beat it belongs to, and leaves when it should |
| every still stretch: where (rest before hand-off / hold mid-beat / end hold) and how long, in **screens** of scroll | find a `cut`: a full screen with nothing changing reads as a broken page |
| per beat: scroll px, % of it moving, its rest | spot a beat that never lands, or one that barely moves |
| per beat at rest: group offset from the centre of **its own column**, % of the column filled, camera value, anything clipped | spot drift and a subject the camera shrank too far |
| per beat at rest: any visual part overlapping the text column | catch a split layout's visual wandering into the copy, which no screen-edge check can see |
| any frame where two narrator blocks (`line:*`) show text at once, judged by mean word opacity | keep the relay a relay: a crossfade sneaking back in fails here |

Verdicts are judged against the engine's own numbers (`deck.fade`,
`deck.rest`, the beat map), never a copy of them. A still under 0.6 screens is
a hold and is listed but not judged; 0.6–1 screens warns; a full screen fails.
Holds under 0.6 still deserve a look. The tool can't tell a deliberate pause
from a forgotten one, and you can.

**Open `sheet.html` and look at it.** The timeline shows the deck's rhythm on
one line: the beats across the top, screen change as a trace, then one lane
per part (grey = visible, black = moving), with rests and dead stretches
shaded. A healthy deck looks like a staircase: each part's black bars sit
inside its beat, each beat ends in a flat stretch, and the trace never flatlines
for long. Below that are the stills with part boxes overlaid. `--strict` exits
1 on any fail, for use in a loop.

What fooled it on its first run, so you don't trust it blindly:

- **A slow, pale crossfade moves each pixel one or two levels per step.** A
  coarse pixel threshold reported the whole draft beat as dead. It now counts
  a pixel as changed at more than 2 levels, which only works because frames are
  lossless and frozen. Name anything that changes only in opacity with
  `data-bs-part` anyway: the DOM pass catches what a diff can miss.
- **Half-size frames invent motion on a dark brand.** Downsampling resamples
  light-on-black text edges differently at each scroll position, so a still
  beat in Vercel's black brand read as "changing" and two moves "never
  rested". Seeking straight to the same two frames showed zero changed
  pixels. Frames are now captured at full size (`BEAT_ENERGY_SCALE` overrides).
- **A scrolling page background behind a pinned stage makes every pixel move.**
  The capture pins `html, body` backgrounds while it runs. A stage with its own
  scrolling texture will still read as always moving.
- **CSS animations make two runs disagree.** They're frozen by default
  (`--live-anim` to keep them), so the numbers are repeatable.
- **A deliberate hold looks exactly like a dead stretch.** On an earlier demo,
  parts resting on the card mid-beat and the stretch its `cut` removed were the
  same size in proportion. That's why the verdict is in screens of scroll, and
  why the report names where each still sits.
- **With many short beats, the rest has to clear the tabs.** The tabs'
  highlight crossfades from `fade` (0.03 of story) before each boundary, a
  quarter of a nine-beat gallery's beat. Moves that finished at half-way left
  two frames of stillness, and the capture rightly said "never rests". Finish
  moves earlier, or narrow `fade` and `relay` for that deck.
- **The timing check samples rests; the sweep samples hand-offs.** The
  gallery passed `beat-capture` while `sweep-beats.sh` failed at six widths,
  at each beat's *opening*, where a split row was mid-transition and
  lopsided. Run both.

Prove it can say no before trusting a pass. On the gallery at 1440×900:

- Drive the narrator with `f.presence(b)` instead of `f.relay(b)`, and it
  reports `narrator blocks overlap in 31 frame(s), first at p 0.100:
  line:assemble + line:flip`.
- Triple `story.vh` (3240), and every rest becomes `dead stretch … 1166px (1.3
  screens) of scroll with nothing changing`.

**Check every layout and every brand you ship.** A layout is part of the URL
the harnesses load, so pass it in: `beat-capture.cjs
'http://localhost:8769/gallery.html?layout=split' --sizes 1024x768,1440x900`
and `sweep-beats.sh --src '../gallery.html?layout=split'`. The split
layouts only exist above 820px. Below that they stack, which the sweep's phone
sizes cover. For a brand, confirm the faces actually paint:
`CDP_FONTS_SEL='.nar-line h3,.nar-line p' node scripts/cdp-probe.cjs …` must
report the brand's families as `(webfont)`, not a system face.

### 3. The sweep, before you call a beat done

```bash
bash scripts/sweep-beats.sh
bash scripts/sweep-beats.sh --src ../../index.html --pin .days-pin \
     --ignore .dk-slot--a,.sg--in
```

Eight breakpoints × every beat's opening, midpoint and close. Walks **every
painted element** and reports anything crossing the viewport, plus any sideways
scroll.

It reads the beat list off the engine, so it automatically covers whatever beats
the page has and cannot check the wrong moment. Run it after every geometry
change. On this skill's own demo it caught a 19px clip at 768px that both 390
and 1440 passed cleanly.

**What the sweep cannot see:** an element hidden by its own parent's
`overflow:hidden`. Nothing crosses the viewport, so it passes, while the effect
is simply absent — an earlier demo lost three chips and both A/B tags that way. Add
`&clip=1` to `beat-audit.html` once per beat while building:

```
…/beat-audit.html?w=1440&h=900&scan=0&p=0.34&clip=1
    clip 14px by div.card.card--a  →  span.chip
```

It is a note rather than a failure, because masks are legitimate (the
alternative `.bs-roll` narrator clips parked lines on purpose; the default relay
uses no mask). Read it looking for anything you
*expected* to see overhanging.

### 4. Screenshots, because fitting is not composing

`beat-capture`'s contact sheet covers the standard three widths. Use the probe
below for anything else (a specific moment, a clip, a live preview panel).

```bash
CDP_PORT=9333 CDP_SHOT=/tmp/b3.png CDP_WAIT=900 \
  node scripts/cdp-probe.cjs demo.html "window.deck.seekP(0.87);'ok'"

CDP_VIEWPORT=390x844 CDP_PORT=9333 CDP_SHOT=/tmp/b3-phone.png \
  node scripts/cdp-probe.cjs demo.html "window.deck.seekP(0.87);'ok'"
```

Launch the browser first (macOS path shown; on Linux it's `google-chrome` or
`chromium`, on Windows `chrome.exe`. The other scripts find it themselves, or
read `CHROME_PATH`):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/beat-chrome \
  --window-size=1440,900 'http://localhost:8769/gallery.html?beatdbg=1'
```

Take the resting composition of every beat at 390, 768 and 1440 and **look at
them**. A script can tell you nothing is clipped. Only your eyes can tell you
the subject is too small, the group has drifted off-centre, or two chips are
sitting on top of each other.

### 5. Smoothness, in Safari's engine as well as Chrome's

```bash
npm i playwright && npx playwright install webkit chromium   # once, anywhere
NODE_PATH=$(npm root) node scripts/scroll-perf.mjs [url] [--only webkit] [--quick]
```

Scrolls the whole deck the way a person does, in WebKit and Chromium, on a
1440 desktop and an emulated iPhone 14, and reports per run:

| number | budget | what it catches |
|---|---|---|
| frame p95 / dropped | ≤ 26ms / ≤ 8%, **warns, doesn't fail** | stutter, but headless pacing tracks the machine's load: the untouched gallery read 22ms, then 32ms, minutes apart |
| JS p95 per frame | ≤ 6ms | a heavy `read()`/`draw()`: forced layouts, big loops |
| stale frames | ≤ 2% | the stage lagging the scroll ("swimming") |
| toolbar jump | ≤ 0.01 of story | the deck snapping when the address bar slides |

Headless numbers are not a phone's numbers, so read them relatively: one
engine against the other, one run against the last. Then scroll the real
thing on a real phone.

What it found on its first run, on the engine as it stood:

- **Every frame was smooth, and the story still jumped 3–5%** whenever the
  viewport height changed by 70px: the iPhone toolbar, in both engines. Frame
  timing alone would never have shown it. The engine now locks the viewport
  height (docs/GUIDE.md → "Smooth on Safari").
- **Mobile WebKit takes no wheel input,** so phones are driven by `scrollBy`.
  The driver fires it from a timer: scrolling from *inside* a
  requestAnimationFrame delays every scroll event by a frame, and the run
  read 97% stale. That's the harness's lag, not the deck's.

And what WebKit screenshots found that Chrome never shows: the back face
painting through the 3D move, and replacing the shape move's crop, once a
`filter` or `clip-path` flattened the item. Take WebKit stills of every 3D
move, not just Chrome ones.

### 6. The fallbacks, before shipping

```bash
"…/Google Chrome" --headless --force-prefers-reduced-motion \
  --dump-dom 'http://localhost:8769/gallery.html' | grep -o 'id="deck"[^>]*'
# expect: data-bs-static="" style="height: auto;"
```

And confirm `class="bs-nojs"` is still on `<html>` in the source — with the
script blocked, that class is the only thing keeping the deck readable.

After editing an inlined deck, `node scripts/syntax-check.cjs <page>.html`
parses every inline script. A deck whose script throws is a page-length blank
space.

## The trap catalogue

**Headless refuses windows under ~500px.** `--window-size=390,844` renders at
500 and *crops* the capture, which looks exactly like content clipping. Every
"mobile" screenshot taken that way is lying. Size an inner iframe (what
`beat-audit.html` does) or emulate the viewport (`CDP_VIEWPORT=390x844`).

**`overflow: clip` hides overflow without growing `scrollWidth`.** So a
`scrollWidth - clientWidth` of 0 is *not* proof nothing is clipped — an element
can be sliced in half while that number reads zero. Only the elements' own
boxes tell the truth. Check both.

**Count rows by overlap, never by rounded `top`.** Bucketing elements by
`Math.round(top / 6)` puts centre-aligned items of different heights in
different buckets, and one can fall across a boundary. That produced a phantom
"5 + 1" wrap for a logo row at 1440 and a CSS rule was written to fix a wrap
that never happened. Two items share a row if their `[top, bottom]` ranges
intersect.

**Reload restores the scroll position.** A page reloaded mid-sequence starts
there, and any time-based state (a typewriter catching up) runs to completion
before the probe looks. A whole run once read "every word already typed" for
this reason. Reset with
`history.scrollRestoration = 'manual'; scrollTo(0,0); location.reload()`.

**One long wait lets headless throttle rAF.** Poll in short steps instead of
sleeping for three seconds and reading once.

**Headless Chrome caches linked scripts across a page reload.** Editing
`beat-engine.js` and calling `location.reload()` keeps running the OLD engine —
even a cache-busted page URL does not refetch a subresource. The tell is a probe
reporting that a function you just added does not exist. Kill the browser and
delete its `--user-data-dir` between engine edits:

```bash
pkill -f 'remote-debugging-port=9333'; rm -rf /tmp/beat-chrome
```

**The user's preview can hold a stale stylesheet that headless never sees.**
Every harness here starts a fresh browser, so they all passed while the user's
preview, with a cached `beat-engine.css` beside a new `beat-engine.js`, laid the
narrator's blocks out one after another: the hidden first block kept its space
and the live one landed on the stage. Two defences: geometry the engine depends
on is set inline by the engine (`rows()` stacks its own blocks), and the demo
links the engine as `?v=N`, bumped on every engine change.

**A brand font that loads on the brand's site renders as Arial on the deck.**
The first `brand-from-url` copied every `@font-face` with absolute URLs, and all
three test brands (Stripe, Leadpages, Linear) painted in the system face: font
hosts refuse other origins. It now downloads the files beside the brand file.
Two more ways the rules hid: `@font-face` nested inside `@layer`/`@media`, and
stylesheets on a CDN the page can't read (a dozen-sheet cap missed Linear's).
The browser's own font-load record (`CSS.fontsUpdated`) now settles it. Judge
fonts by platform-font resolution, never by the CSS saying the right name.

**A computed colour can be in a format no parser reads.** Sites declaring
`oklch()` get it back unconverted from `getComputedStyle`. `brand-from-url`
paints every colour onto a 1px canvas and reads the pixel.

**"Saturated" is the wrong test for "is this text grey".** HSV saturation called
Stripe's heading navy `#061b31` 88% saturated and threw it out as ink. Chroma
(max − min channel) calls it 0.17, which matches what the eye sees.

**CDP screenshot clips are in page coordinates**, scroll offset included — so a
clip taken after scrolling needs the scrolled coordinates, not the viewport
ones.

**Effective opacity is not element opacity.** A slot read `--aO: 1.000` from the
script while a narrow-screen rule multiplied its ancestor by `(1 - --bO)`, and
`--bO` held at 1 for the whole beat: the element was at a true opacity of 0.000
and invisible on phones only. Check the product through every ancestor, which is
what `beat-audit.html` does.

**A fade on a container kills `backdrop-filter` inside it.** Chips would not
blur because the parent was being faded. Move the fade onto the blurring
elements themselves. And judge blur from a capture, never from reading the CSS.

**Screenshots proved `backdrop-filter` over flat colour was doing nothing
visible** while costing a filter per frame. Take the with/without pair before
paying for glass inside a moving stage.

**This machine has fonts installed that the page also loads.** A local preview
rendered "correctly" while the page was loading its webfont from a URL that only
resolves on one host, and never loading another face at all. Verify fonts from
*platform* font resolution (`CDP_FONTS_SEL`) or `document.fonts` status, not from
the CSS and not from how it looks on your machine.

**A cross-origin stylesheet throws on `cssRules` and its `@font-face` can fail
CORS.** When checking a deck served from a different origin than its assets,
judge the CSS by a computed style instead, and expect font status to be
unreliable until origins match.

## What "done" means

- HUD: every beat opens, rests and hands off; no dead stretch left uncut.
- `beat-capture.cjs`: OK at 390 / 768 / 1440, and its sheet looked at.
- `sweep-beats.sh`: PASS at all eight widths.
- `scroll-perf.mjs`: PASS in WebKit and Chromium, desktop and iPhone, with the
  real brand. Then the published page, scrolled on a real iPhone.
- The mid stills for every beat, looked at by a person.
- Reduced motion renders the end state.
- `syntax-check.cjs` clean if the script is inlined.
- Scrub the whole deck backwards once, by hand, watching for anything that does
  not undo.
