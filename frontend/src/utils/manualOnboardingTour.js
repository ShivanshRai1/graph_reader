/**
 * Manual Graph Capture onboarding tour — UI tips only.
 * Does not change capture math, save, or RC Ladder / return_url behavior.
 */

export const MANUAL_ONBOARDING_STORAGE_KEY = 'graphCapture.manualOnboardingTourDone.v1';

export const MANUAL_ONBOARDING_STEPS = [
  {
    id: 'blue-box',
    target: 'gc-tour-canvas',
    title: 'Align the blue box',
    body: 'Drag the corners so the blue box matches the plot area on the image (axes and grid).',
  },
  {
    id: 'lock-axes',
    target: 'gc-tour-axes',
    title: 'Set axes, then Lock',
    body: 'Enter X/Y min and max (and linear/log). When the box looks right, click Lock axes to start capturing.',
  },
  {
    id: 'edit-axes',
    target: 'gc-tour-edit-axes',
    title: 'Edit axes anytime',
    body: 'Use Edit axes to unlock and fix mapping. You can lock again when ready. (Editing axes clears current points.)',
  },
  {
    id: 'capture',
    target: 'gc-tour-capture',
    title: 'Name the curve and click points',
    body: 'Enter a Curve or Line Name on the right, then click on the graph to capture points. Use the table below the graph to edit or delete them.',
  },
  {
    id: 'save',
    target: 'gc-tour-save',
    title: 'Save the curve',
    body: 'Click Save curve when you are done. You can capture another curve on the same graph afterward.',
  },
  {
    id: 'saved',
    target: 'gc-tour-saved',
    title: 'Saved Graphs',
    body: 'Saved curves appear here. Click Edit to change details and drag points on the graph to fine-tune them.',
  },
  {
    id: 'view',
    target: 'gc-tour-view',
    title: 'View individually or combined',
    body: 'Use View on one curve, or View combined / View all graphs combined to compare curves together.',
  },
];

export const shouldSkipManualOnboarding = ({ returnUrl = '' } = {}) =>
  Boolean(String(returnUrl || '').trim());

export const hasCompletedManualOnboarding = () => {
  try {
    return window.localStorage.getItem(MANUAL_ONBOARDING_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

export const markManualOnboardingComplete = () => {
  try {
    window.localStorage.setItem(MANUAL_ONBOARDING_STORAGE_KEY, '1');
  } catch {
    /* ignore */
  }
};
