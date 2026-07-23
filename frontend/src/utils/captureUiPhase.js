/**
 * UI-only capture phase for affordance (highlight / mute).
 * Does not change save, lock, OCR, or RC Ladder behavior.
 */

export const CAPTURE_UI_PHASE = {
  VIEW: 'view',
  EDIT: 'edit',
  SETUP: 'setup',
  NEED_CURVE_NAME: 'needCurveName',
  CAPTURE: 'capture',
};

/**
 * @returns {'view'|'edit'|'setup'|'needCurveName'|'capture'}
 */
export function resolveCaptureUiPhase({
  isEditingCurve = false,
  isAxisMappingConfirmed = false,
  curveName = '',
  savedCurveViewActive = false,
} = {}) {
  if (savedCurveViewActive) return CAPTURE_UI_PHASE.VIEW;
  if (isEditingCurve) return CAPTURE_UI_PHASE.EDIT;
  if (isAxisMappingConfirmed && !String(curveName || '').trim()) {
    return CAPTURE_UI_PHASE.NEED_CURVE_NAME;
  }
  if (!isAxisMappingConfirmed) return CAPTURE_UI_PHASE.SETUP;
  return CAPTURE_UI_PHASE.CAPTURE;
}
