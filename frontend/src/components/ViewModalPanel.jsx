import { useRef } from 'react';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const ViewModalPanel = ({
  title,
  children,
  layout,
  onLayoutChange,
  interactionRef,
  onClose,
  defaultWidth = 640,
  minWidth = 520,
  maxWidth = 920,
  minHeight = 320,
  maxHeightFactor = 0.88,
}) => {
  const panelRef = useRef(null);

  const getMaxHeight = () => Math.max(minHeight, window.innerHeight * maxHeightFactor);

  const readLayoutFromDom = () => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const maxHeight = getMaxHeight();
    return {
      x: rect.left,
      y: rect.top,
      width: clamp(rect.width, minWidth, maxWidth),
      height: clamp(rect.height, minHeight, maxHeight),
    };
  };

  const markInteraction = (type) => {
    if (!interactionRef?.current) return;
    interactionRef.current.wasDragged = type === 'drag' || interactionRef.current.wasDragged;
    interactionRef.current.wasResized = type === 'resize' || interactionRef.current.wasResized;
  };

  const handleDragStart = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startLayout = layout || readLayoutFromDom();
    if (!startLayout) return;

    const startX = event.clientX;
    const startY = event.clientY;

    const onMove = (moveEvent) => {
      markInteraction('drag');
      onLayoutChange({
        width: startLayout.width,
        height: startLayout.height,
        x: startLayout.x + (moveEvent.clientX - startX),
        y: startLayout.y + (moveEvent.clientY - startY),
      });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleResizeStart = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const startLayout = layout || readLayoutFromDom();
    if (!startLayout) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const maxHeight = getMaxHeight();

    const onMove = (moveEvent) => {
      markInteraction('resize');
      onLayoutChange({
        x: startLayout.x,
        y: startLayout.y,
        width: clamp(startLayout.width + (moveEvent.clientX - startX), minWidth, maxWidth),
        height: clamp(startLayout.height + (moveEvent.clientY - startY), minHeight, maxHeight),
      });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const hasExplicitLayout = Boolean(layout);
  const panelStyle = hasExplicitLayout
    ? {
        top: layout.y,
        left: layout.x,
        width: layout.width,
        height: layout.height,
        transform: 'none',
      }
    : {
        top: '50%',
        left: '50%',
        width: defaultWidth,
        minWidth,
        maxWidth,
        maxHeight: `${Math.round(maxHeightFactor * 100)}vh`,
        transform: 'translate(-50%, -50%)',
      };

  return (
    <div
      ref={panelRef}
      style={{
        background: '#fff',
        color: '#213547',
        borderRadius: 8,
        boxShadow: '0 4px 32px rgba(0,0,0,0.18)',
        position: 'fixed',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        pointerEvents: 'auto',
        ...panelStyle,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        style={{
          position: 'absolute',
          top: 8,
          right: 12,
          background: 'none',
          border: 'none',
          fontSize: 30,
          width: 36,
          height: 36,
          lineHeight: 1,
          color: '#888',
          cursor: 'pointer',
          zIndex: 2,
        }}
        onClick={onClose}
        aria-label="Close"
      >
        ×
      </button>

      <div
        className="font-semibold"
        style={{
          color: '#213547',
          fontSize: 18,
          cursor: 'move',
          userSelect: 'none',
          padding: '16px 48px 10px 24px',
          borderBottom: '1px solid #eef2f7',
          flexShrink: 0,
        }}
        onMouseDown={handleDragStart}
        title="Drag to move"
      >
        {title}
      </div>

      <div
        style={{
          flex: hasExplicitLayout ? 1 : 'initial',
          overflowY: 'auto',
          padding: '12px 24px 24px',
          minHeight: 0,
        }}
      >
        {children}
      </div>

      <div
        role="presentation"
        onMouseDown={handleResizeStart}
        title="Drag to resize"
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 18,
          height: 18,
          cursor: 'nwse-resize',
          zIndex: 2,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M8 18L18 8M12 18L18 12M16 18L18 16" stroke="#94a3b8" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
    </div>
  );
};

export default ViewModalPanel;
