# Scroll Beat Kit

Build **scroll-driven product stories**: a section that pins in place while the reader
scrolls, and plays a short sequence of beats. A product window flips to show "before and
after", splits into three pricing tiers, folds back into one, goes responsive. The text
beside it changes with each beat. Scroll back up and it all rewinds.

## Look first

```bash
cd scroll && python3 -m http.server 8769
```

Open **http://localhost:8769/gallery.html** and scroll. That's every move the kit has an
example of. Add `?layout=split` to see the text beside the visual instead of above it.

## Make one for your brand

Ask your agent: *"Make a scroll section for https://your-site.com"*. It will:

1. Ask what you build and what the page is for.
2. Read your brand off your website (colours, fonts, button style, logo) and show you the
   gallery wearing it.
3. Propose four beats, each a move plus a line of copy, and build only once you agree.
4. Check it's unclipped at every screen width, well-timed, and smooth in Safari and Chrome.

## What's here

```
scroll/
├─ gallery.html          the move gallery (open this)
├─ beat-engine.js / .css the engine
├─ brand.css             the neutral default brand (every look + motion token)
├─ <deck-name>/          each deck you build: index.html, brand.css, fonts, brief, beat map
├─ templates/            brief + beat map
├─ scripts/              brand-from-url, the checks, the single-file bundler
└─ docs/                 the full guide
```

## Good to know

- **Four beats** makes a strong section. Past five, readers lose the thread.
- **Your brand's fonts** are downloaded into your deck's folder so they load correctly.
  They're licensed to your brand: fine for your own pages, don't redistribute them.
- **Shipping to a page builder or CMS** that wants one file:
  `node scripts/bundle.cjs <deck>/index.html --out <deck>/dist/index.html`
- **The checks** need Chrome (found automatically, or set `CHROME_PATH`). The smoothness
  check also needs Playwright: `npm i playwright && npx playwright install webkit chromium`.
