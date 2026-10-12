# One sequence, every screen

The requirement is not "it works on mobile". It is **the same story, with the
same impact, at 390px and 1440px** — same beats, same order, same emphasis.
That rules out the two things people reach for first.

## The two wrong answers

**Wrong answer 1: re-choreograph per breakpoint.** A phone version, a tablet
version, a desktop version. Three sequences to design, three to debug, three to
keep in step, and they drift within a week. It also multiplies the states to
check by three, which in practice means nobody checks them.

**Wrong answer 2: one reference width, uniform scale.** `scale = stageW / 1040`.
Geometrically perfect, identical composition everywhere — and on a 390px phone
it renders the whole stage at **37%**, so the card that should own the screen is
a 146px thumbnail. This skill's own demo shipped that on its first pass; the
measurement is in the commit history. Identical geometry, impact thrown away.

## The right answer, in three parts

### 1. Size the contents relative to the stage

The stage's own contents are sized against the stage, not in fixed pixels:
`width: min(520px, 100%)`. At rest, every screen fits at **scale 1** and the
subject is always as big as that screen allows. A phone gets a full-width card;
a desktop gets a 520px card in a 1040px stage.

Give the stage gutters (`padding: 0 clamp(14px, 4vw, 24px)`). At scale 1 on a
phone the composition would otherwise touch both viewport edges, leaving nothing
for a shadow, a rotation, or a part resting on an edge.

### 2. The scale is a camera

It does what a camera does: it pulls back when a beat needs more room than the
screen has. It is the **smaller of two numbers**:

```js
scale: function (f, m) {
  var split = f.eramp(0.48, 0.62);          // the beat that widens the group
  if (split <= 0) return 1;                 // at rest, no camera at all

  var PROJ = 1.06, FLOOR = 0.42;
  var sepF   = m.stageW < 640 ? 0.50 : 0.60;
  var groupW = (m.cardW + 2 * m.cardW * sepF) * PROJ;   // MEASURED width
  var need   = Math.min(1, (m.stageW * 0.94) / groupW);  // what the STAGE demands
  var taste  = 0.78;                                    // what the composition wants

  return 1 - (1 - Math.max(FLOOR, Math.min(taste, need))) * split;
}
```

- **`taste`** is a compositional choice. Easing back as a second element arrives
  reads as *here is the whole picture*, which is why a wide desktop pulls back
  a little even though it does not need to.
- **`need`** is computed from measured widths, never typed. Hard-coding it per
  breakpoint is how 768px broke on the first demo's first sweep while 390 and 1440
  both passed: a typed constant cannot know the card-to-screen ratio at a width
  nobody tested.
- **`PROJ`** exists because a `rotateY` under perspective paints wider than the
  element's layout box — the near half grows more than the far half shrinks.
  Measure it (raise it until the sweep passes, no further). It was 1.22–1.26 on
  the Leadpages deck's steeper rotation, 1.06 on the first demo's gentler one.
  The gallery computes it per move from the angle instead (model.md → "Moves").
- **The group width is the real one.** Both cards move outward in a split, so the
  group is `cardW + 2 * sep`, not `cardW + sep`. Getting this wrong is what the
  768px failure actually was.

### 3. Budget the fit against the stage

Anything that grows within a beat — a fan, a stack opening out, a panel
translating away from its parent — gets its own budget in `draw()`:

```js
var FAN  = m.stageW <= 520 ? 0.42 : m.stageW <= 780 ? 0.52 : 0.62;
f.set('lx', FAN);                     // written by JS, so CSS can't drift from it
var room = (m.stageW * 0.94) / (m.cardW * f.scale * (1 + FAN));
var bS   = Math.min(base, Math.max(0.55, room));
```

`m.stageW` is the stage's own box (`.bs-stage`, gutters included), which the
engine measures for you. Three things to hold on to:

- **Budget the stage, not the viewport.** In a `stack` layout on a phone the
  stage *is* the viewport, so nothing changes. In a `split` layout the stage
  is half the screen, and a budget against the viewport lets the visual
  wander into the text with nothing crossing a screen edge, so the sweep
  passes. The stage is never wider than the viewport, so a stage budget can't
  produce a clip the viewport budget would have prevented. `beat-capture`
  fails any beat whose resting visual runs into the text.
