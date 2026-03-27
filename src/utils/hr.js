/**
 * Nes (2013) 공식 기반 최대심박수 계산
 * 출처: Nes et al., "Age-predicted maximal heart rate in healthy subjects"
 *        Scand J Med Sci Sports, 2013
 * 기존 Tanaka (208 - 0.7×age) 대비 더 넓은 연령대 검증, ±7bpm 오차
 */
export function calcMaxHR(age) {
  return Math.round(211 - 0.64 * age);
}

/**
 * HRmax 유효성 검사 (생리학적 범위 100~220 bpm)
 */
export function isValidHRmax(value) {
  return typeof value === "number" && value >= 100 && value <= 220;
}

/**
 * 심박존 경계 계산 — Coggan 5존 시스템 (HRmax 대비 비율)
 * Z1: ~60% / Z2: 60~75% / Z3: 75~85% / Z4: 85~93% / Z5: 93~100%
 */
export function getHRZones(maxHR) {
  const ranges = [
    { zone: 1, label: "Z1 회복",   min: 0.00, max: 0.60, color: "#546e7a" },
    { zone: 2, label: "Z2 유산소", min: 0.60, max: 0.75, color: "#42a5f5" },
    { zone: 3, label: "Z3 템포",   min: 0.75, max: 0.85, color: "#66bb6a" },
    { zone: 4, label: "Z4 역치",   min: 0.85, max: 0.93, color: "#ffa726" },
    { zone: 5, label: "Z5 최대",   min: 0.93, max: 1.00, color: "#ef5350" },
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

/**
 * HR 샘플 배열에서 노이즈 스파이크 제거
 * - HRmax 5% 초과값 또는 30 bpm 미만 → 앞뒤 샘플 평균으로 선형 보간
 * @param {(number|null)[]} hrSamples  원시 HR 샘플 배열
 * @param {number}          hrmax      기준 HRmax
 * @returns {(number|null)[]} 필터링된 HR 배열
 */
export function filterHRNoise(hrSamples, hrmax) {
  const upper = hrmax * 1.05;
  const lower = 30;
  return hrSamples.map((hr, i) => {
    if (hr == null) return hr;
    if (hr < lower || hr > upper) {
      const prev = hrSamples[i - 1] ?? hr;
      const next = hrSamples[i + 1] ?? hr;
      return Math.round((prev + next) / 2);
    }
    return hr;
  });
}

/**
 * records 배열의 heart_rate 필드에 노이즈 필터 적용 (원본 불변)
 * @param {object[]} records  record 객체 배열
 * @param {number}   hrmax    기준 HRmax
 * @returns {object[]} heart_rate 필터링된 새 records 배열
 */
export function filterRecordsHR(records, hrmax) {
  const raw      = records.map((r) => r.heart_rate);
  const filtered = filterHRNoise(raw, hrmax);
  return records.map((r, i) => ({ ...r, heart_rate: filtered[i] }));
}
