
# Beat-based scroll animations

A **beat deck** is a tall element whose scroll drives a sticky stage through a
fixed sequence of beats — a thing assembles, gains parts, splits, resolves. The
reader's scroll is the timeline. No autoplay, no snapping, no anchors, and
scrubbing backwards undoes everything exactly.

This skill exists because building one by hand goes wrong in the same ten ways
every time, and because "it looks right on my screen" is not a test. Everything
here was extracted from two shipped decks and the bugs they cost.

## Use the engine. Do not hand-roll the loop.

`beat-engine.js` + `beat-engine.css` own the parts that are
error-prone and identical every time: story time, deck height, presence
envelopes, the read/draw split, the camera scale, rAF coalescing, resize and
font reflow, reduced motion, and the debug HUD. `gallery.html` is a working
gallery of moves drawn as a **neutral wireframe** — copy it for its mechanics
rather than starting from nothing.

## The move gallery, and what a real deck takes from it

`gallery.html` is a **gallery, not a deck**. One item (a window with chips
around it) performs every move the skill has a worked example of, one per
beat, and the text names each move and what it could mean in a story:

| move | how | what it can say |
|---|---|---|
| assemble | a draft crossfades to the final state; chips dock on the edges | here is the product and what plugs into it |
| flip | `rotateY` to 180°, a real back face | before / after, problem / fix, their view / yours |
| spin | more `rotateY` (degrees add up: 540° is a longer move) | a reveal, "from every angle", a change of state |
| split ×2 | a copy slides out from **behind** the item | A/B, old / new, you / them |
| split ×3 | a third joins; a narrow stage fans them like a hand of cards | tiers, three use cases, good / better / best |
| fold | the copies slide home behind the item; chips return | many tools become one platform |
| backflip | `rotateX` through 360° | a celebration (use sparingly) |
| responsive | the window narrows to a phone and its content **reflows** (real width, layout driven by a 0→1 "mobile" value), not a crop | works on every device, desktop to mobile, page to app |
| 3D parts | isometric tilt, layers lift apart in `translateZ` | under the hood, how it's built |

**A real deck is 4 beats** (5 at most). Pick the moves whose *meaning* matches
the story, combine them (split, then flip each copy), and invent new ones; the
gallery is a vocabulary, not a menu, and nine beats in a row is a catalogue,
not a page. Put the brand's real item in the window, and the brand's real
features in the chips.

The moves chain on one timeline. `BeatScroll.poses(base, steps)` takes the
pose each beat **rests** in and returns the in-between pose for any scroll
position. Each beat states only what it changes, and starts from where the
last one rested. `docs/model.md` → "Moves" has the rules that keep 3D
moves from silently flattening, and the camera footprint each one needs.

## A deck is text and a visual, in a layout, wearing a brand

Every deck is two things pinned together while the reader scrolls:

- **The text** (`.bs-text`): the beat tabs plus the narrator, one block of
  copy per beat, handed over by the row relay.
- **The visual** (`.bs-stage` › `.bs-scale`): whatever the story needs to
  show. That could be a mock-up built in HTML, an `<img>`/`<picture>`, a
  `<video>`, an `<iframe>`/embed or an SVG. Put the media inside a `.slot` and
  move the slot. The gallery's window is a stand-in.

**Layout is one attribute** on the deck:

| `data-layout=` | arrangement |
|---|---|
| `stack` (default) | text above the visual |
| `stack-below` | text below the visual |
| `split` | text left, visual right |
| `split-reverse` | visual left, text right |

Split layouts become `stack` at 820px and under. Tune them with
`--bs-text-share`, `--bs-gap` and `--bs-split-max`. Preview any layout on the
demo with `?layout=split`; the wireframe also shows a layout switcher in the
corner. **Inside the stage, size against the stage, never the viewport**
(`@container bs-stage`, `cqw`, and budgets against `m.stageW`). In a split
layout the stage is half the screen, and a rule keyed to the viewport sizes the
visual for room it doesn't have. Every move in the gallery passes in all four
layouts for exactly this reason.

