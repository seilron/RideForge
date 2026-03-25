/**
 * ZEPP timestamp UTC 오프셋 감지 및 보정
 * Wahoo 첫 timestamp와 비교해 ±12시간 이내 정수 시간 차이면 오프셋으로 판단
 *
 * @param {number} wahooFirstTs - Wahoo 첫 레코드 timestamp (Unix ms)
 * @param {number} zeppFirstTs  - ZEPP 첫 레코드 timestamp (Unix ms)
 * @returns {number} 보정 offset (ms). 0이면 보정 불필요
 */
export function detectZeppOffset(wahooFirstTs, zeppFirstTs) {
  const diffMs = wahooFirstTs - zeppFirstTs;
  const diffHours = diffMs / (1000 * 60 * 60);

  // ±12시간 이내의 정수 시간이면 오프셋으로 판단
  if (Math.abs(diffHours) <= 12) {
    const roundedHours = Math.round(diffHours);
    if (Math.abs(diffHours - roundedHours) < 0.05) {
      return roundedHours * 60 * 60 * 1000;
    }
  }
  return 0;
}

/**
 * FIT timestamp (seconds since 1989-12-31 00:00:00 UTC) → Unix ms 변환
 * fit-file-parser는 이미 JS Date 객체로 반환하므로 보통 불필요하나
 * 원시값이 올 경우를 위해 유틸로 보관
 */
export function fitTimestampToMs(fitTs) {
  if (fitTs instanceof Date) return fitTs.getTime();
  // FIT epoch: 1989-12-31 00:00:00 UTC = 631065600000 ms
  return (fitTs + 631065600) * 1000;
}
