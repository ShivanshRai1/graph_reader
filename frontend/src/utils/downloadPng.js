const DEFAULT_SCALE = 2;

const sanitizeFilename = (name) =>
  String(name || 'export')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'export';

export const triggerPngDownload = (canvas, filename) => {
  const safeName = sanitizeFilename(filename);
  const link = document.createElement('a');
  link.download = safeName.endsWith('.png') ? safeName : `${safeName}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
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

const loadSvgImage = (svgEl) =>
  new Promise((resolve, reject) => {
    const exportSvg = cloneSvgForExport(svgEl);
    const svgString = new XMLSerializer().serializeToString(exportSvg);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to render chart for PNG export.'));
    };
    img.src = url;
  });

const readSvgSize = (svgEl) => {
  const width = Number(svgEl.getAttribute('width')) || svgEl.width?.baseVal?.value || 0;
  const height = Number(svgEl.getAttribute('height')) || svgEl.height?.baseVal?.value || 0;
  return { width: Math.max(1, width), height: Math.max(1, height) };
};

export const downloadSvgAsPng = async (svgEl, filename, { scale = DEFAULT_SCALE, title = '' } = {}) => {
  if (!svgEl) return;
  const { width, height } = readSvgSize(svgEl);
  const titleHeight = title ? 32 : 0;
  const img = await loadSvgImage(svgEl);
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = (height + titleHeight) * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (title) {
    ctx.fillStyle = '#334155';
    ctx.font = `600 ${14 * scale}px system-ui, sans-serif`;
    ctx.fillText(title, 0, 20 * scale);
  }
  ctx.drawImage(img, 0, titleHeight * scale, width * scale, height * scale);
  triggerPngDownload(canvas, filename);
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

export const downloadImagePanelAsPng = async (panelEl, filename, { scale = DEFAULT_SCALE } = {}) => {
  if (!panelEl) return;
  const img = panelEl.querySelector('img');
  if (!img) throw new Error('No image found in panel.');
  const title = panelEl.querySelector('h3')?.textContent?.trim() || '';
  await waitForImage(img);

  const displayW = Math.max(1, img.clientWidth || img.naturalWidth || 1);
  const displayH = Math.max(1, img.clientHeight || img.naturalHeight || 1);
  const titleHeight = title ? 32 : 0;
  const canvas = document.createElement('canvas');
  canvas.width = displayW * scale;
  canvas.height = (displayH + titleHeight) * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (title) {
    ctx.fillStyle = '#334155';
    ctx.font = `600 ${14 * scale}px system-ui, sans-serif`;
    ctx.fillText(title, 0, 20 * scale);
  }
  ctx.drawImage(img, 0, titleHeight * scale, displayW * scale, displayH * scale);
  triggerPngDownload(canvas, filename);
};

export const downloadHtmlFragmentAsPng = async (element, filename, { scale = DEFAULT_SCALE } = {}) => {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));

  const clone = element.cloneNode(true);
  clone.querySelectorAll('button').forEach((btn) => btn.remove());
  clone.style.margin = '0';
  clone.style.maxWidth = 'none';

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
  const svgMarkup = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}">
      <foreignObject width="100%" height="100%">
        ${fragment}
      </foreignObject>
    </svg>`;

  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      triggerPngDownload(canvas, filename);
      URL.revokeObjectURL(url);
      resolve();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to render panel for PNG export.'));
    };
    img.src = url;
  });
};

export const downloadPanelAsPng = async (panelEl, filename, options = {}) => {
  if (!panelEl) return;
  const svg = panelEl.querySelector('svg');
  const img = panelEl.querySelector('img');

  if (svg && !img) {
    const title = panelEl.querySelector('h3')?.textContent?.trim() || '';
    await downloadSvgAsPng(svg, filename, { ...options, title });
    return;
  }

  if (img && !svg) {
    await downloadImagePanelAsPng(panelEl, filename, options);
    return;
  }

  await downloadHtmlFragmentAsPng(panelEl, filename, options);
};
