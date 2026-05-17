importScripts('libs/jspdf.umd.min.js');

const HTML2PDF_URL = 'libs/html2pdf.bundle.min.js';

chrome.runtime.onInstalled.addListener(() => {
  console.info('[Qwen PDF] Extension installed.');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'EXPORT_LOG') {
    console.info('[Qwen PDF]', message.payload);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'CAPTURE_MATH_REGIONS') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab context for math capture.' });
      return false;
    }

    runMathRegionsCapture(tabId, message.items || [], message.attr || 'data-qwen-math-cap')
      .then((result) =>
        sendResponse({ success: true, captures: result.captures, count: result.captures.length })
      )
      .catch((err) =>
        sendResponse({ success: false, error: err?.message || String(err), captures: [] })
      );
    return true;
  }

  if (message?.type === 'GENERATE_PDF_CAPTURE') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab context for capture.' });
      return false;
    }

    runPageCapturePdf(tabId, message.payload)
      .then(() => sendResponse({ success: true }))
      .catch((err) =>
        sendResponse({ success: false, error: err?.message || String(err) })
      );
    return true;
  }

  if (message?.type === 'GENERATE_PDF_HTML') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab context for PDF generation.' });
      return false;
    }

    runHtmlPdfGeneration(
      tabId,
      message.rootId,
      message.bodyId || 'qwen-pdf-export-body',
      message.filename,
      message.pageWidth || 1123
    )
      .then(() => sendResponse({ success: true }))
      .catch((err) =>
        sendResponse({ success: false, error: err?.message || String(err) })
      );
    return true;
  }

  if (message?.type === 'GENERATE_PDF_TEXT') {
    buildAndDownloadTextPdf(message.payload)
      .then(() => sendResponse({ success: true }))
      .catch((err) =>
        sendResponse({ success: false, error: err?.message || String(err) })
      );
    return true;
  }

  return false;
});

const HTML2CANVAS_URL = 'libs/html2canvas.min.js';

async function runMathRegionsCapture(tabId, items, attrName) {
  if (!items.length) return { captures: [] };

  const canvasUrl = chrome.runtime.getURL(HTML2CANVAS_URL);
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: captureMathRegionsInPage,
    args: [items, canvasUrl, attrName || 'data-qwen-math-cap'],
  });

  if (result?.result?.error) {
    throw new Error(result.result.error);
  }

  return { captures: result?.result?.captures || [] };
}

