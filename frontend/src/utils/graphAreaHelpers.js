export const DEFAULT_AXIS_BOX_INSET_RATIO = 0.12;

/** Typical B&W datasheet plot margins (Y labels left, X labels bottom). */
export const DATASHEET_PLOT_MARGINS = {
  left: 0.15,
  top: 0.05,
  right: 0.04,
  bottom: 0.11,
};

export const buildDatasheetPlotArea = (canvasW, canvasH, margins = DATASHEET_PLOT_MARGINS) => {
  const width = Number(canvasW);
  const height = Number(canvasH);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const left = Math.max(6, Math.round(width * margins.left));
  const top = Math.max(6, Math.round(height * margins.top));
  const right = Math.max(6, Math.round(width * margins.right));
  const bottom = Math.max(6, Math.round(height * margins.bottom));

  return {
    x: left,
    y: top,
    width: Math.max(1, width - left - right),
    height: Math.max(1, height - top - bottom),
  };
};

/** Default axis box: full image, or datasheet-style plot area for AI / graph_id sessions. */
export const buildDefaultGraphArea = (
  canvasW,
  canvasH,
  { useInset = false, insetRatio = DEFAULT_AXIS_BOX_INSET_RATIO } = {}
) => {
  const width = Number(canvasW);
  const height = Number(canvasH);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  if (!useInset) {
    return { x: 0, y: 0, width, height };
  }

  return buildDatasheetPlotArea(width, height);
};
