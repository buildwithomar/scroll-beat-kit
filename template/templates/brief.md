# Beat brief — <product / page name>

The strategic half. Filled from the user's own answers (see
`docs/intake.md`), before any code. Save it next to the deck you are
building, not in the scroll/ folder.

`beatmap.template.md` is the technical half, and it is filled in from this.

---

## 1. The basics

| | |
|---|---|
| **What they build** | *in their words, not yours* |
| **What the site is for** | *who lands, and the one thing that should happen* |
| **URL** | |
| **Audience** | |
| **The one goal of this page** | *if there are two, pick the one the deck serves* |

## 2. The brain dump

Paste their raw answer here, unedited. Do not tidy it — the phrasing they used
out loud is usually better copy than anything on their current site, and you
will want to come back to it.

> …

**What was mined from it**

- the sequence already in their words:
- the moment of change (the strongest beat):
- the before → after contrast:
- the number they are proud of:
- the phrase worth keeping verbatim:

## 3. Brand — taken from the URL, not invented

Generated with `node scripts/brand-from-url.cjs <url> --out <deck>/brand.css`.

| | |
|---|---|
| **brand file** | *path to their brand.css* |
| **accent** | *the value, and whether the script's pick was kept or changed (from `accent candidates seen`)* |
| **faces** | *display / body, and how each loads: downloaded, Google Fonts, or added by hand* |
| **notes acted on** | *each note from the script's report, and what was done about it* |
| **motion feel** | *default, or what was tuned (`--bs-row-dur`, `--bs-rise`, `--bs-lift`) and why* |

- [ ] every note in the script's report read and resolved
- [ ] fonts actually render: platform-font check (`CDP_FONTS_SEL`), not "looks right on my machine"
- [ ] contrast report clean, or each LOW line accepted on purpose
- [ ] no brand value typed outside `brand.css`
- [ ] `data-wf-label`s and the WIREFRAME banner deleted
- [ ] `data-bs-part` kept on every unit that moves

## 3b. Layout and visual

- **Layout:** *stack / stack-below / split / split-reverse, and why this story wants it*
- **The visual is:** *mock-up in HTML, screenshot, photo, video, embed, SVG*
- [ ] the layout was composed for this story, not left in the wireframe's spots
- [ ] everything inside the stage sizes against the stage (`@container`, `cqw`, `m.stageW`)

## 4. The approved beats

What the user signed off in step 5 of intake. The **name** column becomes the
tab labels, so name them for a reader.

| # | name (tab label) | the stage does | the line says |
|---|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |

**Cut from the proposal, and why** — worth keeping, because it stops the same
beat being re-proposed next session:

-

## 5. The subject

The one thing on stage for the whole sequence. (The *kind* of visual is in 3b;
this is what it is in this story.)

- **What it is:**
- **How it is rendered:** *screenshot, mock, live DOM, illustration*
- **Its smallest-screen form:** *does it survive 390px, or does a beat need a
  different arrangement there? See responsive.md → "when the floor bites"*
- **Assets needed:** *and whether they exist yet*

## 6. Constraints

- **Where it goes:** *new page, or into an existing section*
- **Ships as:** *single file, host with an asset pipeline, component in a build*
- **Must not break:** *existing nav, an A/B test, analytics, a CMS region*
- **Accessibility:** the end state must read with motion reduced — what is it?

## 7. Signed off

- [ ] beats and their order confirmed by the user
- [ ] lines read in their voice, not the scaffold's
- [ ] brand replaced
- [ ] `beat-capture` OK at 390 / 768 / 1440 and its contact sheet looked at
- [ ] `beatmap.template.md` filled in from this
