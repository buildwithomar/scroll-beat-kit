# The model

Read this once before writing a `draw()`. Every section is a bug that has
already been paid for.

## Story time is not scroll

Two clocks, and confusing them is the commonest error in these decks.

- **`q`** — scroll fraction. 0 when the deck's top hits the top of the
  viewport, 1 when its bottom does. What the reader controls.
- **`p`** — story time. Where we are in the sequence. What every timing in your
  code is written in.

They are the same thing until you add a **cut**. A cut is a stretch of story
time in which nothing on stage moves — a beat has finished its move and the
next has not begun. Readers experience that as the sequence stalling while they
keep scrolling. The engine skips it: `cut: [0.65, 0.70]` removes 5% of story
time from the scroll, and shortens the deck by the same 5% so **every other
beat keeps exactly the scroll length it was designed with**.

Don't cut the whole dead stretch. In an earlier version of the demo, a split
finished at 0.62 and nothing moved again until 0.70. Cutting from 0.62 sent
the finished split straight into the next line with no moment to land, and
`beat-capture` reported "split never rests". Leave a short rest (there
0.62–0.65, about a fifth of a screen) and cut the rest. `beat-capture`
measures still stretches in screens of scroll, which is how you find where a
cut belongs and how much of it to take.

Consequences you must hold on to:

- All of `beats`, `cut`, `ramp()`, and every literal threshold you type is in
  `p`. Never in `q`.
- Anything outside the engine that seeks by scroll works in `q`. Convert with
  `deck.toQ(p)`, or better, use `deck.seekP(p)` and never think about it.
- The deck's height depends on the cut, which is why the engine sets it. Typing
  a height into CSS and later changing the cut re-times the whole sequence, and
  nothing tells you.
- A cut must sit **inside one beat**. Straddling a boundary cuts the hand-off
  itself, which is the one part of the sequence that has to stay continuous.
  The engine warns if you do it.

Add a cut when you *measure* a dead stretch (the HUD's `p` against a stage that
is not changing), not speculatively.

## Presence and inner

Every beat gives you two envelopes, and choosing the wrong one is the second
commonest error.

```
inner(i)     0 ────────/‾‾‾‾‾‾‾‾‾‾‾‾  clamps to 1 at 78% of the span, HOLDS
presence(i)  0 ───/‾‾‾‾‾‾‾‾‾‾‾\────   rises, holds, falls back to 0
```

- **`inner()`** for a change that should happen and **stay**: a wireframe
  becoming real, a URL typing in, a badge arriving. It rests before the beat
  ends, which is what gives each beat a moment of stillness before the hand-off.
- **`presence()`** for anything that must also **leave**: a fan that opens and
  closes, a panel that slides in and out, a card that swivels and comes back.

Use `inner()` for something that has to leave and it will hang open for the rest
of the page. Use `presence()` for something that should stay and it will
mysteriously undo itself as the next beat arrives.

Presence windows are **centred on the boundaries**, not inset from them: the
outgoing beat is at exactly the strength the incoming one lacks, so the pair
sums to 1 at every point. Inset windows leave a dead gap at every hand-off —
survivable for the stage, fatal for a narrator.

## The narrator: a row relay — one block at a time

If the deck carries a block of copy per beat, it is the reader's thread. The
default is a **relay**: the current block retires row by row, top row first;
only when it is completely gone does the next block arrive, row by row. Two
messages are never on screen together, and nothing is masked.

```js
var narr = BeatScroll.rows('#roll', { item: '.bs-line' });   // before create()
read:  if (f.why !== 'scroll') narr.measure();
draw:  for (var k = 0; k < narr.blocks.length; k++) {
         var r = f.relay(k); narr.draw(k, r.enter, r.exit);
       }
```

- **`f.relay(k)` is not `f.presence(k)`.** Presence windows are centred on the
  boundary, so the outgoing and incoming beats overlap. That's right for the
  stage, and wrong for copy, because parked mid-hand-off it prints two
  messages. Relay puts the exit in `[end − w, end]` and the next entry in
  `[end, end + w]` (`w` = `relay`, default 0.032 of story).