async function captureMathRegionsInPage(items, canvasUrl, attrName) {
  const capAttr = attrName || 'data-qwen-math-cap';
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (typeof html2canvas === 'function') {
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load capture library.'));
      document.head.appendChild(s);
    });
  }

  function forceLightThemeForCapture(root) {
    if (!(root instanceof HTMLElement)) return;
    const textTags = new Set([
      'P',
      'SPAN',
      'DIV',
      'LI',
      'TD',
      'TH',
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'STRONG',
      'EM',
      'B',
      'I',
      'A',
      'LABEL',
      'OL',
      'UL',
      'PRE',
      'CODE',
    ]);

    const walk = (node) => {
      if (!(node instanceof HTMLElement)) return;
      const tag = node.tagName;

      if (textTags.has(tag) || node.classList.contains('katex') || node.closest('.katex')) {
        node.style.setProperty('color', '#111827', 'important');
        node.style.setProperty('-webkit-text-fill-color', '#111827', 'important');
        node.style.setProperty('opacity', '1', 'important');
        node.style.setProperty('filter', 'none', 'important');
      }

      if (tag === 'PRE' || tag === 'CODE') {
        node.style.setProperty('background-color', '#f8fafc', 'important');
      }

      if (tag === 'SVG') {
        node.querySelectorAll('[fill]').forEach((part) => {
          const fill = part.getAttribute('fill');
          if (fill && fill !== 'none' && fill !== 'transparent') {
            part.setAttribute('fill', '#111827');
          }
        });
        node.querySelectorAll('text, tspan').forEach((t) => t.setAttribute('fill', '#111827'));
      }

      for (const child of node.children) walk(child);
    };

    root.style.setProperty('background', '#ffffff', 'important');
    root.style.setProperty('color', '#111827', 'important');
    walk(root);
  }

  function measureVisibleCaptureHeight(el) {
    const base = el.getBoundingClientRect();
    let bottom = base.bottom;
    el.querySelectorAll(
      'p, li, h1, h2, h3, h4, pre, table, .katex, .katex-display, img, blockquote'
    ).forEach((child) => {
      const r = child.getBoundingClientRect();
      if (r.height > 0 && r.width > 0) bottom = Math.max(bottom, r.bottom);
    });
    return Math.ceil(Math.max(bottom - base.top + 20, base.height, 24));
  }

  function captureHasVisibleInk(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const { width, height } = canvas;
    if (width < 8 || height < 8) return false;
    const step = Math.max(2, Math.floor(Math.min(width, height) / 180));
    const data = ctx.getImageData(0, 0, width, height).data;
    let dark = 0;
    let total = 0;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4;
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (lum < 235) dark++;
        total++;
      }
    }
    return total > 0 && dark / total > 0.004;
  }

  function prepareElementForCapture(root) {
    const restores = [];
    const patch = (node, styles) => {
      const prev = {};
      for (const key of Object.keys(styles)) {
        prev[key] = node.style[key];
        node.style[key] = styles[key];
      }
      restores.push(() => {
        for (const key of Object.keys(prev)) node.style[key] = prev[key];
      });
    };
    patch(root, {
      overflow: 'visible',
      overflowX: 'visible',
      maxWidth: 'none',
      background: '#ffffff',
      color: '#111827',
    });
    forceLightThemeForCapture(root);
    root.querySelectorAll('.katex, .katex-display').forEach((math) => {
      patch(math, { overflow: 'visible' });
    });
    return () => {
      for (let i = restores.length - 1; i >= 0; i--) restores[i]();
    };
  }

  try {
    await loadScript(canvasUrl);
    if (typeof html2canvas !== 'function') {
      return { error: 'Capture library failed to initialize.', captures: [] };
    }

    const captures = [];

    for (const item of items) {
      const el = document.querySelector(`[${capAttr}="${item.id}"]`);
      if (!el) continue;

      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      await new Promise((r) => setTimeout(r, captures.length === 0 ? 120 : 200));

      const restore = prepareElementForCapture(/** @type {HTMLElement} */ (el));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const rect = el.getBoundingClientRect();
      const captureW = Math.ceil(Math.max(rect.width, el.scrollWidth, 320));
      const captureH = measureVisibleCaptureHeight(el);

      let canvas;
      try {
        canvas = await html2canvas(/** @type {HTMLElement} */ (el), {
          scale: 1.5,
          backgroundColor: '#ffffff',
          useCORS: true,
          allowTaint: true,
          logging: false,
          scrollX: 0,
          scrollY: -window.scrollY,
          width: captureW,
          height: captureH,
          windowWidth: captureW + 64,
          windowHeight: captureH + 64,
          onclone: (_doc, clonedEl) => {
            if (clonedEl instanceof HTMLElement) forceLightThemeForCapture(clonedEl);
          },
        });
      } finally {
        restore();
      }

      if (!canvas || !captureHasVisibleInk(canvas)) continue;

      captures.push({
        id: item.id,
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
        hasInk: true,
      });
    }

    document.querySelectorAll(`[${capAttr}]`).forEach((node) => {
      node.removeAttribute(capAttr);
    });

    return { captures };
  } catch (err) {
    return { error: err?.message || String(err), captures: [] };
  }
}

async function runPageCapturePdf(tabId, payload) {
  const canvasUrl = chrome.runtime.getURL(HTML2CANVAS_URL);
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: captureMessagesInPage,
    args: [payload.items, canvasUrl],
  });

  if (result?.result?.error) {
    throw new Error(result.result.error);
  }

  const captures = result?.result?.captures;
  if (!captures?.length) {
    throw new Error('No message screenshots were captured. Refresh the chat page and try again.');
  }

  await buildAndDownloadCapturePdf({
    title: payload.title,
    filename: payload.filename,
    exportDate: payload.exportDate,
    captures,
  });
}