**The brand is one file,** `brand.css`: colour, type, emphasis style,
radius, borders, shadow, surface texture, logo, and the **motion feel** (how
snappy the narrator's rows are: `--bs-row-dur`, `--bs-rise`, `--bs-lift`,
`--bs-relay`). The deck's own CSS holds no brand values, and even the
wireframe's dots, dashes and labels are switches in that file. **Rebrand from a
URL:**

```bash
node scripts/brand-from-url.cjs https://their-site.com --out path/to/brand.css
```

It opens the site in headless Chrome and reads what actually renders:

- the page, text, surface and border colours
- the primary button (its fill becomes the accent), plus every other brand
  colour it saw, listed in case the pick is wrong
- the real typefaces, which it **downloads beside the brand file**, because
  font hosts refuse other sites, so linking to them silently falls back to
  Arial. Faces it can't read from the page come from Google Fonts when the
  family exists there.
- button and card radius, shadow, and the logo
- the site's voice (title, H1, opening copy) for the interview

It writes a complete `brand.css`, a `.json` saying where each value came from,
and a contrast report, and fixes text and borders that would be too faint.
Preview the result with `demo.html?brand=path/to/brand.css`. It's a strong first
draft: read its notes, which call out every guess. Brand fonts are licensed to
the brand. Using them in that brand's own deck is fine, but don't bundle them
anywhere else.

## The scaffold is a wireframe. Structure is fixed, layout is free.

`demo.html` is deliberately colourless: a dot-grid surface, dashed boxes, and
a mono label on every box naming its **role**: item (front and back), chips,
copies, narrator, stage. It has no product, no palette and no copy worth
keeping, so it can't be mistaken for a design or shipped by accident. It shows
how the machine works, not what the page should look like.

Once the brief and the brand exist, **you have full freedom over everything
you can see.** Don't preserve the wireframe's arrangement out of caution.

| fixed — the contract | free — the composition |
|---|---|
| the engine; timings in story `p`; the derived deck height | what the visual is: a mock-up, a photo, a video, an embed, an SVG |
| all reads in `read()`, all writes in `draw()` | where it sits, how big it is, what surrounds it |
| `presence()` for the stage, `relay()` for copy, `inner()` for staying | how many parts there are, where they rest, where they come from |
| travel in element widths, never pixel constants | the layout: any of the four, or your own arrangement of `.bs-text` and `.bs-stage` |
| budgets against the **stage**, never the viewport; the camera is `min(taste, need)` | which moves, their names, their order — in **4 beats** (5 at most) |
| copy reflows, never scales | everything in `brand.css`: colour, face, shape, texture, motion feel |
| no brand values outside `brand.css` | which of the four demo mechanics you use, and new ones |
| reduced-motion end state; `bs-nojs`; `data-bs-part` on movers | |

Two things carry over from the wireframe into the real build:
`data-bs-part="name"` on every unit that moves (`beat-capture` reports timing
in those names), and the rule that a part that must overhang the subject lives
in the slot, not inside the clipped card. The wireframe look itself (dots,
dashes, labels, the layout switcher) switches off in the brand file
(`--wf-labels: none`, `--wf-outline: none`, `--surface-image: none`), which
`brand-from-url` does for you. Delete the `data-wf-label` attributes when the
deck is final.

Read `docs/model.md` before writing your first `draw()`. It is short and
every paragraph in it is a bug someone already paid for.

## Step 0: interview first. No code until there is a brief.

**Read `docs/intake.md` and run it before writing anything.** A beat deck
is an argument made in sequence, so building one from a guess about what the
product does produces a week of work that argues the wrong thing. The order
*is* the message, and no amount of copy editing fixes it afterwards.

The short form of the protocol:

1. **Say what this is** — a scroll-driven pinned sequence of beats, and that you
   need their story in beat form. Then immediately say you will propose the
   beats *back* to them. Never demand that they arrive with beats.
2. **Ask three things in one message**, not three: what do you build, what is
   this site for, and what is the URL.
3. **Ask for the brain dump** — everything about the product, offer, audience,
   what they say in a demo, unstructured, fragments fine. Derive the beats from
   that; do not make them do it.
4. **Take the brand from the URL** with `scripts/brand-from-url.cjs` before
   showing anything, so the first thing they see already looks like theirs. Its
   `voice` output (title, H1, opening copy) is raw material for the beats.
