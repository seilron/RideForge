/**
 * FIT 파일 메타 배열 → 세션 그룹 배열
 *
 * 두 파일의 시간 겹침이 threshold 이상이면 같은 세션으로 묶는다.
 * role이 같더라도 겹침 기준으로 그룹핑 — primary/secondary는 import.js에서 GPS 밀도로 결정.
 *
 * @param {Array}  metas      detectFit() 반환값 배열
 * @param {number} threshold  겹침 비율 임계값 (0~1, 기본 0.30)
 */
export function groupSessions(metas, threshold = 0.30) {
  const sorted = [...metas].sort((a, b) => a.start - b.start);
  const used   = new Set();
  const groups = [];

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;

    const primary = sorted[i];
    used.add(i);

    let best      = null;
    let bestRatio = 0;
    let bestIdx   = -1;

    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const ratio = overlapRatio(primary, sorted[j]);
      if (ratio >= threshold && ratio > bestRatio) {
        bestRatio = ratio;
        best      = sorted[j];
        bestIdx   = j;
      }
    }

    if (best) {
      used.add(bestIdx);
      groups.push({ metas: [primary, best], overlapRatio: bestRatio });
    } else {
      groups.push({ metas: [primary], overlapRatio: null });
    }
  }

  return groups;
}

/** 짧은 쪽 기준 겹침 비율 */
function overlapRatio(a, b) {
  const overlapMs   = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const minDuration = Math.min(a.end - a.start, b.end - b.start);
  return minDuration > 0 ? overlapMs / minDuration : 0;
}