async function captureMessagesInPage(items, canvasUrl) {
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (typeof html2canvas === 'function') {
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load capture library.'));
      document.head.appendChild(s);
    });
  }

  try {
    await loadScript(canvasUrl);

    if (typeof html2canvas !== 'function') {
      return { error: 'Capture library failed to initialize. Reload the extension.' };
    }

    function prepareElementForCapture(root) {
      const restores = [];

      const patch = (node, styles) => {
        const prev = {};
        for (const key of Object.keys(styles)) {
          prev[key] = node.style[key];
          node.style[key] = styles[key];
        }
        restores.push(() => {
          for (const key of Object.keys(prev)) {
            node.style[key] = prev[key];
          }
        });
      };

      patch(root, {
        overflow: 'visible',
        overflowX: 'visible',
        maxWidth: 'none',
      });

      root.querySelectorAll('table').forEach((table) => {
        patch(table, { width: 'max-content', tableLayout: 'auto' });
        let parent = table.parentElement;
        while (parent && parent !== root && parent !== document.body) {
          const needsExpand =
            parent.scrollWidth > parent.clientWidth + 2 ||
            getComputedStyle(parent).overflowX === 'hidden' ||
            getComputedStyle(parent).overflow === 'hidden';
          if (needsExpand) {
            const fullW = Math.max(parent.scrollWidth, table.scrollWidth, table.offsetWidth);
            patch(parent, {
              overflow: 'visible',
              overflowX: 'visible',
              maxWidth: 'none',
              width: `${fullW}px`,
            });
          }
          parent = parent.parentElement;
        }
      });

      root.querySelectorAll('.katex-display, .katex').forEach((math) => {
        patch(math, { overflow: 'visible' });
        let parent = math.parentElement;
        while (parent && parent !== root) {
          const cs = getComputedStyle(parent);
          if (cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis') {
            patch(parent, { overflow: 'visible', overflowX: 'visible', textOverflow: 'clip' });
          }
          parent = parent.parentElement;
        }
      });

      return () => {
        for (let i = restores.length - 1; i >= 0; i--) restores[i]();
      };
    }

    const captures = [];

    for (const item of items) {
      const el = document.querySelector(`[data-qwen-pdf-capture="${item.id}"]`);
      if (!el) continue;

      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 400));

      const restoreLayout = prepareElementForCapture(/** @type {HTMLElement} */ (el));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const rect = el.getBoundingClientRect();
      const captureW = Math.ceil(Math.max(el.scrollWidth, rect.width, 320));
      const captureH = Math.ceil(Math.max(el.scrollHeight, rect.height, 24));

      let canvas;
      try {
        canvas = await html2canvas(/** @type {HTMLElement} */ (el), {
          scale: 2,
          backgroundColor: '#ffffff',
          width: captureW,
          height: captureH,
          windowWidth: captureW + 100,
          windowHeight: captureH + 100,
          useCORS: true,
          allowTaint: true,
          logging: false,
          scrollX: 0,
          scrollY: -window.scrollY,
        });
      } finally {
        restoreLayout();
      }

      captures.push({
        role: item.role,
        dataUrl: canvas.toDataURL('image/jpeg', 0.92),
        width: canvas.width,
        height: canvas.height,
      });
    }

    document.querySelectorAll('[data-qwen-pdf-capture]').forEach((node) => {
      node.removeAttribute('data-qwen-pdf-capture');
    });

    return { captures };
  } catch (err) {
    return { error: err?.message || String(err), captures: [] };
  }
}

async function buildAndDownloadCapturePdf(payload) {
  const doc = createCapturePdf(payload);
  const dataUri = doc.output('datauristring');
  await chrome.downloads.download({
    url: dataUri,
    filename: payload.filename,
    saveAs: true,
  });
}

