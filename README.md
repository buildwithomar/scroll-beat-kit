# Scroll Beat Kit

A Granular **creator resource** by [@buildwithomar](https://github.com/buildwithomar).

Build **scroll-driven product stories**: a section that pins in place while the reader
scrolls and plays a short sequence of beats. Text and a visual move together: a product
window flips to show before and after, splits into three pricing tiers, folds back into one,
goes responsive, or comes apart in 3D. Scroll back up and everything rewinds exactly.

Rebrand it from any website URL, and prove every deck is unclipped, well-timed and smooth in
**Safari and Chrome, on desktop and phone**, before it ships.

## What's in this resource

| File | Purpose |
|------|---------|
| `manifest.json` | Library metadata (id, tags, tile, seed prompt). |
| `RESOURCE.md` | The binding contract an agent follows when building a deck. |
| `icon.svg` | The library tile. |
| `template/` | The files copied into a project as `scroll/` when the resource is installed. |
| `template/gallery.html` | **The move gallery**: one item performing every move, with what each can mean. |
| `template/beat-engine.js` / `.css` | The engine: story time, the narrator relay, the camera, layouts, fallbacks. |
| `template/brand.css` | Every look and motion token. Neutral wireframe by default. |
| `template/scripts/` | `brand-from-url`, the checks (`beat-capture`, `sweep-beats`, `scroll-perf`), `bundle`. |
| `template/docs/` | The full guide: interview, motion model, responsive rules, verification. |
| `template/templates/` | The brief and the beat map, filled per deck. |

## The moves

assemble · flip · spin · split into two · split into three · fold back into one · backflip ·
responsive · 3D parts. These are examples, combined and extended per story. A real deck is
**four beats**.

## How a deck gets made

1. **Interview:** what you build, what the page is for, the URL. Then an unstructured brain dump.
2. **Brand from the URL:** `scripts/brand-from-url.cjs` reads the live site (colours, fonts,
   button shape, logo), downloads the brand's fonts, checks contrast, and writes one `brand.css`.
3. **Four beats** proposed back as a table (move + line), built only once approved.
4. **Checks:** clipping at 8 widths, timing (every beat moves, rests and hands off; text never
   overlaps), and scroll smoothness in WebKit and Chromium including the iPhone address-bar
   resize that makes most scroll decks jump on Safari.
5. **Ship:** `scripts/bundle.cjs` inlines everything into one HTML file for any host.

## Requirements

- Chrome or Chromium for the checks (found automatically, or `CHROME_PATH`), and Node 22+.
- The smoothness check also needs Playwright: `npm i playwright && npx playwright install webkit chromium`.
- Brand fonts downloaded by `brand-from-url` are licensed to that brand: use them only in
  that brand's own pages.

## License

MIT
