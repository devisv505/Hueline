# Mini Factory: art asset prompts

Prompts for the icons and art Mini Factory would use. The target look is
`docs/reference/factory.webp` — a screenshot of the prototype running.
**Attach that image to every prompt.**

This is **not** the Pawzzle look. Pawzzle is warm wood, jelly cats and brown
outlines; Mini Factory is cool, flat and papery: white, pastel, soft shadows, no
outlines. Do not reuse `docs/ASSET_PROMPTS.md` at the repo root as a style guide.

---

## 0. How to use this

1. Generate `01` first. It sets the line weight and corner radius everything else
   has to match.
2. For every prompt after `01`, attach **two images**: `factory.webp`, plus your
   approved `icons.png`. Those prompts already say *"Image 2 is the approved style"*.
3. Save each result under the exact filename shown and put it in
   `prototype_1/assets/raw/`. The sheets get sliced with the repo's existing tool —
   see §5 — so don't crop anything yourself.
4. Regenerate a sheet if it has the wrong number of items, if items touch, if the
   line weights drift between items, or if it contains text. Even spacing and one
   consistent stroke width matter far more than clever detail.

**Which tool**
- **ChatGPT (GPT image)** — recommended. Transparent background, and 1536×1024
  divides into exact 256×256 cells for the 6×4 sheet below.
- **Gemini** — keeps a style consistent well, but cannot do transparency. The
  prompts fall back to flat magenta, keyed out at slice time with `--key ff00ff`.
- **Midjourney** — poor at exact grids. Generate one icon per prompt: copy the
  sheet prompt, keep the style paragraph, and describe a single icon.

**Gameplay, for context:** ore deposits drop primary colours onto conveyor belts
the player draws by hand. Mixers combine two different colours into a third
(blue + yellow = green). Splitters feed two belts in turn. Shops order a colour
and pay credits. Belts cannot cross without a bridge, and a mixer flooded with
one colour overflows and burns out.

---

## 1. Built in code (no image needed)

Most of what you see is drawn to canvas, because its colour is **data**, not art:

| Element | Why it stays code |
|---|---|
| Belts, bridges, the moving dashes | Drawn along an arbitrary path the player made |
| Items riding the belt | Tinted per colour, 7 colours × any count |
| Deposits, shops | Tinted per colour; a sprite would need 7 variants each |
| Buffer chips, order dots, the overflow ring and its fuse arc | Driven by live numbers |
| Paper grid, pastel districts, the river | Generated per run from the seed |
| All text and numbers | Web font **Nunito** |

So the sheets below are **UI icons** plus optional decoration. If you want the
machines themselves to look hand-made, sheet `04` is the one to generate — the
mixer and splitter housings are the only two buildings with no colour of their own.

---

## 2. Palette

Sampled from `js/config.js` and `css/style.css`. Use these exact values.

| Name | Hex | Where |
|---|---|---|
| Ink | `#3F4654` | icon strokes, text |
| Ink soft | `#7D8699` | dimmed icons |
| Paper | `#FFFFFF` | belts, machine housings, cards |
| Line | `#E6E9EF` | grid, hairlines |
| Pink | `#EF7F9C` | the accent: titles, the store |
| Teal | `#7FCFC9` | the river |
| Alarm red | `#EC5A5A` | overflow |
| Go green | `#60BD81` | a valid placement |
| Ruby | `#EE6A66` / deep `#CF4B47` | primary ore |
| Cobalt | `#6CA7E8` / deep `#4B85CB` | primary ore |
| Amber | `#F3C44D` / deep `#D9A52A` | primary ore |
| Fern | `#7CCF8C` / deep `#55B26B` | blue + yellow |
| Plum | `#9B7BDE` / deep `#7A58C4` | red + blue |
| Coral | `#F2954E` / deep `#D6742C` | red + yellow |
| Slate | `#8C8494` / deep `#6D6576` | all three |

---

## 3. The style paragraph

Every prompt below opens with this. If you write a prompt of your own, paste it in
verbatim — it is what keeps a new sheet matching the old ones.

```
Style: flat vector game UI, modern and geometric, like a clean transit map or a
well-made infographic. Chunky rounded strokes of ONE consistent weight, round
caps and round joins, generous corner radii, no tapering. Solid flat fills only:
no gradients, no texture, no bevels, no inner glow, no gloss. No outlines around
shapes in a darker shade. Flat front view, perfectly symmetrical where the object
allows, optically centered. Calm, friendly, uncluttered — readable at 18 pixels.
```

---

## 4. Prompts

### 01 · `icons.png`: the whole UI icon set (1536×1024)

