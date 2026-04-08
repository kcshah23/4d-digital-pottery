/**
 * Infer coarse vessel shape from particle positions (local space, y up).
 * Output tags overlap vocabulary used in potteryFactStyleTags.js for fact matching.
 */

/**
 * @param {number[]|Float32Array} positionsFlat  x,y,z,...
 * @returns {{ primary: string, tags: string[], aspect: number }}
 */
export function computePotShapeHint(positionsFlat) {
  const stride = Math.max(6, Math.floor(positionsFlat.length / 12000) * 3);
  const bins = 22;
  const maxRByBin = new Float32Array(bins).fill(0);

  let minY = Infinity;
  let maxY = -Infinity;
  let maxR = 1e-8;

  for (let i = 0; i + 2 < positionsFlat.length; i += stride) {
    const x = positionsFlat[i];
    const y = positionsFlat[i + 1];
    const z = positionsFlat[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    const r = Math.hypot(x, z);
    maxR = Math.max(maxR, r);
    const t = maxY > minY ? (y - minY) / (maxY - minY) : 0;
    const b = Math.min(bins - 1, Math.max(0, (t * bins) | 0));
    maxRByBin[b] = Math.max(maxRByBin[b], r);
  }

  const H = maxY - minY || 1;
  const aspect = H / (2 * maxR);

  const n = (i) => maxRByBin[i] / maxR;
  const avg = (lo, hi) => {
    let s = 0;
    let c = 0;
    for (let i = lo; i < hi; i++) {
      s += n(i);
      c++;
    }
    return c ? s / c : 0;
  };

  const top = avg((bins * 0.8) | 0, bins);
  const mid = avg((bins * 0.32) | 0, (bins * 0.62) | 0);
  const low = avg(0, (bins * 0.22) | 0);

  const tags = new Set();
  let primary = 'balanced_vessel';

  if (aspect >= 1.18 && top < mid * 0.8) {
    primary = 'tall_necked';
    tags.add('tall_necked');
    tags.add('amphora_like');
    tags.add('classical_mediterranean');
  } else if (aspect >= 1.05) {
    primary = 'tall_vessel';
    tags.add('tall_vessel');
    tags.add('stoneware_like');
  }

  if (aspect <= 0.88) {
    primary = 'squat_wide';
    tags.add('squat_wide');
    tags.add('open_bowl');
    tags.add('low_wide');
  }

  if (top > mid * 1.08 && top > low) {
    tags.add('flared_opening');
    tags.add('bowl_form');
  }

  if (mid > top * 1.04 && mid > low * 1.06) {
    tags.add('belly_centered');
    tags.add('globular');
  }

  if (low > mid * 1.03 && aspect < 1.05) {
    tags.add('heavy_base');
    tags.add('storage_jar');
  }

  return {
    primary,
    tags: [...tags],
    aspect: Math.round(aspect * 100) / 100,
  };
}
