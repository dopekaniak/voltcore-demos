# text_to_cad

Turns a plain-English request into a watertight STL you can slice and print.
Built in this repo because the external `text-to-cad` repo was not reachable.

## What it builds

| Request contains | Part | Parameters you can set in words |
|---|---|---|
| `hook`, `mount`, `headphone` | Wall/desk hook (plate + arm + tip, two screw holes) | `NNmm` = width; `headphone` = 60 mm reach |
| `stand`, `holder` | Upright stand with base, back, front lip | `NNmm` = width |
| `clip` | Snap-in cable clip on a base | `NNmm` = cable diameter |
| `gear` | Spur gear (rectangular teeth, not true involute) | `NN teeth` |

Anything else is rejected with a list of what it can build. It does not guess.

## Use

```bash
cd tools
pip install -r text_to_cad/requirements.txt
python -m text_to_cad "make me a hook that mounts under my desk and holds my headphones"
python -m text_to_cad "gear with 24 teeth" --out text_to_cad/output/gear.stl
```

Each run prints the part, its size in mm, triangle count, whether the mesh is
watertight, and its volume, then writes the STL. Exit code is 0 on success, 1 if
the mesh is not watertight, and 2 if the request is not supported.

## Tests

```bash
cd tools
python -m unittest text_to_cad.tests.test_text_to_cad -v
```

## Limits (read before printing)

- Geometry only. It does not check overhangs, wall thickness, or bed orientation.
- Dimensions are fixed defaults unless the request sets them (width, cable
  diameter, teeth). Check fit against your real desk and cable before printing.
- The gear is a simplified tooth profile and will not mesh precisely with
  involute gears.
- Parsing is keyword-based. Free-form design requests need a real model behind
  the parser; that is not built here.