24 icons in a 6×4 grid. At 1536×1024 each cell is exactly 256×256, which is why
those numbers matter — keep them.

```
Use the attached image as the COLOUR and MOOD reference only (do not copy its layout).

Style: flat vector game UI, modern and geometric, like a clean transit map or a well-made infographic. Chunky rounded strokes of ONE consistent weight, round caps and round joins, generous corner radii, no tapering. Solid flat fills only: no gradients, no texture, no bevels, no inner glow, no gloss. No outlines around shapes in a darker shade. Flat front view, perfectly symmetrical where the object allows, optically centered. Calm, friendly, uncluttered — readable at 18 pixels.

Colour: every icon is drawn in dark slate #3F4654 ONLY, except where a colour is named below. Stroke weight is identical across all 24 icons — pick one width around 9% of a cell and never vary it.

Create a clean sprite sheet: exactly 6 columns × 4 rows = 24 icons. Each icon centered in its own equal-size invisible 256×256 cell with at least 18% empty margin. All icons the same optical size and weight. Icons never touch or overlap. No grid lines, no circles or squares behind the icons, no labels, no numbers.

Row 1 — the line:
1. CONVEYOR BELT: a horizontal stadium/pill outline with a small solid roller circle near each end, and one small rounded square sitting on top of the belt in the middle (a parcel being carried).
2. FAST BELT: the same stadium outline, but instead of rollers it holds two right-pointing chevrons side by side.
3. BRIDGE: a horizontal line that stops short on both sides, with a clear gap in the middle, and a vertical stadium/pill crossing over that gap — one lane passing over another.
4. SPLITTER: one horizontal line entering from the left that forks into two lines going up-right and down-right, with a small solid dot at each of the three ends.
5. ERASE: a small belt segment with a diagonal line struck through it.
6. PLUS: a thick plus sign with rounded ends.

Row 2 — the machines:
7. MIXER: a circle outline with a small solid dot at its centre, two short lines angling into it from the upper-left and lower-left, and one short line leaving to the right — two inputs, one output.
8. ORE DEPOSIT: a rounded square outline containing three solid circles of slightly different sizes, clustered like nuggets.
9. SHOP: a rounded square outline whose top fifth is a solid filled band (an awning), with a small solid circle in the lower half.
10. ALARM: a rounded triangle outline with an exclamation mark inside, drawn in alarm red #EC5A5A.
11. VENT: a funnel or hopper outline with three short lines dropping out of its spout.
12. SHIELD: a classic shield outline with a thick rounded tick inside it.

Row 3 — money and meta:
13. STORE: a shopping bag — a trapezoid body with rounded corners and a semicircular handle on top — drawn in pink #EF7F9C.
14. CREDIT: a coin — a circle outline with a smaller concentric circle inside — drawn in pink #EF7F9C.
15. LAB: a conical laboratory flask with a narrow neck, a flat lipped rim on top, and two small solid bubbles inside the wide base.
16. STAR: a solid five-pointed star with rounded points.
17. HELP: a question mark with a rounded stem and a separate round dot beneath it.
18. CLOSE: a thick X of two crossed strokes with rounded ends.

Row 4 — transport controls:
19. PLAY: a solid right-pointing triangle with rounded corners.
20. PAUSE: two thick vertical rounded bars.
21. FAST FORWARD: two solid right-pointing rounded triangles side by side.
22. RESTART: a circular arrow, a near-complete ring with a small solid arrowhead at the top-right and a clear gap.
23. SOUND ON: a solid speaker trapezoid with two curved waves to its right.
24. SOUND OFF: the same solid speaker with a small X to its right instead of waves.

No text, numbers, letters, watermark or signature anywhere in the image. No cast shadows, no drop shadows, no background panels behind the icons.
Background: fully transparent PNG. If transparency is impossible, use a solid flat #FF00FF magenta background with no gradient or texture.
```

### 02 · `logo.png`: game title (1536×1024)

```
Image 1 is the colour and mood reference.

Style: flat vector game UI, modern and geometric. Solid flat fills only: no gradients, no texture, no bevels, no gloss, no outlines in a darker shade.

A game logo reading exactly "MINI FACTORY" on two lines: "MINI" small on the first line, "FACTORY" large on the second. Geometric rounded sans-serif, heavy weight, generous letter spacing on "MINI". "MINI" in slate grey #7D8699, "FACTORY" in pink #EF7F9C. Above the words, a single small decoration: three rounded squares in Cobalt #6CA7E8, Amber #F3C44D and Fern #7CCF8C sitting in a row on a short white conveyor belt with a soft grey shadow beneath it. Centered, filling about 80% of the width, with clean empty margins.

Spell "MINI FACTORY" exactly, no other text, no tagline, no watermark.
Background: fully transparent PNG (fallback: solid flat #FF00FF magenta).
```

