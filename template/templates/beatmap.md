# Beat map — <deck name>

Fill this in BEFORE writing any `draw()`, and paste the table into a comment at
the top of the deck's script. Six months from now it is the only thing that
explains why the numbers are what they are.

The worked example below is a 4-beat deck for a made-up product, built from
moves in the gallery (`gallery.html`). Replace it; keep the shape.

## The map

**4 beats** (5 at most). Each one is one idea, said by one move.

| # | name (tab label) | span (story p) | move | the stage does | the line says |
|---|---|---|---|---|---|
| 0 | `Meet it`  | 0.00 – 0.25 | assemble | the product window resolves; four integrations dock as chips | "One page, everything plugged in." |
| 1 | `Before → after` | 0.25 – 0.50 | flip | chips retract; it flips to the old, cluttered version on the back | "Here's what you're replacing." |
| 2 | `Your plan` | 0.50 – 0.75 | split ×3 | flips home and splits into three plan tiers | "Pick the size that fits." |
| 3 | `One platform` | 0.75 – 1.00 | fold | the tiers fold back into one; the chips return | "And it's all one platform." |

Spans must be contiguous and cover 0 → 1. The engine warns in the console if
they are not. Equal spans are a default, not a rule: a final beat with no
hand-off can be shorter.

## Poses

The rest pose of each beat, for `BeatScroll.poses`. State only what changes:

```js
BeatScroll.poses({ real: 0, chips: 0, ry: 0, panes: 1 }, [
  { pose: { real: 1, chips: 1 } },
  { pose: { chips: 0, ry: 180 }, stage: { chips: [0.02, 0.14], ry: [0.1, 0.42] } },
  { pose: { ry: 360, panes: 3 }, stage: { ry: [0.04, 0.24], panes: [0.2, 0.42] } },
  { pose: { panes: 1, chips: 1 }, stage: { panes: [0.03, 0.3], chips: [0.22, 0.42] } }
]);
```

Every move finishes by ~0.42 of its beat, so it rests before the hand-off.

## Cut

*None in the example.* Only add a cut where you have **measured** a dead
stretch: `beat-capture.cjs` lists every still stretch with its length in
screens of scroll, and `?beatdbg=1` shows it live. A cut must sit inside a
single beat, never across a boundary, and should leave the beat a short rest
rather than taking the whole stretch.

## Scroll length

`story: { vh: 480, at: [{ maxWidth: 820, vh: 420 }] }`

About 120vh of story per beat on desktop, a little less on a phone. The spans
stay identical; only the pixel length changes, so the pace feels the same on a
device where `vh` is worth less and the reader is flicking rather than
wheeling.

## Camera

What each move needs, as its footprint (model.md → "Moves"):

- beat 1 `flip` — about 6% wider at mid-turn, from perspective
- beat 2 `split ×3` — `1 + 2 × 1.12` items wide at rest; more mid-transition
  from the lopsided row is already covered by the "farthest copy" budget. On a
  narrow stage it fans instead.
- beat 3 `fold` — shrinking back, so the split's budget covers it

Constants shared between JS and CSS (note both sides, or write them from JS):

| JS | CSS | meaning |
|----|-----|---------|
| | | |

## Per-beat notes

Anything measured rather than guessed, with the number and where it came from:

-

## Verified

- [ ] `beat-capture.cjs`: OK at 390 / 768 / 1440, in the layout you ship
- [ ] `sweep-beats.sh`: PASS at all eight widths
- [ ] the contact sheet's mid stills looked at by a person
- [ ] reduced motion renders the end state
- [ ] scrubbed the whole deck backwards once by hand