function createCapturePdf(payload) {
  const { jsPDF } = self.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const margin = 14;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (needMm) => {
    if (y + needMm > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(30, 30, 30);
  const titleLines = doc.splitTextToSize(payload.title || 'Qwen Chat', contentW);
  titleLines.forEach((line) => {
    ensureSpace(8);
    doc.text(line, margin, y);
    y += 8;
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  ensureSpace(5);
  doc.text(`Exported ${payload.exportDate}`, margin, y);
  y += 5;
  ensureSpace(5);
  doc.text(`${payload.captures.length} message block(s)`, margin, y);
  y += 12;

  for (const cap of payload.captures) {
    const label = cap.role === 'user' ? 'You' : 'Qwen';
    ensureSpace(8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(cap.role === 'user' ? 67 : 15, cap.role === 'user' ? 56 : 118, cap.role === 'user' ? 202 : 110);
    doc.text(label, margin, y);
    y += 6;

    if (!cap.dataUrl || !cap.width || !cap.height) continue;

    const aspect = cap.height / cap.width;
    let imgW = contentW;
    let imgH = imgW * aspect;
    const maxH = pageH - margin - y - 4;

    if (imgH > maxH && maxH > 25) {
      imgH = maxH;
      imgW = imgH / aspect;
    }

    ensureSpace(imgH);
    const format = cap.dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
    doc.addImage(cap.dataUrl, format, margin, y, imgW, imgH, undefined, 'FAST');
    y += imgH + 8;
  }

  const total = doc.internal.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Page ${p} of ${total}`, pageW / 2, pageH - 8, { align: 'center' });
  }

  return doc;
}

async function runHtmlPdfGeneration(tabId, rootId, bodyId, filename, pageWidth) {
  const libUrl = chrome.runtime.getURL(HTML2PDF_URL);
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: pdfFromHtmlMain,
    args: [rootId, bodyId, filename, libUrl, pageWidth || 1123],
  });

  if (result?.result?.success === false) {
    throw new Error(result.result.error || 'HTML PDF generation failed.');
  }
  if (result?.result?.success !== true) {
    throw new Error('PDF generation did not complete.');
  }
}

async function pdfFromHtmlMain(rootId, bodyId, filename, libUrl, pageWidth) {
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (typeof html2pdf !== 'undefined') {
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load PDF library.'));
      document.head.appendChild(s);
    });
  }

  try {
    await loadScript(libUrl);
    const iframe = document.getElementById(rootId);
    if (!iframe?.contentDocument) throw new Error('Export iframe not found.');
    const el = iframe.contentDocument.getElementById(bodyId);
    if (!el) throw new Error('Export body not found.');

    const pageW = pageWidth || 1123;
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;

    Object.assign(iframe.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: `${pageW}px`,
      height: `${doc.documentElement.scrollHeight + 40}px`,
      border: 'none',
      opacity: '1',
      visibility: 'visible',
      zIndex: '2147483647',
      background: '#ffffff',
    });

    win.scrollTo(0, 0);
    doc.documentElement.scrollLeft = 0;
    doc.documentElement.scrollTop = 0;
    doc.body.scrollLeft = 0;
    doc.body.scrollTop = 0;
    el.scrollLeft = 0;
    el.scrollTop = 0;
    el.style.margin = '0';
    el.style.position = 'relative';
    el.style.left = '0';
    el.style.transform = 'none';

    doc.querySelectorAll('.qwen-pdf-doc, .qwen-pdf-doc *').forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const cs = win.getComputedStyle(node);
      if (cs.transform && cs.transform !== 'none') node.style.transform = 'none';
      if (parseFloat(cs.left) < 0) node.style.left = '0';
    });

    await new Promise((r) => setTimeout(r, 900));

    const docEl = doc.documentElement;
    const docH = docEl.scrollHeight;
    const docW = Math.min(docEl.scrollWidth, pageW);

    await html2pdf()
      .set({
        margin: [8, 8, 10, 8],
        filename,
        image: { type: 'jpeg', quality: 0.96 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          scrollX: 0,
          scrollY: 0,
          x: 0,
          y: 0,
          width: docW,
          height: docH,
          windowWidth: pageW,
          windowHeight: Math.max(docH, 794),
        },
        pagebreak: {
          mode: ['avoid-all', 'css', 'legacy'],
          before: ['.pdf-raster-page-start'],
          avoid: [
            '.message-card',
            '.message-header',
            '.message-body p',
            '.message-body li',
            '.message-body h1',
            '.message-body h2',
            '.message-body h3',
            'blockquote',
            'pre',
            'table',
            '.pdf-table-raster',
            '.pdf-message-math-raster',
            '.pdf-raster-slice',
          ],
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
      })
      .from(el)
      .save();

    return { success: true };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
}

async function buildAndDownloadTextPdf(payload) {
  const doc = createTextPdf(payload);
  await chrome.downloads.download({
    url: doc.output('datauristring'),
    filename: payload.filename,
    saveAs: true,
  });
}

function createTextPdf(payload) {
  const { jsPDF } = self.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const margin = 16;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (mm) => {
    if (y + mm > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.splitTextToSize(payload.title || 'Qwen Chat', contentW).forEach((line) => {
    ensureSpace(7);
    doc.text(line, margin, y);
    y += 7;
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  ensureSpace(5);
  doc.text(`Exported ${payload.exportDate}`, margin, y);
  y += 10;

  payload.messages.forEach((msg) => {
    ensureSpace(12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(msg.role === 'user' ? 'You' : 'Qwen', margin, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.splitTextToSize((msg.text || '').trim(), contentW).forEach((line) => {
      ensureSpace(5);
      doc.text(line, margin, y);
      y += 5;
    });
    y += 4;
  });

  const total = doc.internal.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Page ${p} of ${total}`, pageW / 2, pageH - 8, { align: 'center' });
  }

  return doc;
}