- **Thresholds key off the stage too.** `m.stageW < 640`, not `f.vw < 700`.
  A 1440px screen in `split` gives the visual about 750px: a "desktop" by the
  viewport and a tablet by the room it actually has. Inside the stage, CSS
  follows the same rule: `@container bs-stage (max-width: 620px)` and `cqw`,
  never `@media` and `vw`. The engine CSS makes the stage a named container
  for this.
- **Multiply by `f.scale`.** Everything inside the scale wrapper is already
  multiplied by the camera, so a budget that ignores it is wrong by exactly that
  factor. Leaving it out of the Leadpages fan shrank the fan to a third of the
  space it had on a phone. The engine hands you `f.scale` for this reason.
- **Centre on the group's own midpoint**, not with a constant nudge. A fixed
  "move it left a bit" is right at one width and wrong everywhere else.

A constant that both JS and CSS need (`FAN` ↔ `--lx`) is best **written by
JS** (`f.set('lx', FAN)`), so the two can't disagree. If CSS has to own it,
change both in the same edit and put a comment on each saying so.

## When the floor bites: re-choreograph the beat

If `need` falls below the floor, the beat has genuinely outgrown the screen and
more shrinking only makes it illegible. **This is the one legitimate reason to
change a beat per breakpoint.** A side-by-side comparison becomes one card in
front of another; a three-across fan becomes a vertical stack.

Do it by changing *that beat's arrangement*, never its timing: same span, same
narration, same order. The reader on a phone must get the same story at the same
point in the scroll.

## Copy never scales

Text is outside the scale wrapper, always. Scaling copy down to fit shrinks it
on exactly the screens where it is already hardest to read. Copy **reflows**:

```css
@media (max-width: 620px){
  .nar{flex-direction:column}   /* the mark drops below the box */
  .nar-mark{order:2}
  .nar-box{order:1;width:100%}  /* and the box takes the full width */
}
```

That reflow is a layout change to the copy block only. The beat sequence is
untouched.

## Scroll length per screen

`story: { vh: 720, at: [{ maxWidth: 820, vh: 620 }] }`

A phone's `vh` is worth fewer pixels, and a phone reader is flicking rather than
wheeling, so identical `vh` makes a deck feel longer on a phone than on a
desktop. Shortening it on small screens keeps the *pace* the same even though
the pixel count differs. Change `vh`, never the beat spans — the spans are the
story, and the story is the same everywhere.

## Clipping is decided once

```css
.bs-section { position: relative; overflow: clip; }
html, body { overflow-x: clip; }
```

- On the **section**, not the pin: a beat that flies a part in from off-stage
  needs to leave the pin's box.
- `clip`, not `hidden`: `hidden` can make the element a scroll container, which
  breaks `position: sticky` in ways that are hard to trace.
- `overflow-x` on the root so a wide beat can never hand the reader a sideways
  scrollbar.

The trade is deliberate: anything that must stay readable has to be made to
**fit**. Removing the clip trades a clipped edge for a page that scrolls
sideways on a phone, which is worse. `scripts/sweep-beats.sh` asserts both
halves — nothing clipped *and* no sideways scroll.

## Things that legitimately leave the frame

A losing variant sliding out, lanes flowing in from beyond the edge. These are
motion, not defects, and the tell is that they clip **identically at 1440 and at
390**. Pass them to the sweep as `--ignore .card--a,.lane`.

Do not add a selector to `--ignore` to quieten a real failure. The only value
the sweep has is that it is allowed to say no.

## The breakpoint tiers

Three tiers, and the numbers that change between them are only ever separation
factors, fan constants and scroll length:

| tier | test widths | what changes |
|---|---|---|
| phone | 390, 414 | tighter separation, shorter scroll, copy stacks |
| tablet | 560, 768, 834 | the in-between that breaks first — always test it |
| desktop | 1024, 1280, 1440 | the composition at its reference size |

768 and 834 are where these decks fail. They are wide enough to get the
"desktop" branch of every `f.vw < N` test and narrow enough not to have the room
that branch assumes. Never test only a phone and a laptop.
