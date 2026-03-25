/**
 * cadence.js — 케이던스 분석 유틸
 *
 * 토크→케이던스 주행 전환 추적에 사용되는 순수 계산 함수 모음.
 */

/**
 * 케이던스 표준편차 계산 (페달링 안정성)
 * 낮을수록 페달링이 일정 → 케이던스 주행 완성도 척도
 *
 * @param {Array<{ cadence: number }>} records
 * @returns {number} stddev (소수점 1자리)
 */
export function calcCadenceStddev(records) {
  const values = records.map((r) => r.cadence).filter((v) => v != null && v > 0);
  if (values.length === 0) return 0;

  const mean     = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.round(Math.sqrt(variance) * 10) / 10;
}

/**
 * 케이던스-심박 피어슨 상관계수
 *
 * 전환 초기: 높음 (케이던스 오르면 심박 같이 오름)
 * 전환 완성: 낮아짐 (케이던스 독립적으로 제어 가능)
 *
 * @param {Array<{ cadence: number, heart_rate: number }>} records
 * @returns {number} -1 ~ 1, 유효 데이터 없으면 null
 */
export function calcCadenceHRCorrelation(records) {
  const pairs = records.filter((r) => r.cadence != null && r.cadence > 0 && r.heart_rate != null);
  if (pairs.length < 5) return null;

  const n    = pairs.length;
  const cadX = pairs.map((r) => r.cadence);
  const hrY  = pairs.map((r) => r.heart_rate);

  const meanX = cadX.reduce((a, b) => a + b, 0) / n;
  const meanY = hrY.reduce((a, b)  => a + b, 0) / n;

  let cov = 0, varX = 0, varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = cadX[i] - meanX;
    const dy = hrY[i]  - meanY;
    cov  += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  const denom = Math.sqrt(varX * varY);
  if (denom === 0) return null;
  return Math.round((cov / denom) * 100) / 100;
}

/**
 * 케이던스 안정성 등급
 *
 * @param {number} stddev
 * @returns {{ grade: "excellent"|"good"|"fair"|"poor", label: string, color: string }}
 */
export function getCadenceGrade(stddev) {
  if (stddev < 5)  return { grade: "excellent", label: "매우 안정적", color: "#66bb6a" };
  if (stddev < 10) return { grade: "good",      label: "안정적",      color: "#42a5f5" };
  if (stddev < 15) return { grade: "fair",      label: "개선 중",     color: "#ffa726" };
  return               { grade: "poor",      label: "불안정",      color: "#ef5350" };
}