5. **Propose 4 beats back as a table** (5 at most), each with the move it
   uses and the line it says, and ask them to cut, reorder and reword.
6. **Confirm which beats to build.** Fewer beats beats thinner beats.
7. **Fill `templates/brief.md`**, save it beside the deck, then build.

If they say "just build something", do not block: take the URL, infer a
three-beat story from their own copy, build it, and show it with *"here's what I
read as your story — tell me what's wrong."* Guessing out loud with something on
screen is fine. Guessing silently is not.

## The workflow

1. **Turn the approved beats into a beat map.** One beat = one idea. The
   derivation rules and the sanity limits are at the end of
   `docs/intake.md`.
2. **Write the beat map down first**, in `templates/beatmap.md`, and put
   it in a comment at the top of the deck's script. Spans must be contiguous
   and cover 0→1; the engine warns in the console if they are not.
3. **Scaffold** from `gallery.html`: deck → pin → text + stage → scale
   wrapper. Copy `brand.css` beside it and replace it with the one
   `brand-from-url` generated. Pick the layout (`data-layout`), put the story's
   real media in the stage, **cut the timeline down to the 4 beats the story
   needs**, then **compose freely**: neither the gallery's arrangement nor its
   moves are a constraint (see the table above).
4. **Build beat by beat**, checking each one at `?beatdbg=1` before starting the
   next. Use `[` and `]` to jump between beats and `\` for the midpoint.
5. **Capture**: `node scripts/beat-capture.cjs <deck url>`. It scrubs the deck
   in 1% steps, screenshots every step and works out from the captures:
   - when each named part moves and is visible
   - every still stretch and how many screens of scroll it costs
   - whether each beat rests before its hand-off
   - each beat's resting position: offset from the centre of its own column,
     how much of the column it fills, the camera value, anything clipped or
     running into the text

   Then **open its `sheet.html`** (a timeline plus every beat's in / mid / out
   at 390, 768 and 1440, part boxes overlaid) and look. Run it after every
   change to timing or layout. It's how you find a dead stretch to `cut`, a
   beat that never lands, or a composition drifting off-centre.
6. **Sweep**: `bash scripts/sweep-beats.sh` covers 8 breakpoints × every beat,
   checking that nothing is clipped and there's no sideways scroll. Don't skip
   this because it looked fine. On this skill's own demo the sweep caught a
   768px failure that 390 and 1440 both passed.
7. **Look at it.** The contact sheet's mid stills are the resting compositions.
   Fitting and being composed are different things, and only one of them a
   script can check.
8. **Prove it's smooth**: `scripts/scroll-perf.mjs` scrolls the deck like a
   person in **WebKit (Safari's engine) and Chromium**, on desktop and an
   emulated iPhone. It measures dropped frames, JS per frame, frames that lag
   the scroll, and the jump when the iPhone address bar slides. Then open the
   published page on a real phone, which is slower than any headless run.
9. **Check the fallbacks**: `--force-prefers-reduced-motion` must render the end
   state, not a blank.
10. **Ship one file** when the host wants one: `node scripts/bundle.cjs
    deck.html --out dist/index.html` inlines the engine, its CSS and the brand
    (fonts included).

## Non-negotiables

- **The wireframe is never the deliverable.** It's grey and dotted so it
  can't pass for a design. Ship the user's brand and a composition built for
  their story. A deck that still looks like the wireframe (or merely recoloured
  in place, with the same boxes in the same spots) means the brief was never
  turned into a layout.
- **Brand values live in `brand.css` and nowhere else.** A hex code or font
  name typed into the deck's CSS is a rebrand that will silently miss it.
- **Size the visual against the stage, never the viewport.** `@container
  bs-stage`, `cqw`, `m.stageW`. Viewport rules break the moment the layout
  is split.
- **Prove timing from captures, not from the code.** `beat-capture` must report
  every beat moving, resting and handing off, with no dead stretch of a full
  screen or more, before a deck is done.
- **Interview before building.** See step 0.
- **Never type the deck's height.** The engine derives it from `story.vh` and
  the cut. A hard-coded `788vh` that no longer matches the cut silently re-times
  the whole sequence.
- **Every timing is story time `p`.** Not scroll fraction, not pixels, not
  percentages of the viewport. Harnesses seek with `deck.seekP(p)` so they speak
  the same units as the code.
- **All layout reads in `read()`, all writes in `draw()`.** A read after a write
  forces a synchronous layout; three per frame is the difference between 60fps
  and 20fps on a real phone.
- **Travel is element-relative.** `cardW * 0.6`, never `312px`. A pixel constant
  is correct at exactly one screen width.
- **The scale is a camera, and what it needs is computed.** `min(taste, need)`
  where `need` comes from measured widths — see `docs/responsive.md`. A
  hard-coded per-breakpoint scale is the single most common way these decks
  break on the screens nobody tested.
- **Copy never scales. Copy reflows.** Scaling text down to fit shrinks it on
  exactly the screens where it is already hardest to read.
- **Fade against travel, not against the beat.** Anything that overlaps
  something else must only fade while it is clear of it, or it reads as a
  glitch instead of a departure.
- **`presence()` for things that leave, `inner()` for things that stay.**
  `inner()` clamps to 1 and holds, so using it for a reveal leaves the reveal
  hanging open for the rest of the page.
- **Copy relays; it never crossfades.** One narrator block at a time: the old
  one fully exits, row by row, before the new one enters. `beat-capture` fails
  any frame showing two.
- **Toggle classes every frame.** A class set on the way down that is never
  removed breaks scrubbing back up.
- **Reduced motion ships the end state.** The page must make its point with the
  motion switched off.

## API, in one screen

```js
BeatScroll.create({
  deck: '#deck', pin: '#pin', stage: '.bs-stage',
  story: { vh: 720, at: [{ maxWidth: 820, vh: 620 }] },  // deck height derived
  cut:   [0.65, 0.70],            // skip a dead stretch INSIDE one beat
  beats: [{ name: 'draft', span: [0, 0.22] }, /* … contiguous to 1 */],
  tabs:  { into: '#tabs',         // optional chip row above the copy
           label: function (b, i) { return 'Beat ' + (i + 1); } },
  scale: function (f, m) { /* the camera → --bsScale */ },
  read:  function (f) { return { cardW: card.offsetWidth }; },
  draw:  function (f, m) { /* writes only */ }
});
```

Inside `draw(f, m)`:

| call | what it gives you |
|---|---|
| `f.p` `f.q` | story time / scroll fraction |
| `f.ramp(a, b)` | 0→1 between two story points (the workhorse) |
| `f.eramp(a, b)` | the same, eased |
| `f.inner('name')` | the beat's own 0→1, resting before the hand-off |
| `f.presence('name')` | 0→1→0 across the beat, for anything that must leave |
| `f.relay('name')` | `{enter, exit}`, the sequential hand-off for copy: never overlaps |
| `BeatScroll.poses(base, steps).at(f)` | the chained pose (rotation, copies, shape, depth …) at this scroll position |
| `f.set/px/deg(n, v)` | write `--n` on the pin. Only for values that change rarely: per-frame values go on their own element |
| `f.toggle(el, cls, on)` | class, re-evaluated every frame |
| `f.note(label, v)` | show a working number in the HUD |
| `f.scale` | the camera value already resolved this frame |
| `f.vw` `f.vh` `m.stageW` | measured, never assumed |

CSS can read `--bsBeat` on the pin and `--bsScale` on `.bs-scale`, plus
whatever `draw()` writes. `--bsP`, `--bsQ`, `--n-<beat>` and `--i-<beat>` are
**off** unless you pass `cssVars: true`. They change on nearly every frame, and
a custom property on the pin restyles the whole deck each time, which is a
Safari stutter. Write what CSS needs onto the element that uses it (see "Smooth
on Safari" below).

**The narrator is a row relay.** `BeatScroll.rows('#roll')` splits each copy
block into its visual rows. In `draw()`, `narr.draw(k, f.relay(k).enter,
f.relay(k).exit)` retires the current block row by row and only then brings
the next one in, row by row. It uses no mask and never shows two messages.
See `docs/model.md` → "The narrator".

**Beat tabs.** Pass `tabs` and the engine builds a static chip row from the beat
map — one chip per beat, `--on` set to that beat's presence (so the highlight
crossfades through a hand-off) and `.is-on` on the strongest. They are buttons
that jump to their beat's resting midpoint; `seek: false` makes the row
decorative instead. It must live **outside** the narrator's relay box, or it
gets hidden along with the copy. Label them for a reader — "Build / Launch / Test / Scale", not
"Beat 3".

## Smooth on Safari (and everywhere)

Scroll decks have a reputation for being laggy, jumpy or glitchy on Safari,
and the causes are specific. The engine handles the first two; the rest are
yours, and the gallery shows each.

1. **The address bar.** An iPhone's toolbar slides away mid-scroll and resizes
   the viewport. A deck that maps scroll through `innerHeight` or sizes itself
   in `vh` re-maps the whole story each time. Measured on the old engine, that
   snapped the story 3–5%, hundreds of pixels. The engine now **locks** the
   viewport height (it re-measures only on a width change or a change bigger
   than any toolbar) and sizes the pin and deck in pixels from that lock.
2. **Custom properties on the pin.** One there restyles everything inside the
   deck each frame it changes. The engine keeps its per-frame values off the
   pin; do the same in `draw()`: write rotations onto the element that
   rotates, and per-copy values onto each copy.
3. **Reading layout every frame.** Sizes don't change while scrolling
   (transforms never move a layout box), so measure in `read()` only when
   `f.why !== 'scroll'` and reuse the numbers. A read after the previous
   frame's writes forces a full layout, every frame.
4. **Deciding faces with `backface-visibility`.** WebKit stops honouring it as
   soon as anything flattens the 3D (a `filter`, a `clip-path`), and paints
   the later face on top: the gallery's mirrored back face showed through its
   3D move and replaced its phone crop, in WebKit only. Work out which way the
   item faces from your own angles and toggle the faces' `visibility`.
5. **Faces in one plane** z-fight mid-flip in Safari (the flicker). Nudge each
   face `translateZ(0.1px)` off the card.
6. **Layers.** `will-change: transform` on the few boxes that move every frame
   (slot, turn), never on per-word or per-dot elements. A phone runs out of
   layer memory long before a desktop does.
7. **Heavy paint.** A large blurred `box-shadow` or a `filter` on a moving box
   costs more on a phone than everything else combined. Keep filters to the
   beat that needs them (toggled per frame), and check `scroll-perf` with the
   real brand's shadows.

`?beatdbg=1` shows the frame cost live, and flags a p95 over 4ms as heavy for a
phone. `deck.perf()` returns the same numbers to a script.

## Files

| path | what it is |
|---|---|
| `beat-engine.js` | the engine. Inline it or link it; ES5, no deps |
| `beat-engine.css` | deck/pin/stage/scale scaffolding, the four layouts, narrator relay, fallbacks |
| `brand.css` | **every visual and motion token**, neutral wireframe by default; rebrand = replace it |
| `gallery.html` | **the move gallery**: one item, nine moves, as a neutral wireframe — start here (`?layout=`, `?brand=`) |
| `templates/brief.md` | the strategic brief the interview fills in |
| `templates/beatmap.md` | the technical beat map, filled from the brief |
| `docs/intake.md` | **the interview. Run it first** |
| `docs/model.md` | story time, cuts, presence, the recipes, the traps |
| `docs/responsive.md` | one composition on every screen; the camera and the budget |
| `docs/verify.md` | how to prove it, and what fooled us before |
| `scripts/brand-from-url.cjs` | **rebrand from a URL**: writes brand.css (+ fonts, sources, contrast report) |
| `scripts/beat-capture.cjs` | **timing and position from screen captures**, plus the contact sheet |
| `scripts/beat-audit.html` | walks every painted element at every beat |
| `scripts/sweep-beats.sh` | breakpoints × beats, pass/fail |
| `scripts/cdp-probe.cjs` | evaluate/screenshot inside a running Chromium |
| `scripts/scroll-perf.mjs` | **smoothness in WebKit + Chromium**, desktop + iPhone (needs Playwright, see its header) |
| `scripts/bundle.cjs` | one self-contained HTML file: engine, CSS, brand and fonts inlined |
| `scripts/syntax-check.cjs` | parse every inline script after an edit |

Serve over HTTP (`python3 -m http.server 8769`) — on `file://` the harnesses
cannot see into their iframe and fail silently in a way that looks like a
rendering bug.