- **Rows, not the block.** `rows()` wraps each word (keeping inline markup),
  then groups words into the rows the browser actually wrapped them into, and
  reveals a row at a time. A block sliding as one slab is a transform. Rows
  walking down the lines is typography: it reads in the order the eye does.
- **No mask.** Each row only rises `rise` em (0.55) as it enters and lifts
  `lift` em (0.32) as it exits, while it fades. It never travels far enough to
  need clipping, so no frame edge slices a row on its way in.
- **Snappy is out-cubic.** Each row takes `rowDur` (half) of the window,
  staggered top to bottom. Arrival is out-cubic, with most of the move in its
  first third. Exit is the in-cubic mirror, so a row lingers, then goes.
- **Rows re-measure with the layout.** `measure()` in `read()`, only when
  `f.why !== 'scroll'`. It reads `offsetTop`, not `getBoundingClientRect`,
  because mid-reveal words carry transforms and a transformed box puts a rising
  word on the wrong row.
- **Underlines move onto the words.** Words are inline-block (an inline box
  ignores transforms), and a parent's `text-decoration` doesn't reach inside
  one: the parent keeps painting it on the gaps between words. A fully hidden
  row left stray dots in the box until `rows()` started moving an `<em>`'s
  decoration onto its words.

What it replaced, and why each was wrong:

1. **Inset presence windows.** Each line left before the next arrived, but
   across a window of 2 × `fade`, so the box stood empty for a stretch of
   scroll at every hand-off. The relay's exit ends *exactly* where the entry
   starts: the box is empty for an instant, not a stretch.
2. **Cross-fade in place.** The box was always full, but parked half-way it
   printed two messages on top of each other. `beat-capture` now fails any
   frame where two `line:*` blocks show text.
3. **Roll through a masked window** (`.bs-roll`, still in the CSS as an
   alternative). One line's worth of copy at all times, but it is a transform
   on a slab, and a mask edge slices every line as it passes through it.
- **A typewriter is time-based, not scroll-based.** If subtext types in after a
  line lands, that is a timer, so a probe must sample it *over time* after
  seeking, not read it once. And a line that leaves must complete its text
  immediately rather than freeze half-typed.

## Moves

The gallery (`gallery.html`) is one item performing a vocabulary of moves.
Every move in it follows these rules, and so should any you invent.

**Chain them with `BeatScroll.poses`.** Declare the pose each beat rests in
and let the engine interpolate:

```js
var tl = BeatScroll.poses({ ry: 0, panes: 1, chips: 0 }, [
  { pose: { chips: 1 } },                                            // assemble
  { pose: { chips: 0, ry: 180 }, stage: { chips: [0.02, 0.14], ry: [0.1, 0.42] } }, // flip
  { pose: { panes: 3 } }                                             // split ×3
]);
draw: var P = tl.at(f);   /* P.ry, P.panes, P.chips — write them */
```

A step names only what it changes. `move` is the window (as fractions of the
beat) in which it changes; `stage` gives one property its own window, so a
beat can retract the chips *before* it flips. Finish every move well before
the beat's end (the gallery uses 0.42). The rest has to clear both the
caption relay and the tabs' crossfade, and with short beats those eat a
quarter of each one.

**Three nested boxes, three jobs.** `.slot` positions (split, fan), `.turn`
rotates (flip, spin, backflip, tilt), and `.face` is what you see. Merging
slot and turn makes a split copy *orbit* the item instead of sliding beside
it. Give `.slot` its own `perspective`, so each copy turns about its own
centre.

**Things that silently flatten 3D.** On any element between `.turn` and the
layers it holds, each of these collapses the subtree back into one plane. The
move then still runs, but as a flat card:

- `opacity` below 1. The gallery fades `.real`'s *parts* in, never `.real`.
- `overflow` other than visible. The front face stops clipping only while it
  is exploded (`.is-3d`, toggled every frame).
- `clip-path` and `filter`. An earlier "shape" move cropped the item with
  `clip-path` and outlined it with drop-shadow filters, which flattened it
  and, in WebKit, let the back face paint over the crop. Its replacement
  (*responsive*) uses neither.

