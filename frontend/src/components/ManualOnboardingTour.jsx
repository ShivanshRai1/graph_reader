import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MANUAL_ONBOARDING_STEPS,
  markManualOnboardingComplete,
} from '../utils/manualOnboardingTour';

const PAD = 8;

const getTargetRect = (targetId) => {
  if (!targetId || typeof document === 'undefined') return null;
  const el = document.querySelector(`[data-tour="${targetId}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  return rect;
};

/**
 * UI-only spotlight tour for manual Graph Capture.
 * Does not alter capture, save, or RC Ladder logic.
 */
const ManualOnboardingTour = ({ open, onClose }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState(null);

  const step = MANUAL_ONBOARDING_STEPS[stepIndex] || MANUAL_ONBOARDING_STEPS[0];
  const total = MANUAL_ONBOARDING_STEPS.length;
  const hasExampleImage = Boolean(step?.image);

  const finish = useCallback(() => {
    markManualOnboardingComplete();
    onClose?.();
  }, [onClose]);

  const refreshRect = useCallback(() => {
    const next = getTargetRect(step?.target);
    setRect(next);
    if (next && typeof document !== 'undefined') {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }
  }, [step?.target]);

  useEffect(() => {
    if (!open) return undefined;
    setStepIndex(0);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    refreshRect();
    const onResize = () => refreshRect();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    const timer = window.setInterval(refreshRect, 400);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      window.clearInterval(timer);
    };
  }, [open, stepIndex, refreshRect]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, finish]);

  if (!open || typeof document === 'undefined') return null;

  const highlight = rect
    ? {
        top: Math.max(0, rect.top - PAD),
        left: Math.max(0, rect.left - PAD),
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;

  const tooltipStyle = (() => {
    if (!highlight) {
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }
    const cardHeightGuess = hasExampleImage ? 360 : 180;
    const below = highlight.top + highlight.height + 12;
    const spaceBelow = window.innerHeight - below;
    const top = spaceBelow > cardHeightGuess ? below : Math.max(12, highlight.top - Math.min(cardHeightGuess, highlight.top - 12));
    const left = Math.min(
      Math.max(12, highlight.left),
      Math.max(12, window.innerWidth - 380)
    );
    return { top, left };
  })();

  return createPortal(
    <div
      className="fixed inset-0 z-[9999]"
      role="dialog"
      aria-modal="true"
      aria-label="Graph Capture tips"
    >
      <div className="absolute inset-0 bg-slate-900/55" onClick={finish} />
      {highlight ? (
        <div
          className="absolute rounded-lg pointer-events-none"
          style={{
            top: highlight.top,
            left: highlight.left,
            width: highlight.width,
            height: highlight.height,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55)',
            border: '2px solid #38bdf8',
            background: 'transparent',
          }}
        />
      ) : null}
      <div
        className="absolute z-[10000] w-[min(360px,calc(100vw-24px))] rounded-lg border border-slate-200 bg-white p-4 shadow-xl"
        style={tooltipStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Tip {stepIndex + 1} of {total}
        </div>
        <h3 className="mb-2 text-base font-semibold text-slate-900">{step.title}</h3>
        <p className="mb-3 text-sm leading-relaxed text-slate-700">{step.body}</p>
        {hasExampleImage ? (
          <div className="mb-3 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
            <img
              src={step.image}
              alt={step.imageAlt || step.title}
              className="block w-full h-auto max-h-44 object-cover object-top"
            />
            <div className="px-2 py-1 text-[11px] text-slate-500 border-t border-slate-200">
              Example from a saved session
            </div>
          </div>
        ) : null}
        {!highlight && !hasExampleImage ? (
          <p className="mb-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            This control appears after you progress (e.g. after Lock axes or Save). You can still continue the tips.
          </p>
        ) : null}
        {!highlight && hasExampleImage ? (
          <p className="mb-3 text-xs text-slate-600">
            This section appears after you save. The image above shows what it looks like.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={finish}
            className="gc-tour-skip-btn px-3 py-1.5 rounded text-sm font-semibold"
          >
            Skip tips
          </button>
          <div className="flex gap-2">
            {stepIndex > 0 ? (
              <button
                type="button"
                className="gc-tour-skip-btn px-3 py-1.5 rounded text-sm font-medium"
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              >
                Back
              </button>
            ) : null}
            {stepIndex < total - 1 ? (
              <button
                type="button"
                className="gc-tour-next-btn px-3 py-1.5 rounded text-sm font-semibold"
                onClick={() => setStepIndex((i) => Math.min(total - 1, i + 1))}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                className="gc-tour-next-btn px-3 py-1.5 rounded text-sm font-semibold"
                onClick={finish}
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ManualOnboardingTour;
