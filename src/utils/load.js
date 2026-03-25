/**
 * load.js — 훈련 부하 계산 엔진 (Phase 1)
 *
 * ATL (Acute Training Load)  : 7일 지수이동평균  → 단기 피로
 * CTL (Chronic Training Load): 42일 지수이동평균 → 장기 체력
 * TSB (Training Stress Balance): CTL - ATL       → 현재 컨디션
 */

/** HR존별 가중치 */
const ZONE_WEIGHT = {
  1: 1.0,
  2: 1.5,
  3: 2.0,
  4: 3.0,
  5: 4.0,
};

/** 지수이동평균 상수 */
const ATL_DAYS = 7;
const CTL_DAYS = 42;
const ATL_K = 1 / ATL_DAYS;
const CTL_K = 1 / CTL_DAYS;

/**
 * 세션 하나의 훈련 부하(Training Load) 계산
 *
 * TL = duration(분) × zone_weight
 * zone_weight = 존별 비율 × 가중치의 가중 합산
 *
 * @param {number} durationSec  세션 총 시간 (초)
 * @param {{ z1, z2, z3, z4, z5 }} hrZoneDist  존별 비율 (합계 ≈ 1.0)
 * @returns {number} training load 점수
 */
export function calcTrainingLoad(durationSec, hrZoneDist) {
  const durationMin = durationSec / 60;

  const weightedZone =
    (hrZoneDist.z1 ?? 0) * ZONE_WEIGHT[1] +
    (hrZoneDist.z2 ?? 0) * ZONE_WEIGHT[2] +
    (hrZoneDist.z3 ?? 0) * ZONE_WEIGHT[3] +
    (hrZoneDist.z4 ?? 0) * ZONE_WEIGHT[4] +
    (hrZoneDist.z5 ?? 0) * ZONE_WEIGHT[5];

  return Math.round(durationMin * weightedZone * 10) / 10;
}

/**
 * HR존 분포 비율 계산
 *
 * @param {Array<{ heart_rate: number }>} records  세션 레코드 배열
 * @param {Array<{ zone, min, max }>} zones        getHRZones() 반환값
 * @returns {{ z1, z2, z3, z4, z5 }}  각 존 비율 (0~1, 합계 = 1)
 */
export function calcHRZoneDist(records, zones) {
  const hrRecords = records.filter(
    (r) => r.heart_rate != null && r.heart_rate > 0
  );

  if (hrRecords.length === 0) {
    return { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  }

  const counts = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };

  for (const r of hrRecords) {
    const zone = getZoneForHR(r.heart_rate, zones);
    counts[`z${zone}`]++;
  }

  const total = hrRecords.length;
  return {
    z1: Math.round((counts.z1 / total) * 1000) / 1000,
    z2: Math.round((counts.z2 / total) * 1000) / 1000,
    z3: Math.round((counts.z3 / total) * 1000) / 1000,
    z4: Math.round((counts.z4 / total) * 1000) / 1000,
    z5: Math.round((counts.z5 / total) * 1000) / 1000,
  };
}

/**
 * getZoneForHR — hr.js 의존성을 끊기 위해 load.js 내부에도 포함
 * (hr.js import 시 순환 의존 방지)
 */
function getZoneForHR(hr, zones) {
  for (let i = zones.length - 1; i >= 0; i--) {
    if (hr >= zones[i].min) return zones[i].zone;
  }
  return 1;
}

/**
 * ATL / CTL / TSB 계산
 *
 * sessions 배열을 날짜 오름차순으로 받아 일별로 ATL/CTL을 누적 계산한다.
 * 데이터 없는 날도 감쇠(decay)를 적용해야 정확하므로
 * 첫 세션 날짜 ~ 오늘까지 전체 날짜 시퀀스를 생성한다.
 *
 * @param {Array<{ date: string, training_load: number }>} sessions
 *   날짜 오름차순 정렬된 세션 배열
 * @returns {{ atl: number, ctl: number, tsb: number, history: Array }}
 *   - atl, ctl, tsb: 오늘 기준 최신값
 *   - history: [{ date, atl, ctl, tsb, load }] 전체 히스토리 (차트용)
 */
