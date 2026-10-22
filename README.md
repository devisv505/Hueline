# Mini Factory — prototype 1

An automation game with no spreadsheets in it. Ore deposits drop primary
colours, mixers combine two different colours into a new one, and shops want
whatever the mixers can make. You do one thing: draw the belts.

Play it at `prototype_1/` (see **Running it** below).

## The loop

| Piece | What it does |
|---|---|
| **Ore deposit** | Drops one ore every few seconds: Ruby, Cobalt or Amber. It only sends. |
| **Mixer** | Holds up to six items and combines any two colours that react. |
| **Shop** | Wants one colour. Every matching delivery is a point. |
| **Belt** | A one-way lane from a deposit or mixer into a mixer or shop. |
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
   Pull a belt up by tapping it and the tiles come back.
2. **Belts cannot cross.** Where a route has to hop another belt it spends a
   bridge, and a belt has to run straight across one — no turning up there.
3. **A mixer fails if its input buffer overflows.** Six of one colour with no
   partner will never clear itself, so the machine sounds an alarm and burns
   out fifteen seconds later, which ends the run. Tap a flashing machine to
   dump its buffer for five points — the escape hatch when a route goes wrong.

Every six deliveries the shift ends and you pick an upgrade: more tiles, another
bridge, a second mixer, faster belts, a new deposit. New shops and machines keep
arriving, and a new shop only ever asks for a colour the floor can already make.

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

`config.js`, `world.js` and `sim.js` never touch the DOM, so the whole game can
be run headless — which is what the tests do.

## Running it

```sh
npm start                 # serves the repo; open /prototype_1/
npm test                  # runs the Pawzzle and Mini Factory tests
```

Module scripts do not load from `file://`, so it needs a server.

## Where it would go next

- Splitters and mergers, so one deposit can feed two mixers without a second belt.
- A mixer that can be told which recipe to prefer, for when three colours arrive.
- Hand-authored levels with a fixed belt budget, scored like a puzzle rather than a run.
- Belt speed per lane, so the interesting decision is where to spend the fast ones.
