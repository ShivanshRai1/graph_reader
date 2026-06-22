# Plot checker demo files

Use these with **Plot checker** (`?view=tc-checker` on Graph Capture).

## Quick test — single curve

1. Open https://graph-capture.netlify.app/?view=tc-checker
2. Paste or upload a datasheet image (e.g. LT7153 Figure 5 efficiency plot).
3. Upload **captured** file: `efficiency-1mhz-captured.csv` or `.json`
4. Optional **reference**: `efficiency-1mhz-reference.csv` or `.json`

These single-curve files use the **first series** (`data0` / **V_OUT = 0.5V**) from `LT7153/Plots/G05_Efficiency_Curve_1MHz/Efficiency_Curve_1MHz.tc`.

## Quick test — all 3 curves (Figure 5)

1. Open the plot checker (`?view=tc-checker`).
2. Paste or upload the Figure 5 image.
3. **Captured export**: `efficiency-1mhz-captured-all_curves.csv` or `.json`
4. **Reference export**: `efficiency-1mhz-reference-all_curves.csv` or `.json`

Compare against your app export `...-all_curves.csv` / `.json` the same way.

Curves in the combined files:

| Name | Source in `.tc` |
|------|-----------------|
| `V_OUT = 0.5V` | `data0` |
| `V_OUT = 0.8V` | `data2` |
| `V_OUT = 1V` | `data1` |

## Files

| File | Format | Role |
|------|--------|------|
| `efficiency-1mhz-captured.csv` | Graph Capture CSV (1 curve) | Captured export slot |
| `efficiency-1mhz-captured.json` | Graph Capture JSON (1 curve) | Captured export slot |
| `efficiency-1mhz-reference.csv` | Plain X,Y CSV (1 curve) | Reference slot |
| `efficiency-1mhz-reference.json` | Plain `[{x,y}]` array (1 curve) | Reference slot |
| `efficiency-1mhz-captured-all_curves.csv` | Graph Capture CSV (3 curves) | Captured export slot |
| `efficiency-1mhz-captured-all_curves.json` | Graph Capture JSON (3 curves) | Captured export slot |
| `efficiency-1mhz-reference-all_curves.csv` | Graph Capture CSV (3 curves) | Reference slot |
| `efficiency-1mhz-reference-all_curves.json` | Graph Capture JSON (3 curves) | Reference slot |

From the app, **Export CSV** / **Export JSON** downloads each curve separately **and** one `...-all_curves` file. Use the combined demo files to test the combined export on the check page.

## JSON-LD

For JSON-LD, use the existing repo file:

`LT7153/LT7153pdp-datasheet-by-discoveree.jsonld`

Upload it to the captured or reference slot, then pick **Figure 5: Efficiency vs. Load Current (1MHz)** from the dropdown.