export function calcFitness(sessions) {
  if (!sessions || sessions.length === 0) {
    return { atl: 0, ctl: 0, tsb: 0, history: [] };
  }

  // 날짜 → TL 맵 생성
  const loadByDate = new Map();
  for (const s of sessions) {
    const dateKey = s.date.slice(0, 10); // "YYYY-MM-DD"
    const prev = loadByDate.get(dateKey) ?? 0;
    loadByDate.set(dateKey, prev + (s.training_load ?? 0));
  }

  // 첫 세션 날짜 ~ 오늘까지 전체 날짜 시퀀스 생성
  const firstDate = new Date(sessions[0].date.slice(0, 10));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const history = [];
  let atl = 0;
  let ctl = 0;

  const cursor = new Date(firstDate);
  while (cursor <= today) {
    const key = cursor.toISOString().slice(0, 10);
    const load = loadByDate.get(key) ?? 0;

    // 지수이동평균 업데이트
    atl = atl * (1 - ATL_K) + load * ATL_K;
    ctl = ctl * (1 - CTL_K) + load * CTL_K;
    const tsb = ctl - atl;

    history.push({
      date: key,
      atl: Math.round(atl * 10) / 10,
      ctl: Math.round(ctl * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
      load,
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  const latest = history[history.length - 1];
  return {
    atl: latest.atl,
    ctl: latest.ctl,
    tsb: latest.tsb,
    history,
  };
}

/**
 * TSB 기반 컨디션 상태 반환
 *
 * @param {number} tsb
 * @returns {{ status: "good"|"normal"|"tired", label: string, color: string, emoji: string }}
 */
export function getTSBStatus(tsb) {
  if (tsb > 5) {
    return { status: "good",   label: "컨디션 양호",     color: "#66bb6a", emoji: "🟢" };
  } else if (tsb >= -10) {
    return { status: "normal", label: "훈련 적응 중",    color: "#ffa726", emoji: "🟡" };
  } else {
    return { status: "tired",  label: "피로 누적 주의",  color: "#ef5350", emoji: "🔴" };
  }
}

/**
 * 세션 유형 자동 분류
 *
 * 우선순위: interval > tempo > aerobic > recovery
 *
 * @param {{ avg_hr: number, duration: number, hr_zone_dist: object, cadence_stddev: number }} session
 * @param {Array<{ zone, min, max }>} zones  getHRZones() 반환값
 * @returns {"recovery"|"aerobic"|"tempo"|"interval"}
 */
export function classifySession(session, zones) {
  const dist = session.hr_zone_dist ?? {};
  const z2Upper = zones.find((z) => z.zone === 2)?.max ?? 0;

  const z4z5 = (dist.z4 ?? 0) + (dist.z5 ?? 0);
  const z3z4 = (dist.z3 ?? 0) + (dist.z4 ?? 0);
  const cadStddev = session.cadence_stddev ?? 0;

  if (z4z5 >= 0.25 && cadStddev > 15) return "interval";
  if (z3z4 >= 0.40)                   return "tempo";
  if ((dist.z2 ?? 0) >= 0.60)         return "aerobic";
  if (session.avg_hr <= z2Upper && session.duration < 3600) return "recovery";

  // 기본값: 가장 비율 높은 존 기준
  const dominated = ["z2","z3","z4","z5","z1"].find(
    (k) => (dist[k] ?? 0) >= 0.40
  );
  if (dominated === "z2") return "aerobic";
  if (dominated === "z3" || dominated === "z4") return "tempo";
  if (dominated === "z5") return "interval";
  return "aerobic"; // fallback
}

/**
 * 세션 유형 한글 레이블 + 설명
 */
export const SESSION_TYPE_META = {
  recovery: {
    label: "회복 라이딩",
    color: "#546e7a",
    comment: "오늘은 몸을 쉬게 하는 회복 라이딩이었어요. 내일을 위한 충전!",
  },
  aerobic: {
    label: "유산소 기반",
    color: "#42a5f5",
    comment: "Z2 위주의 유산소 라이딩. 지구력 엔진을 키우는 핵심 훈련이에요.",
  },
  tempo: {
    label: "템포 라이딩",
    color: "#ffa726",
    comment: "Z3~Z4의 템포 강도. 젖산 역치를 높이는 효과적인 훈련이에요.",
  },
  interval: {
    label: "고강도 인터벌",
    color: "#ef5350",
    comment: "Z4~Z5 고강도 구간이 포함된 인터벌 훈련. 회복을 충분히 취하세요.",
  },
};
