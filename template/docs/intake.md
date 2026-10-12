# Intake — from first question to beat map

**No code until there is a brief.** This is a gate, not a suggestion.

A beat deck is an argument made in sequence: it says *this, then this, then
this, and that is why you should care*. Built from a guess about what the
product does, it is a week of work that argues the wrong thing beautifully.
The sequence cannot be fixed afterwards by editing copy — the order **is** the
message.

So the first turn is a conversation, and it produces a filled-in
`templates/brief.md`. Then you build.

---

## Step 1 — say what this is

Most people have not thought about their site as a sequence of beats, so say
what you need and why before asking for it. Adapt, do not recite:

> This builds a scroll-driven sequence — a section that pins while the reader
> scrolls and runs through a fixed set of "beats", each one showing a single
> thing changing. It works best when it tells a short story, so I need your
> story in beat form. Easiest way in: tell me about what you're building and
> I'll propose the beats back to you.

The last sentence matters. **Do not require the user to arrive with beats.**
Asking "what are your four beats?" of someone who has never built one of these
gets you four topics, not four changes. Get the raw material and derive them.

## Step 2 — the three openers, asked together

Ask all three in one message. Three separate questions is an interrogation.

1. **What do you build?** The product or service, in their own words.
2. **What is this site for?** Who lands on it and what one thing should happen.
3. **What is the URL?** The live site, or the closest thing — a competitor, a
   deck, a Figma, anything real.

The URL is the highest-value answer of the three: it carries the brand, the
voice and half the story, and it is the one thing that lets you stop guessing.

## Step 3 — ask for the brain dump

Then ask for the mess. Give explicit permission for it to be unstructured —
people withhold good material because they are trying to format it.

> Now just dump everything you know, unstructured — what it does, who it's for,
> what happens before and after someone uses it, what you say when you demo it,
> what people get wrong about it, what the competition does worse. Bullet
> fragments are fine. I'll find the beats in it.

What to fish for while reading it:

| looking for | because |
|---|---|
| a **sequence** already in their words — "first they…, then we…" | that is usually the beat map, already written |
| the **moment of change** — where the product does the thing | the strongest beat, and it is often buried |
| the **before/after** contrast | gives you the first and last beat for free |
| the **one number** they are proud of | the payoff beat |
| what they say **out loud in a demo** | far better copy than what is on their current site |

If the dump is thin, do not push twice. Go to the URL, infer, and propose
something concrete for them to react to. **People edit far better than they
author.**

## Step 4 — take the brand from the URL

Do this before proposing beats, so what you show them already looks like theirs.
The scaffold is a neutral wireframe (grey, dotted, every box labelled with
its role) precisely so that nothing of it survives into the real deck by
accident. The brand replaces its tokens, and the story replaces its layout.

**One command:**

```bash
node scripts/brand-from-url.cjs https://their-site.com --out <deck folder>/brand.css
```

It reads the live, rendered site and writes every token in `brand.css`,
the brand's font files beside it, a `.json` of where each value came from, and
a contrast report. Then show them the demo in their clothes before any beats
exist:

```
gallery.html?brand=<path to their brand.css>&layout=split
```

**Read its notes before trusting it.** They name every judgement call:

| the note says | what to do |
|---|---|
| the most prominent button is colourless; accent taken from … | usually right. If not, pick from `accent candidates seen` and edit `--accent` |
| no coloured button / monochrome above the fold | a monochrome brand is legitimate: keep it, and let emphasis come from weight, not colour |
| "X" renders on the site but its file could not be located | add it by hand. When the family exists on Google Fonts, it's already been added from there |
| border / secondary text was too faint, stepped toward ink | fine. The deck needs edges the site could do without |
| shadow copied | check it on the subject. A glow that suits a dark marketing site can be heavy on a mock-up |

How it decides the hard ones:

- **Accent** is the brand's signature colour. That's the fill of the most
  prominent button, unless that button is white or black, in which case a
  coloured button or link wins. Consent banners are ignored, because their
  "Accept" button is the most prominent button on half the web.
- **Ink** is the *strongest* widely-used text colour (often the headings), not
  the paragraph colour. The paragraph grey becomes `--dim`.
- **Fonts** are downloaded, not linked. Font hosts refuse other sites, so a
  linked brand font silently becomes Arial. The browser's own record of what
  it loaded is the source of truth.
- **`--good` is never invented.** It's `var(--accent)` unless they have a real
  success colour.

