# Hueline

An automation game with no spreadsheets in it. Ore deposits drop primary
colours, mixers combine two different colours into a new one, and shops want
whatever the mixers can make. You do one thing: draw the belts.

Plain HTML, CSS and JavaScript modules, with no build step. It started life as
`prototype_1/` in [Pawzzle](https://github.com/devisv505/Pawzzle) and moved here
once it outgrew being a prototype; the history came with it.

## The loop

| Piece | What it does |
|---|---|
| **Ore deposit** | Drops one ore every few seconds: Ruby, Cobalt or Amber. It only sends. |
| **Mixer** | Holds up to six items and combines any two colours that react. |
| **Splitter** | One belt in, two or more out, fed in turn. Researched, then bought. |
| **Shop** | Wants one colour. Every matching delivery is a point. |
| **Belt** | A one-way lane from a deposit or mixer into a mixer, shop, or another belt. |
| **Bridge** | Spent where one belt has to hop another. You start with two. |

Mixing is set union over the three primaries, so the recipe table never has to
be written out:

```
Cobalt + Amber  → Fern     (blue  + yellow)
Ruby   + Cobalt → Plum     (red   + blue)
Ruby   + Amber  → Coral    (red   + yellow)
Ruby   + Fern   → Slate    (all three)
```

Two colours only react when each brings something the other lacks: Cobalt and
Fern do nothing, because Fern already contains blue.

## The three rules that make it a game

1. **Belt tiles are finite.** The counter in the header is your whole budget.
   Pull a belt up by tapping it and the tiles come back. **Press and hold a
   machine** and a ring closes around it; when it fills, the machine comes up in
   hand to drop somewhere else or scrap. Moving takes its belts with it and
   hands back the tiles. Scrapping gives back no credits.
2. **Belts cannot cross.** Where a route has to hop another belt it spends a
   bridge, and a belt has to run straight across one — no turning up there.
   They *can* join, though: drop a belt onto a running lane and its load merges
   in, so two sources share one line. Splitting a line still takes a splitter —
   merging is free, branching is not.
3. **A mixer fails if its input buffer overflows.** Six of one colour with no
   partner will never clear itself, so the machine sounds an alarm and burns
   out fifteen seconds later, which ends the run. Tap a flashing machine to
   dump its buffer for five points — the escape hatch when a route goes wrong.

## Credits, the store and the lab

Every delivery pays credits by how deep the colour is: a primary is 1, a mix 2,
and Slate 4. The big number under the floor is still orders delivered; credits
are what you spend.

The **store** sells belt tiles and bridges outright, and mixers, splitters and
ore deposits as machines you then **drop wherever you want** — the board shows a
ghost under the cursor and a green box when the spot is clear, and nothing is
charged until you put it down. Machines need a cell of air around them and
cannot sit on a running belt.

The **lab** sells research, which is permanent:

| Tech | What it buys you |
|---|---|
| Splitters | Unlocks the splitter in the store |
| Express belts | 20% quicker, twice over |
| Wider buffers | Mixers hold eight instead of six |
| Reinforced machines | An overflowing machine holds on half as long again |

Only shops arrive on their own now, and only ever asking for a colour the floor
can already make. No more than two will ever want the same colour: once every
makeable colour has its shops, arrivals stop until you buy an ore deposit that
opens up new recipes. Everything that supplies them, you buy and place yourself.

## Drawing a belt

Press a deposit or a mixer and drag. The route re-plans towards your finger on
every move, preferring long straight runs, so it comes out looking drawn rather
than stepped. It also remembers where you dragged: sweep out and around an
obstacle and the belt follows your detour instead of cutting the corner. Release
on a machine to lay it, anywhere else to throw it away.

## Layout

| Path | What |
|---|---|
| `js/config.js` | Colours, the mixing rule, and every tunable number |
| `js/world.js` | The grid, the belt router, and what the floor may look like |
| `js/sim.js` | One tick: ore drops, items move, mixers craft, buffers overflow |
| `js/render.js` | The whole canvas: paper, districts, belts, bridges, machines |
| `js/input.js` | Drawing, erasing and tapping |
| `js/main.js` | Screens, upgrades, the heads-up display, the frame loop |
| `js/fx.js`, `js/audio.js` | Bursts, toasts, confetti and synthesized blips |
| `tests/factory.test.mjs` | The rules above, as assertions |
| `docs/ASSET_PROMPTS.md` | Prompts for generating the icon art |
| `docs/reference/factory.webp` | Style reference to attach to those prompts |

`config.js`, `world.js` and `sim.js` never touch the DOM, so the whole game can
be run headless — which is what the tests do.

## Art

Everything on the floor is drawn to canvas and every icon is an inline SVG
symbol, so the game ships with no image files at all. `docs/ASSET_PROMPTS.md`
holds the prompts if you want generated icon art instead, along with the palette,
the slicing command and a note on what you give up by swapping SVG for PNG.

## Running it

```sh
npm start        # serves the folder on http://localhost:8080
npm test         # the rules, as assertions
```

Any static file server works. Opening `index.html` straight from disk doesn't,
because browsers block JavaScript modules on `file://`.

## Deploying

GitHub Pages lets a browser hold on to `js` and `css` for a while, and an ES
module graph is cached per URL — so versioning only the entry script leaves
every import it pulls in stale, and a half-old build runs. Before pushing a
change you want live, stamp a new version across the stylesheet, the entry
script and every relative import at once:

```sh
python3 tools/bump_version.py
```

## Where it would go next

- Mergers, to go with the splitters.
- A mixer that can be told which recipe to prefer, for when three colours arrive.
- Selling a machine back, or picking one up and moving it.
- Hand-authored levels with a fixed belt budget, scored like a puzzle rather than a run.
- Belt speed per lane, so the interesting decision is where to spend the fast ones.
