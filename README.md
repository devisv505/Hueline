# Hueline

An automation game with no spreadsheets in it. Ore deposits drop beads of the
three primary colours, mixers combine two different colours into a new one,
presses squeeze two matching beads into a bigger one, and a hub in the middle of
the floor asks for one item at a time. You do one thing: draw the belts.

Plain HTML, CSS and JavaScript modules, with no build step. It started life as
`prototype_1/` in [Pawzzle](https://github.com/devisv505/Pawzzle) and moved here
once it outgrew being a prototype; the history came with it.

## The loop

| Piece | What it does |
|---|---|
| **Hub** | Sits in the middle and asks for one item. Only that item counts; anything else is scrapped at the door. It cannot be moved. |
| **Ore deposit** | Drops one bead every few seconds: Ruby, Cobalt or Amber. It only sends. |
| **Mixer** | Holds up to six items and combines any two colours of the same size that react. |
| **Press** | Holds up to four items and squeezes two identical ones into one a size up. |
| **Splitter** | One belt in, two or more out, fed in turn. |
| **Belt** | A one-way lane from a deposit or machine into a machine, the hub, or another belt. |
| **Bridge** | Built where one belt has to hop another, for three belt tiles on top of the one under it. |

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

Every item also has a size. Two matching beads press into a pearl, two pearls
into an orb, and that is as big as it gets. Mixing keeps the size, so a Ruby
pearl and a Cobalt pearl make a Plum pearl, while a bead and a pearl do not
react at all. An item's key is its colour for a bead and `colour:size` once
pressed (`yellow:2` is an Amber pearl).

## Goals

The hub works through a ladder of goals. Deliver the count and the next goal
arrives, along with what finishing this one hands over: new buildings, and more
belt tiles. A card says what you got and what comes next, and its
button puts the new machine straight into your hand.

| # | Deliver | Teaches | Unlocks | Belt tiles |
|---|---|---|---|---|
| 1 | 10 Cobalt beads | A belt from a deposit to the hub | Mixer | +8 |
| 2 | 20 Fern beads | Mixing | Press | +10 |
| 3 | 12 Amber pearls | Pressing | Ruby deposit | +10 |
| 4 | 24 Coral beads | A new ore, and rewiring the mixer for it | Splitter | +12 |
| 5 | 14 Plum pearls | Mixing then pressing, in one line | — | +12 |
| 6 | 24 Slate beads | A mixer feeding a mixer | — | +15 |

You start with 40 tiles, and with Cobalt and Amber deposits already unlocked.

After the last goal the hub takes anything, and the floor is yours to keep
building on. The ladder lives in `GOALS` in `js/config.js`; a test plays every
goal using only what the goals before it unlocked, so a goal that asks for
something that cannot be built yet fails the suite.

Each new goal makes the last line useless, which is the point: the floor gets
rewired every few minutes. Leftovers from the old goal are scrapped at the hub
rather than left to wait, so one stray pearl can never block a line that is
otherwise wired right.

## The rules that make it a game

1. **Belt tiles are the only limit.** The counter in the header is your whole
   budget, and every finished goal adds to it. Pull a belt up by tapping it and
   the tiles come back.
2. **Belts cannot cross.** Where a route has to hop another belt it builds a
   bridge, which costs three tiles on top of the one under it, and a belt has to
   run straight across one — no turning up there. They *can* join, though: drop
   a belt onto a running lane and its load merges in, so two sources share one
   line. Splitting a line still takes a splitter — merging is free, branching
   is not.
3. **Goals unlock buildings, and you build as many as you like.** The Build
   button in the header lists everything unlocked so far, and turns pink when a
   goal has added something you have not looked at yet. Pick one and **drop it
   wherever you want** — the board shows a ghost under the cursor and a green
   box when the spot is clear. Machines need a cell of air around them and
   cannot sit on a running belt, so the floor itself is the other thing that
   runs out. **Press and hold a machine** and a ring closes around it; when it
   fills, the machine comes up in hand to drop somewhere else or remove. Either
   way its belts come up with it and the tiles come back.
4. **A machine that fills up with things it cannot use stops.** Six of one
   colour in a mixer, or four items with no matching pair in a press, will never
   clear themselves, so the machine rattles, flashes and sounds an alarm. It
   never ends the game; the line behind it just stops until you tap the machine
   to dump its buffer.

## Saving

The floor saves itself as you play: the layout, the belt tiles in hand, what is
unlocked and how far along the current goal is. Items riding the belts and sitting in
buffers are not kept, so a floor comes back empty and starts up again. A floor
keeps the shape it was made with, so one started on a wide screen stays wide on
a phone. **Start a new factory**, at the bottom of the help card, clears it
after a second tap.

## Drawing a belt

Press a deposit or a machine and drag. The route re-plans towards your finger on
every move, preferring long straight runs, so it comes out looking drawn rather
than stepped. It also remembers where you dragged: sweep out and around an
obstacle and the belt follows your detour instead of cutting the corner. Release
on a machine or the hub to lay it, anywhere else to throw it away.

## Layout

| Path | What |
|---|---|
| `js/config.js` | Colours, items, the mixing and pressing rules, the goal ladder, every tunable number |
| `js/world.js` | The grid, the belt router, the opening floor, and saving it |
| `js/sim.js` | One tick: ore drops, items move, mixers and presses craft, the hub counts |
| `js/render.js` | The whole canvas: paper, districts, belts, bridges, machines, the hub |
| `js/input.js` | Drawing, erasing and tapping |
| `js/main.js` | Screens, the build list, the goal board and card, saving, the frame loop |
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

- **A Lab**: a second building that takes any item and spends it on upgrades,
  so an old line can feed it instead of being torn down.
- **A Coater**: set to one colour, it wraps whatever passes through in a shell
  of it, so items gain layers (a Fern core in a Ruby coat).
- **A Sorter**, to pick one item off a mixed belt.
- **Districts that open with goals**, turning the pastel shapes on the floor
  into new ground with new ore veins.
- **Chalk**, a fourth primary for light tints, and a longer goal ladder.
