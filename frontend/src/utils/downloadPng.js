const DEFAULT_SCALE = 2;

const sanitizeFilename = (name) =>
  String(name || 'export')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'export';

const svgMarkupToDataUrl = (svgMarkup) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;

export const triggerPngDownload = (canvas, filename) => {
  const safeName = sanitizeFilename(filename);
  let dataUrl = '';
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch (error) {
    throw new Error(
      error?.name === 'SecurityError'
        ? 'PNG export was blocked by the browser (cross-origin image). Try downloading individual chart panels.'
        : error?.message || 'Failed to create PNG.'
    );
  }
  const link = document.createElement('a');
  link.download = safeName.endsWith('.png') ? safeName : `${safeName}.png`;
  link.href = dataUrl;
  link.click();
};

const loadImageFromSrc = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for PNG export.'));
    img.src = src;
  });

const resolveImageDataUrl = async (img) => {
  if (!img?.src) throw new Error('Image missing source.');
  if (img.src.startsWith('data:')) return img.src;

  const response = await fetch(img.src);
  if (!response.ok) throw new Error('Failed to read image for PNG export.');
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image for PNG export.'));
    reader.readAsDataURL(blob);
  });
};

const cloneSvgForExport = (svgEl) => {
  const clone = svgEl.cloneNode(true);
  clone.querySelectorAll('polyline').forEach((line) => {
    line.style.animation = 'none';
    line.style.strokeDasharray = 'none';
    line.style.strokeDashoffset = '0';
  });
  return clone;
};

const readSvgSize = (svgEl) => {
  const width = Number(svgEl.getAttribute('width')) || svgEl.width?.baseVal?.value || 0;
  const height = Number(svgEl.getAttribute('height')) || svgEl.height?.baseVal?.value || 0;
  return { width: Math.max(1, width), height: Math.max(1, height) };
};

const drawTitle = (ctx, title, scale, yOffset = 0) => {
  if (!title) return 0;
  ctx.fillStyle = '#334155';
  ctx.font = `600 ${14 * scale}px system-ui, sans-serif`;
  ctx.fillText(title, 0, (20 + yOffset) * scale);
  return 32;
};

const svgElementToCanvas = async (svgEl, { scale = DEFAULT_SCALE, title = '' } = {}) => {
  const { width, height } = readSvgSize(svgEl);
  const titleHeight = title ? 32 : 0;
  const exportSvg = cloneSvgForExport(svgEl);
  const svgString = new XMLSerializer().serializeToString(exportSvg);
  const img = await loadImageFromSrc(svgMarkupToDataUrl(svgString));
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = (height + titleHeight) * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawTitle(ctx, title, scale);
  ctx.drawImage(img, 0, titleHeight * scale, width * scale, height * scale);
  return canvas;
};

const waitForImage = (img) =>
  new Promise((resolve) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve();
      return;
    }
    img.onload = () => resolve();
    img.onerror = () => resolve();
  });

const imagePanelToCanvas = async (panelEl, { scale = DEFAULT_SCALE } = {}) => {
  const img = panelEl.querySelector('img');
  if (!img) throw new Error('No image found in panel.');
  const title = panelEl.querySelector('h3')?.textContent?.trim() || '';
  await waitForImage(img);

  const displayW = Math.max(1, img.clientWidth || img.naturalWidth || 1);
  const displayH = Math.max(1, img.clientHeight || img.naturalHeight || 1);
  const titleHeight = title ? 32 : 0;
  const dataUrl = await resolveImageDataUrl(img);
  const safeImg = await loadImageFromSrc(dataUrl);

  const canvas = document.createElement('canvas');
  canvas.width = displayW * scale;
  canvas.height = (displayH + titleHeight) * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawTitle(ctx, title, scale);
  ctx.drawImage(safeImg, 0, titleHeight * scale, displayW * scale, displayH * scale);
  return canvas;
};

const inlineImagesForExport = async (root) => {
  const images = [...root.querySelectorAll('img')];
  await Promise.all(
    images.map(async (img) => {
      try {
        const dataUrl = await resolveImageDataUrl(img);
        img.setAttribute('src', dataUrl);
      } catch {
        img.remove();
      }
    })
  );
};

const htmlFragmentToCanvas = async (element, { scale = DEFAULT_SCALE } = {}) => {
  if (!element) throw new Error('Nothing to export.');
  const rect = element.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));

  const clone = element.cloneNode(true);
  clone.querySelectorAll('button').forEach((btn) => btn.remove());
  clone.style.margin = '0';
  clone.style.maxWidth = 'none';
  await inlineImagesForExport(clone);

  const wrapper = document.createElement('div');
  wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.boxSizing = 'border-box';
  wrapper.style.background = '#ffffff';
  wrapper.style.color = '#213547';
  wrapper.style.fontFamily = 'system-ui, sans-serif';
  wrapper.appendChild(clone);

  const fragment = new XMLSerializer().serializeToString(wrapper);
  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%">${fragment}</foreignObject></svg>`;
  const img = await loadImageFromSrc(svgMarkupToDataUrl(svgMarkup));

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
};

const panelElementToCanvas = async (panelEl, options = {}) => {
  const svg = panelEl.querySelector('svg');
  const img = panelEl.querySelector('img');
  const title = panelEl.querySelector('h3')?.textContent?.trim() || '';

  if (svg && !img) {
    return svgElementToCanvas(svg, { ...options, title });
  }

  if (img && !svg) {
    return imagePanelToCanvas(panelEl, options);
  }

  return htmlFragmentToCanvas(panelEl, options);
};

export const downloadSvgAsPng = async (svgEl, filename, options = {}) => {
  if (!svgEl) return;
  const canvas = await svgElementToCanvas(svgEl, options);
  triggerPngDownload(canvas, filename);
};

export const downloadImagePanelAsPng = async (panelEl, filename, options = {}) => {
  const canvas = await imagePanelToCanvas(panelEl, options);
  triggerPngDownload(canvas, filename);
};

export const downloadHtmlFragmentAsPng = async (element, filename, options = {}) => {
  const canvas = await htmlFragmentToCanvas(element, options);
  triggerPngDownload(canvas, filename);
};

export const downloadComparisonWorkspaceAsPng = async (workspaceEl, filename, options = {}) => {
  if (!workspaceEl) return;
  const panels = [...workspaceEl.children];
  if (panels.length === 0) throw new Error('Nothing to export.');

  const scale = options.scale ?? DEFAULT_SCALE;
  const gap = 20 * scale;
  const canvases = await Promise.all(panels.map((panel) => panelElementToCanvas(panel, { ...options, scale })));
  const totalWidth = canvases.reduce((sum, canvas, index) => sum + canvas.width + (index > 0 ? gap : 0), 0);
  const totalHeight = Math.max(...canvases.map((canvas) => canvas.height));

  const stitched = document.createElement('canvas');
  stitched.width = totalWidth;
  stitched.height = totalHeight;
  const ctx = stitched.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  let x = 0;
  canvases.forEach((canvas, index) => {
    if (index > 0) x += gap;
    ctx.drawImage(canvas, x, 0);
    x += canvas.width;
  });

  triggerPngDownload(stitched, filename);
};

export const downloadPanelAsPng = async (panelEl, filename, options = {}) => {
  if (!panelEl) return;
  const canvas = await panelElementToCanvas(panelEl, options);
  triggerPngDownload(canvas, filename);
};