### 03 · `app_icon.png`: favicon and home-screen icon (1024×1024, opaque)

```
Image 1 is the colour and mood reference.

A square app icon, full bleed to the edges, no rounded corners (the platform adds them). Flat vector, solid fills, no gradients or gloss.

On a white background with a very faint pale grey square grid: one white conveyor belt with a soft grey drop shadow running from the lower-left to the upper-right, carrying three round dots — Cobalt #6CA7E8 and Amber #F3C44D entering from the left, and a single Fern green #7CCF8C dot leaving to the right. In the middle of the belt, a white rounded square machine with a soft shadow and a simple grey circular rotor mark on it. One soft pastel pink #F9CDD8 organic blob behind the composition in the upper-left, and one pale teal #A9E4E0 blob in the lower-right, both well behind the belt. Bold, simple and readable at 32 pixels: three dots, one machine, one belt, nothing else.

No text, letters, numbers or watermark. Fully opaque, no transparency.
```

### 04 · `machines.png`: machine housings, optional (1024×1024)

Only generate this if you want the mixer and splitter to look drawn rather than
code-drawn. They are the only two buildings with no colour of their own, so they
are the only two a fixed sprite can replace. Deposits and shops must stay code-drawn.

```
Image 1 is the colour and mood reference (see the white machines in the middle of the floor). Image 2 is the approved icon style: match its stroke weight and corner radii.

Style: flat vector, top-down, solid flat fills, no gradients, no gloss, no outlines in a darker shade. Soft neutral drop shadow directly beneath each item, offset slightly down, no other shading.

Create a clean sprite sheet: 2 columns × 2 rows, each item centered in its own equal-size invisible cell with at least 15% empty margin; items never touch; no grid lines, no labels. Each item is a square machine housing with generously rounded corners, filling about 80% of its cell, in near-white #F7F8FA with a thin #E6E9EF inner border:
1. MIXER, idle: a grey #7D8699 three-bladed rotor mark centered on the housing, like three short arcs around a small solid hub.
2. MIXER, working: the same housing and rotor, plus a thick Fern green #7CCF8C arc running three quarters of the way around just inside the housing edge (a progress ring).
3. SPLITTER: a slate #3F4654 fork mark centered on the housing — one line entering from the left, splitting into two lines leaving up-right and down-right, a small solid dot at each of the three ends.
4. BROKEN MACHINE: the same housing in a slightly warmer grey with a thick alarm red #EC5A5A ring just inside its edge and a red exclamation mark centered on it.

No text, numbers, letters or watermark beyond the exclamation mark named above.
Background: fully transparent PNG (fallback: solid flat #FF00FF magenta).
```

---

## 5. Slicing the sheets

The repo's existing tool handles it. From the repo root:

```sh
python3 tools/slice_sheet.py prototype_1/assets/raw/icons.png --grid 6x4 --size 192 \
  --out prototype_1/assets/img/icons \
  --names belt,belt-fast,bridge,splitter,erase,plus,\
mixer,ore,shop,alarm,vent,shield,\
store,credit,lab,star,help,close,\
play,pause,fast,restart,sound,mute

python3 tools/slice_sheet.py prototype_1/assets/raw/machines.png --grid 2x2 \
  --names mixer,mixer-busy,splitter,broken \
  --out prototype_1/assets/img/machines --fit item
```

Add `--key ff00ff` to either command if the sheet came back on magenta.

---

## 6. Wiring them in

Today every icon is an inline `<symbol>` in `index.html`, drawn with `currentColor`,
so it is crisp at any size and recolours itself for the `low`, `locked` and pink
store states. **Raster icons lose both.** Two sensible options:

- **Trace them.** Generate the sheet for the *design*, redraw the ones you like as
  SVG paths, and replace the `<symbol>` bodies. Keeps `currentColor`, keeps every
  state, costs nothing at runtime. This is the one I would pick.
- **Ship the PNGs.** Replace `<svg class="icon"><use href="#i-belt">` with
  `<img class="icon" src="assets/img/icons/belt.webp">` and drop the `fill:
  currentColor` rule in `css/style.css`. Then the `.pill.low` red state and the
  pink store tint stop working, so generate a second tinted copy of any icon that
  needs to change colour, and keep the sprites at 3× (192 px for a 64 px slot) for
  retina.

Either way, these names map 1:1 onto the `#i-*` symbol ids already in
`index.html`, except `erase`, `plus`, `shop`, `alarm`, `vent`, `credit` and `star`,
which are spares for the delete-belt tool, the vent action and a future results
screen.
