export const DEFAULT_AXIS_BOX_INSET_RATIO = 0.12;

/** Default axis box: full image, or inset for AI / graph_id sessions (typical datasheet margins). */
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

  const insetX = Math.max(6, Math.round(width * insetRatio));
  const insetY = Math.max(6, Math.round(height * insetRatio));

  return {
    x: insetX,
    y: insetY,
    width: Math.max(1, width - insetX * 2),
    height: Math.max(1, height - insetY * 2),
  };
};