With the Leadpages / HTML Pub MCP connected, `analyze_url` adds content,
structure and imagery to the script's `voice` output, which is useful for the
brain dump in step 3. With neither available, fill `brand.css` by hand
from the site's CSS: the token names are the contract.

Then **compose for their story, not for the wireframe.** Choose the layout
for the story: `split` when the copy carries as much as the visual, and
`stack` when the visual is the star. The wireframe shows one arrangement of
each mechanic; the brief decides the real one. If their subject is a phone,
the subject is a phone. If their "parts" are three logos that dock underneath
it, they dock underneath it. Keep the contract (docs/GUIDE.md → "Fixed vs free")
and move everything else.

Note the brand file's path in the brief, so the next session doesn't
re-derive it. The generated file already switches the wireframe look off;
delete the `data-wf-label` attributes and the WIREFRAME banner comment once
the deck is real. Keep `data-bs-part` on everything that moves.

## Step 5 — propose the beats back

Give them a table, not prose: **four beats**, each with the move that says it
and the line it says. Pick each move for what it *means* (the gallery in
`gallery.html` pairs every move with what it can say), or invent one the
story needs.

```
1  Meet it         assemble   the product resolves; integrations dock   "One page, everything plugged in."
2  Before → after  flip       it flips to the cluttered old way          "Here's what you're replacing."
3  Your plan       split ×3   it splits into three plan tiers            "Pick the size that fits."
4  One platform    fold       the tiers fold back into one               "And it's all one platform."
```

Show them the gallery with their brand (`demo.html?brand=…`) beside the
table, so they can see each move rather than imagine it.

Then ask for exactly three things, which is as much as anyone will usefully do
in one pass:

> Cut anything that isn't earning its place, reorder if the order's wrong, and
> rewrite any line that doesn't sound like you.

## Step 6 — confirm the build set

They may not want all of it. Ask which beats to build now, and say what the
trade is: **fewer beats is better than thinner ones.** Four beats that each
open, rest and hand off beat seven that blur together.

If they want more than five, say so plainly and offer to merge the ones that
are one idea to a reader. Two moves can share a beat when they say one thing
(flip home, *then* split).

## Step 7 — write the brief, then build

Fill in `templates/brief.md` and save it next to the deck (not in the
skill folder). It is the strategic half; `templates/beatmap.md` is the
technical half you fill in next. Then follow the build workflow in `docs/GUIDE.md`.

---

## Deriving spans from the approved beats

1. **One beat = one idea.** Two visible phases that are one idea to the reader
   (calling a winner, then showing why it won) are one *narrated* beat over two
   *stage* phases — keep both phases in `beats` and union their narration
   windows. See `model.md`.
2. **Weight spans by what the reader must absorb**, not by how much work the
   animation is doing. A new concept earns more scroll than moving something
   already seen.
3. **Contiguous, covering 0→1.** The engine warns on gaps.
4. **Start with round numbers.** `[0,.25] [.25,.5] [.5,.75] [.75,1]` is a
   fine first draft. Tune with the HUD open, and with `beat-capture`'s rest
   lengths.
5. **No cut yet.** Add one only where you *measure* a dead stretch.
6. **Name the beats for the tabs.** The tab row is built from the beat map, so
   the names the user approved become the labels. "Build / Launch / Test /
   Scale" tells a reader far more than "Beat 1".

## Sanity limits

- **Four beats, five at most.** Two is a transition; three works for a single
  idea. Past five, the reader loses the thread before the payoff, which is why
  the nine-beat gallery is a catalogue and never a page.
- **Roughly 100–150vh of scroll per beat.** Less and a beat cannot open, rest
  and hand off; more and readers think the page is broken.
- **One deck per page, usually.** Two pinned sequences compete for the reader's
  sense of where they are.
- **The subject must survive its smallest screen.** If a beat needs three
  things side by side, check 390px at the map stage — that constraint shapes
  the beat, and it is far cheaper to know now.

## When they will not engage

Some people answer "just build something". That is a legitimate answer — do not
block on the interview.

1. Take the URL (ask for that one thing if you have nothing at all).
2. Pull the brand, infer a three-beat story from their own homepage copy.
3. Build it, screenshot it, and show it with: *"Here's what I read as your
   story — tell me what's wrong and I'll re-cut it."*
4. Fill the brief from what they then correct.

The gate exists to stop you guessing silently. Guessing **out loud**, with
something on screen to react to, is fine.

## Do not ask about

Anything you can show and change in a minute: exact spans, easing, scroll
length, whether a chip enters from the left or right, how long the deck is.
Build the first pass and let them react to something real.
