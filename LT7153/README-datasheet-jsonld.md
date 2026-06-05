# LT7153 datasheet JSON-LD (DiscoverEE capture)

This folder builds `LT7153pdp-datasheet-by-discoveree.jsonld` from **Graph Capture exports only**.

## Workflow

1. Capture graphs in Graph Capture and **Export .tc** (per figure or all curves).
2. Copy `.tc` files into `LT7153/captured/` (any filename; see `figure-map.json` patterns).
3. From repo root run:

   ```bash
   npm run build:datasheet-jsonld
   ```

4. Deliver `LT7153/LT7153pdp-datasheet-by-discoveree.jsonld` to DiscoverEE.

## Rules

- Figures with **no** matching `.tc` in `captured/`: `tcFileUrl` cleared and every `series[].data` set to `[]`. AI text, axes, `trend`, `keyValues`, etc. stay from template.
- Figures with a `.tc`: `curveSummary` and `data` come from that file only, and `tcFileUrl` is set to `tcFileBaseUrl` + filename (default `…/LT7153/tc/`, see `figure-map.json`). **Upload the same `.tc` files** under that `tc/` folder on DiscoverEE so the URLs work.
- Per-series: only curves present in the `.tc` get points; other series slots keep `data: []`.
- Spec tables, sections, and equations are **not** modified (template copy).

## Files

| File | Role |
|------|------|
| `LT7153pdp.datasheet-template.jsonld` | Structure + ADI text; do not hand-edit curve data |
| `captured/*.tc` | Your exports (input) |
| `figure-map.json` | Maps figure number → filename patterns |
| `LT7153pdp-datasheet-by-discoveree.jsonld` | **Output** (generated) |
