export const norm = s => String(s).toLowerCase().replace(/[^a-z]/g, '');

export function wordGapBefore(w, n) {
  const out = new Array(n).fill(false);
  let i = 0, sawGap = false;
  for (const ch of String(w == null ? '' : w)) {
    const lo = String(ch).toLowerCase();
    if (lo >= 'a' && lo <= 'z') {
      if (i < n) out[i] = sawGap;
      i++;
      sawGap = false;
    } else if (i > 0) sawGap = true;
  }
  return out;
}
