import { detectZeppOffset } from "../utils/time.js";

// 두 기기 타임스탬프 허용 오차 (ms)
// 기기 간 시계 차이 + 기록 주기 차이를 모두 흡수
const MATCH_TOLERANCE_MS = 3000;

/**
 * Wahoo(GPS 기기) + ZEPP(HR 기기) records 병합
 * nearest-neighbor 매칭으로 기기 간 시계 차이, 기록 주기 차이를 허용
 *
 * @param {Array}       wahooRecords  GPS 기기 records
 * @param {Array|null}  zeppRecords   HR 기기 records (없으면 Wahoo only)
 * @param {number|null} calories
 */
export function merge(wahooRecords, zeppRecords, calories = null) {
  wahooRecords.sort((a, b) => a.timestamp - b.timestamp);

  if (!zeppRecords || zeppRecords.length === 0) {
    const records = rebaseElapsedTime(wahooRecords);
    return { session: buildSession(records, calories), records, matchRate: null };
  }

  zeppRecords.sort((a, b) => a.timestamp - b.timestamp);

  // 1. 시간대 오프셋 보정 (±12시간 정수 단위 차이)
  const offset = detectZeppOffset(wahooRecords[0].timestamp, zeppRecords[0].timestamp);
  if (offset !== 0) {
    console.info(`[RideForge] ZEPP offset: ${offset / 3600000}h — correcting`);
    zeppRecords = zeppRecords.map((r) => ({ ...r, timestamp: r.timestamp + offset }));
  }

  // 2. 교집합 구간 추출
  const overlapStart = Math.max(wahooRecords[0].timestamp, zeppRecords[0].timestamp);
  const overlapEnd   = Math.min(wahooRecords.at(-1).timestamp, zeppRecords.at(-1).timestamp);

  if (overlapStart >= overlapEnd) {
    console.warn("[RideForge] No overlap between files — saving GPS file only");
    const records = rebaseElapsedTime(wahooRecords);
    return { session: buildSession(records, calories), records, matchRate: null };
  }

  wahooRecords = wahooRecords.filter((r) => r.timestamp >= overlapStart && r.timestamp <= overlapEnd);
  zeppRecords  = zeppRecords.filter((r) => r.timestamp >= overlapStart && r.timestamp <= overlapEnd);

  console.info(
    `[RideForge] Overlap ${((overlapEnd - overlapStart) / 1000).toFixed(0)}s` +
    ` | Wahoo ${wahooRecords.length} records, ZEPP ${zeppRecords.length} records`
  );

  // 3. Nearest-neighbor 매칭 (허용 오차 ±MATCH_TOLERANCE_MS)
  let matched = 0;
  const merged = wahooRecords.map((w) => {
    const z = findNearest(zeppRecords, w.timestamp, MATCH_TOLERANCE_MS);
    if (z) {
      matched++;
      return {
        ...w,
        // 심박수만 Zepp에서 가져옴
        // 속도·케이던스·GPS·거리는 Wahoo(센서) 기준 유지
        heart_rate: z.heart_rate ?? w.heart_rate,
        src_zepp:   true,
      };
    }
    return w;
  });

  const matchRate = wahooRecords.length > 0 ? matched / wahooRecords.length : 0;
  console.info(`[RideForge] Match rate: ${(matchRate * 100).toFixed(1)}% (${matched}/${wahooRecords.length})`);

  if (matchRate < 0.5) {
    console.warn("[RideForge] Match rate below 50% — check if files belong to same session");
  }

  // 4. elapsed_time 재정규화
  const records = rebaseElapsedTime(merged);
  return { session: buildSession(records, calories), records, matchRate };
}

/**
 * 정렬된 배열에서 targetTs에 가장 가까운 레코드를 이진탐색으로 찾는다.
 * toleranceMs 초과면 null 반환.
 */
function findNearest(sorted, targetTs, toleranceMs) {
  let lo = 0, hi = sorted.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].timestamp < targetTs) lo = mid + 1;
    else hi = mid;
  }

  // lo 와 lo-1 중 더 가까운 것
  const candidates = [sorted[lo - 1], sorted[lo]].filter(Boolean);
  if (candidates.length === 0) return null;

  const best = candidates.reduce((a, b) =>
    Math.abs(a.timestamp - targetTs) <= Math.abs(b.timestamp - targetTs) ? a : b
  );

  return Math.abs(best.timestamp - targetTs) <= toleranceMs ? best : null;
}

function rebaseElapsedTime(records) {
  if (records.length === 0) return records;
  const base = records[0].elapsed_time ?? 0;
  if (base === 0) return records;
  return records.map((r) => ({
    ...r,
    elapsed_time: r.elapsed_time != null ? r.elapsed_time - base : null,
  }));
}

function buildSession(records, calories) {
  const nonNull = (arr) => arr.filter((v) => v != null);

  const last     = records[records.length - 1];
  const distance = last?.distance ?? 0;
  const duration = last?.elapsed_time ?? 0;

  const speeds   = nonNull(records.map((r) => r.speed));
  const hrs      = nonNull(records.map((r) => r.heart_rate));
  const cadences = nonNull(records.map((r) => r.cadence)).filter((v) => v > 0);

  const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
  const maxHRObserved = hrs.length ? Math.max(...hrs) : null;

  return {
    distance,
    duration,
    avg_speed:       duration > 0 ? distance / (duration / 3600) : null,
    max_speed:       speeds.length ? Math.max(...speeds) : null,
    avg_hr:          avg(hrs),
    max_hr:          maxHRObserved,
    max_hr_observed: maxHRObserved,
    avg_cadence:     avg(cadences),
    calories,
  };
}