**A device change is a reflow, not a crop.** Cropping a desktop window into a
phone outline trims its edges off and keeps the desktop layout: it reads as
the content being cut, not as it adapting. The *responsive* move changes the
item's real width and corner radius, and drives the layout from one 0→1
value (`--m`): the hero grows taller, the lines widen to the column, the
button goes full width. Every proportion slides with `--m`, so it reflows
continuously instead of snapping at a breakpoint mid-scroll. It is the one
move that re-lays out per frame, so it is contained: only the card's own
subtree, only during its window, with the card's height pinned so nothing
outside it moves. Measured, it adds nothing visible to the frame cost. Read the
item's width from its slot, which never narrows, or a re-measure mid-move sees
the narrowed card.

**Decide which face shows; don't trust `backface-visibility`.** WebKit drops it
the moment the 3D flattens and paints the later face on top. The gallery
toggles `.back-on` when `cos(rx)·cos(ry) < 0`, which hides one face and shows
the other with `visibility` (that doesn't flatten anything). The swap lands
edge-on, so it's never seen.

**Inside a 3D scene, depth decides what's on top, not `z-index`.** Within a
`preserve-3d` subtree the browser sorts by each element's Z. Nudging the
faces `translateZ(0.1px)` (the Safari flicker fix) put them in front of the
chips at depth 0, and every chip disappeared halfway behind the edge it
straddles, in WebKit and Chromium alike. Lifting the chips 1px to compensate
fixed the stacking but made them re-rasterise as the page scrolled, a faint
shimmer the timing check caught as screen change in a still beat. The fix
that holds: nudge the faces **only while the item turns** (`.is-turning`,
on whenever the chips are away, which every turn ensures first), so at rest
faces and chips share a plane and DOM order puts the chips on top. No
harness caught the hidden chips: the sweep checks the viewport edge, not
overlap order, so look at the stills.

**A back face needs to out-rank the card.** `.card.face--back { position:
absolute; inset: 0; transform: rotateY(180deg) }`. As plain `.face--back` it
lost to `.card { position: relative }` at equal specificity, stacked *under*
the front, and the flip revealed a sliver.

**Every move declares its footprint, and the camera fits it.** Width *and*
height, from measured sizes:

| move | footprint |
|---|---|
| split | `1 + 2 × (largest offset, either side)` items wide. Twice the farthest copy, because the camera zooms about the centre and a row mid-transition is lopsided. Budgeting the span clipped the long side at six widths. |
| rotation about Z (tilt) | the rotated box: `W cos θ + H sin θ` wide, `W sin θ + H cos θ` tall. A guessed factor fit a wide desktop card and clipped every tall phone card. |
| rotation about X or Y | the near edge widens under perspective, by about 6–8% at 45°. The X term was missing until a backflip clipped a 414px phone by 3px. |
| 3D lift | `layers × step × sin(tilt)` added to the height |
| chips | the overhang plus their travel, which is a fraction of the item (12%), never pixels. A fixed 74px flew them in from off-screen on a phone. |

**Re-choreograph only below the floor, and only that beat.** A three-way split
on a narrow stage becomes a fanned hand (offsets × 0.42, a tilt, a dip, the
centre copy in front), with the same timing, copy and order.

**Equal beats are not a rule.** The gallery's last beat is three-quarters
length: it has no hand-off to rest before, and at full length its hold read
as a stall.

## Recipes

### A thing hardens into a real thing
Two layers in the same box, opposite opacities on one ramp:
`f.set('real', f.eramp(0.04, 0.17))`, with `.wire{opacity:calc(1 - var(--real))}`.
Then **switch off the placeholder's animation** once it is invisible
(`f.toggle(pin, 'wire-off', real > 0.995)`). An invisible animation still costs
a paint on every frame of every beat that follows. On the Leadpages deck, 18
still-running gradient animations were a measurable part of a 20ms frame.

### Parts fly in, rest on an edge, fly out
Travel is the primary; opacity is a function of travel.

```js
var arrive = f.ease(f.clamp((inQ  - i * 0.14) * 3.2));   // staggered
var depart = f.ease(f.clamp((outQ - i * 0.06) * 2.6));
var out    = Math.min(1, (1 - arrive) + depart);          // 0 at rest, 1 gone
chip.style.setProperty('--out', (out * TRAVEL) + 'px');
chip.style.setProperty('--o', 1 - f.clamp((out - 0.35) / 0.4));
```

The `0.35` matters: opacity only opens once the chip is **clear of the thing it
overlaps**. Fade it against the beat instead and it dissolves while still on top
of the card, which reads as a bug.

**Separate the slot from the card.** The card clips its own contents — rounded
corners, the chrome bar's rule — so anything that must overhang it cannot live
inside it. Put the card and its overhanging parts in a `.slot` wrapper with no
overflow, and move the beat's transform to the slot:

```html
<div class="slot slot--a">     <!-- moves; no overflow -->
  <div class="tag">A 4.1%</div>          <!-- sits above the card -->
  <div class="card card--a">…</div>      <!-- clips its own insides -->
  <div class="chips">…</div>             <!-- rests over the card's edge -->
</div>
```

This demo shipped its first pass without the slot, and `overflow:hidden` on the
card silently ate three chips and both A/B tags. Nothing crossed the viewport,
so the sweep passed; the effect was simply not there. `beat-audit.html?clip=1`
now reports this class of loss.

### Two events that are one idea
Overlap them. On the Leadpages deck, publishing (the URL typing in) and the A/B
split ran back to back and read as two unrelated events no matter how the copy
was worded. Started four thousandths apart, they read as one move.

The same logic applies to the narration: if two visual phases are one idea to
the reader, give them **one line spanning both**, unioning the windows. Mapping
one line to two spans and taking whichever is present fades it out and back in
mid-sentence.

### Mid-beat z-order
Something can enter *behind* another element and be raised once there is a
reason. Toggle a class on the pin at the moment of the reason
(`f.toggle(pin, 'pin-b-front', wins > 0)`) and let CSS own the z-index. Toggled
every frame, so scrubbing back lowers it again.

### An intro that settles into the pinned seat
A deck that starts in the first fold — the stage large under the headline, then
shrinking into its pinned position — is the most bug-prone thing in this family.
What was learned the hard way:

- **Run the intro on PAGE scroll, not deck scroll.** `p` only starts moving once
  the deck's top reaches the viewport, so an intro keyed to `p` does nothing for
  the first several hundred pixels of scrolling and then starts late, producing
  a wait, a collision with the site nav, and two visibly different curves where
  there should be one. Use `f.scrollPx / introEnd` where
  `introEnd = f.deckTop + 0.07 * f.storyTotal`.
- **One curve, `easeOut`, moving from the very first pixel.** An in-out curve
  reads as the page hesitating before it responds.
- **Measure the seat, never predict it.** Two rounds of computing the target
  position from `offsetTop`/`offsetHeight` seated it perfectly in headless
  Chrome and straight through the headline in a real browser.
  `getBoundingClientRect()` reports where the thing actually is, transforms
  included.
- **Re-seat on load, resize, `fonts.loadingdone`, and two rAFs after init.** The
  first measurement otherwise runs against a half-styled layout. The engine
  already fires `run()` on all four.

## Performance

The three things that actually cost frames, in the order they were found:

1. **`backdrop-filter` inside a moving, 3D-transformed subtree.** 22 of them
   over flat colour were indistinguishable from no filter at all in
   screenshots, and expensive on every frame. Screenshot with and without
   before paying for glass inside the stage.
2. **Animations that are still running while invisible.** Gate them off with a
   class the moment their layer is gone.
3. **Layout reads interleaved with writes.** This is what the `read()`/`draw()`
   split exists to prevent. Do not reach for `getBoundingClientRect()` inside
   `draw()`.

Headless Chrome uses software raster, so treat its frame timings as directional
only. The GPU cost of `backdrop-filter` under a 3D transform is *larger* on a
real machine, not smaller.
