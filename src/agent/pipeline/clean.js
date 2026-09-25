/** Extracted from agent-panel.js:149 — The image the vectorizer actually wants */

import { CLEAN_SIZE } from '@shared/config/tunables.js';

const loadImage = (dataUrl) =>
  new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('the image could not be decoded'));
    im.src = String(dataUrl || '');
  });

const otsuThreshold = (hist, total) => {
  if (!(total > 0)) return 127;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0,
    wB = 0,
    best = -1,
    thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB,
      mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
};

/**
 * -> {dataUrl, size, content:{x,y,w,h}, threshold, srcW, srcH, mime}
 * Pure re-implementation of cleanForVectorizer — keeps Otsu + letterbox logic intact.
 */
export async function cleanForVectorizer(dataUrl) {
  const im = await loadImage(dataUrl);
  const sw = im.naturalWidth || im.width,
    sh = im.naturalHeight || im.height;
  if (!(sw > 0) || !(sh > 0)) throw new Error('the image decoded to no pixels');

  const s = Math.min(CLEAN_SIZE / sw, CLEAN_SIZE / sh);
  const dw = Math.max(1, Math.round(sw * s));
  const dh = Math.max(1, Math.round(sh * s));
  const dx = Math.floor((CLEAN_SIZE - dw) / 2);
  const dy = Math.floor((CLEAN_SIZE - dh) / 2);

  const cv = document.createElement('canvas');
  cv.width = CLEAN_SIZE;
  cv.height = CLEAN_SIZE;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.fillStyle = '#fff';
  cx.fillRect(0, 0, CLEAN_SIZE, CLEAN_SIZE);
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(im, dx, dy, dw, dh);

  const img = cx.getImageData(0, 0, CLEAN_SIZE, CLEAN_SIZE);
  const d = img.data;
  const lum = new Uint8Array(CLEAN_SIZE * CLEAN_SIZE);
  const hist = new Uint32Array(256);
  for (let y = 0; y < CLEAN_SIZE; y++) {
    const inRow = y >= dy && y < dy + dh;
    for (let x = 0; x < CLEAN_SIZE; x++) {
      const i = y * CLEAN_SIZE + x,
        p = i << 2;
      const v = (d[p] * 77 + d[p + 1] * 151 + d[p + 2] * 28) >> 8;
      lum[i] = v;
      if (inRow && x >= dx && x < dx + dw) hist[v]++;
    }
  }
  const thr = otsuThreshold(hist, dw * dh);
  for (let i = 0; i < lum.length; i++) {
    const v = lum[i] > thr ? 255 : 0;
    const p = i << 2;
    d[p] = v;
    d[p + 1] = v;
    d[p + 2] = v;
    d[p + 3] = 255;
  }
  cx.putImageData(img, 0, 0);

  return {
    dataUrl: cv.toDataURL('image/png'),
    mime: 'image/png',
    size: CLEAN_SIZE,
    content: { x: dx, y: dy, w: dw, h: dh },
    threshold: thr,
    srcW: sw,
    srcH: sh
  };
}

export { otsuThreshold };

// for tests / dynamic re-export compat
export default cleanForVectorizer;
