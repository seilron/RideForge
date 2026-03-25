/**
 * Tanaka (2001) 공식 기반 최대심박수 계산
 * 208 - (0.7 × age) — 성인 운동자에 더 정확
 *
 * 실측 최대심박 데이터가 누적되면 자동으로 갱신하는 흐름 예정
 */
export function calcMaxHR(age) {
  return Math.round(208 - 0.7 * age);
}

/**
 * 심박존 경계 계산 (maxHR 기준 %)
 * @returns {Array<{ zone, label, min, max, color }>}
 */
export function getHRZones(maxHR) {
  const ranges = [
    { zone: 1, label: "Z1 회복",   min: 0.00, max: 0.60, color: "#546e7a" },
    { zone: 2, label: "Z2 지방",   min: 0.60, max: 0.70, color: "#42a5f5" },
    { zone: 3, label: "Z3 유산소", min: 0.70, max: 0.80, color: "#66bb6a" },
    { zone: 4, label: "Z4 역치",   min: 0.80, max: 0.90, color: "#ffa726" },
    { zone: 5, label: "Z5 최대",   min: 0.90, max: 1.00, color: "#ef5350" },
  ];

  return ranges.map((r) => ({
    ...r,
    min: Math.round(r.min * maxHR),
    max: r.max === 1.0 ? maxHR : Math.round(r.max * maxHR),
  }));
}

/**
 * 심박값이 몇 존인지 반환 (1~5)
 */
export function getZoneForHR(hr, zones) {
  for (let i = zones.length - 1; i >= 0; i--) {
    if (hr >= zones[i].min) return zones[i].zone;
  }
  return 1;
}
