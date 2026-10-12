# Scroll Beat Kit: binding contract

This resource builds **scroll-driven beat sections**: a pinned stage where **text and a
visual** move through a short sequence of beats as the reader scrolls. The reader's scroll
is the timeline: no autoplay, no snapping, and scrolling back up undoes everything exactly.
These rules are BINDING for scroll-section work in this project.

The full guide is `scroll/docs/GUIDE.md`, with the depth in `scroll/docs/` (the interview,
the motion model, responsive rules, verification). Read the guide before writing your first
deck, and `docs/model.md` before your first `draw()`.

## What ships

Copied into the project as `scroll/` (never clobber, see below):

- `scroll/gallery.html` — **the move gallery**: one item performs every move (assemble,
  flip, spin, split ×2, split ×3, fold, backflip, responsive, 3D parts), with the text naming
  each and what it can mean. A reference, not a deck.
- `scroll/beat-engine.js` + `beat-engine.css` — the engine. Don't edit per deck.
- `scroll/brand.css` — the neutral wireframe brand: every colour, face, shape, texture and
  motion-feel token.
- `scroll/templates/` — `brief.md` (strategy) and `beatmap.md` (timing), filled per deck.
- `scroll/scripts/` — `brand-from-url.cjs`, the checks, and `bundle.cjs`.
- `scroll/docs/` — the guide and references. `scroll/README.md` is the human quickstart.

## Setting up (detect FIRST — never clobber)

1. **No `scroll/` yet** → copy `template/` from this resource to `<project>/scroll/`.
2. **`scroll/` exists** → do NOT re-scaffold. Say it's set up, and offer a new deck in it.
3. **Each deck is its own folder**: `scroll/<deck-name>/` with `index.html`, `brand.css` (and
   that brand's fonts), `brief.md` and `beatmap.md`. **Never overwrite an existing deck**; make
   a new folder. Git is the safety net.

Serve `scroll/` over HTTP for every preview and check (`cd scroll && python3 -m http.server
8769`). On `file://` the checks fail silently in a way that looks like a rendering bug.

## The rules of the kit

1. **Interview before building.** Say what this is, then ask in ONE message: what they build,
   what the page is for, the URL. Ask for an unstructured brain dump. Derive the beats
   yourself (`docs/intake.md`); never make them arrive with beats.
2. **Brand from the URL, before proposing anything.**
   `node scripts/brand-from-url.cjs <url> --out <deck>/brand.css` reads the live site and
   writes every token, downloads the brand's fonts beside it, and reports contrast and every
   guess. Show the gallery in their brand (`gallery.html?brand=<deck>/brand.css`). Act on the
   script's notes. **Never bundle one brand's licensed fonts into anything but that brand's
   own deck.**
3. **Four beats.** Five at most. Each beat is one idea said by one move, chosen for what it
   *means*. Propose them back as a table (move + the line it says) and build only what they
   approve. The gallery's nine is a catalogue, never a page.
4. **The gallery is a vocabulary, not a layout.** Copy its mechanics, then compose freely:
   real item, real chips, any media in the stage, any of the four layouts (`data-layout`:
   `stack`, `stack-below`, `split`, `split-reverse`), combined and invented moves. A deck
   that still looks like the grey wireframe isn't finished.
5. **Brand values live in `brand.css` only.** No hex code or font name in a deck's own CSS.
6. **The fixed contract** (`docs/GUIDE.md` → "Fixed vs free"): timings in story `p`; all
   reads in `read()`, all writes in `draw()`; `presence()` for the stage, `relay()` for copy,
   `inner()` for things that stay; travel in item widths, never pixels; budgets against the
   **stage**, never the viewport; copy reflows, never scales; reduced motion ships the end
   state.
7. **Smooth on Safari** (`docs/GUIDE.md` → "Smooth on Safari"): no per-frame custom
   properties on the pin, sizes measured only on resize, faces decided from angles (never
   `backface-visibility` alone), filters only in the beat that needs them.
8. **Prove it, don't eyeball it.** Before calling a deck done:
   - `node scripts/beat-capture.cjs http://localhost:8769/<deck>/` must pass: every beat
     moves, rests and hands off; nothing is clipped; the text never overlaps.
   - `bash scripts/sweep-beats.sh --src ../<deck>/index.html` must pass at 8 widths.
   - `scripts/scroll-perf.mjs` must pass in WebKit and Chromium (setup is in its header).
     If Playwright isn't installed, say so and ask before installing it.
   - Then look at the stills. A script proves nothing is clipped, not that it's composed.

## Building one deck (the loop)

1. Interview, brief (`templates/brief.md` → `<deck>/brief.md`), brand from the URL.
2. Propose four beats; get approval.
3. Copy `gallery.html` → `<deck>/index.html`. Point its links at `../beat-engine.css`,
   `../beat-engine.js` and the deck's own `brand.css`. Cut the timeline to the approved
   beats, fill the beat map (`<deck>/beatmap.md`), put the real item and media in.
4. Build beat by beat at `?beatdbg=1` (HUD: story time, beat map, frame cost).
5. Run the checks (rule 8), fix, and run them again.
6. `set_preview` the deck so the user sees it, then commit.
7. Shipping to a single-file host: `node scripts/bundle.cjs <deck>/index.html --out
   <deck>/dist/index.html` inlines the engine, CSS, brand and fonts.

## Secrets & assets

Brand fonts and media live in the deck's folder (committed). API keys and tokens belong in
Granular's Vault, never in these files.
