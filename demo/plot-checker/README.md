# Plot checker demo files

Use these with **Plot checker** (`?view=tc-checker` on Graph Capture).

## Quick test

1. Open https://graph-capture.netlify.app/?view=tc-checker
2. Paste or upload a datasheet image (e.g. LT7153 Figure 5 efficiency plot).
3. Upload **captured** file: `efficiency-1mhz-captured.csv` or `.json`
4. Optional **reference**: `efficiency-1mhz-reference.csv` or `.json`

## Files

| File | Format | Role |
|------|--------|------|
| `efficiency-1mhz-captured.csv` | Graph Capture CSV export | Captured export slot |
| `efficiency-1mhz-captured.json` | Graph Capture JSON export | Captured export slot |
| `efficiency-1mhz-reference.csv` | Plain X,Y CSV | Reference slot (optional) |
| `efficiency-1mhz-reference.json` | Plain `[{x,y}]` array | Reference slot (optional) |

Data is from `LT7153/Plots/G05_Efficiency_Curve_1MHz/Efficiency_Curve_1MHz.tc` (first series).

## JSON-LD

For JSON-LD, use the existing repo file:

`LT7153/LT7153pdp-datasheet-by-discoveree.jsonld`

Upload it to the captured or reference slot, then pick **Figure 5: Efficiency vs. Load Current (1MHz)** from the dropdown.
