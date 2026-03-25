/**
 * prompt.js — Claude.ai 연계 프롬프트 생성기
 *
 * 순수 함수만 포함. DB 접근 없음. 데이터는 인자로 받는다.
 * API 직접 호출 없음 — 텍스트 생성 후 클립보드 복사 + Claude.ai 새 탭 열기.
 */

/**
 * 공통 데이터 블록 조립
 *
 * @param {{ atl, ctl, tsb }} fitness
 * @param {Array}  recentSessions  최근 28일 세션 배열
 * @param {object} profile         { name, age, max_hr_observed }
 * @param {object|null} bike       바이크 프로파일
 * @returns {string}
 */
function buildDataBlock({ fitness, recentSessions, profile, bike }) {
  const totalDist   = recentSessions.reduce((s, x) => s + (x.distance ?? 0), 0);
  const weeklyAvg   = Math.round(totalDist / 4 * 10) / 10;

  // 4주 Z2 달성률 추이
  const weekly = groupByWeek4(recentSessions);
  const z2Trend = weekly
    .map((w) => {
      if (w.length === 0) return "데이터 없음";
      const avg = w.reduce((s, x) => s + (x.hr_zone_dist?.z2 ?? 0), 0) / w.length;
      return `${Math.round(avg * 100)}%`;
    })
    .join(" → ");

  // 4주 평균 HR존 분포
  const zoneDist = ["z1","z2","z3","z4","z5"].map((k) => {
    if (recentSessions.length === 0) return `${k.toUpperCase()} 0%`;
    const avg = recentSessions.reduce((s, x) => s + (x.hr_zone_dist?.[k] ?? 0), 0) / recentSessions.length;
    return `${k.toUpperCase()} ${Math.round(avg * 100)}%`;
  }).join(" / ");

  // 케이던스 통계
  const cadSessions = recentSessions.filter((s) => s.cadence_stddev != null);
  const cadStddevAvg = cadSessions.length
    ? Math.round(cadSessions.reduce((s, x) => s + x.cadence_stddev, 0) / cadSessions.length * 10) / 10
    : null;
  const cadAvg = recentSessions.filter((s) => s.avg_cadence).length
    ? Math.round(recentSessions.reduce((s, x) => s + (x.avg_cadence ?? 0), 0) / recentSessions.length)
    : null;

  const maxHR = profile?.max_hr_observed ?? null;

  let block = `[내 훈련 데이터 요약]
- 최근 4주 총 거리: ${totalDist.toFixed(1)}km / 주간 평균: ${weeklyAvg}km
- 현재 CTL: ${fitness?.ctl?.toFixed(1) ?? "—"} / ATL: ${fitness?.atl?.toFixed(1) ?? "—"} / TSB: ${fitness?.tsb?.toFixed(1) ?? "—"}
- HR존 분포 (4주 평균): ${zoneDist}
- Z2 달성률 추이: ${z2Trend}
${cadAvg    != null ? `- 케이던스 평균: ${cadAvg}rpm` : ""}
${cadStddevAvg != null ? `- 케이던스 안정성(stddev): ${cadStddevAvg}` : ""}`;

  if (bike) {
    const chainring = Array.isArray(bike.chainring) ? bike.chainring.join("/") : "—";
    const sprocket  = Array.isArray(bike.sprocket)  ? bike.sprocket.join("-")  : "—";
    block += `

[내 바이크 스펙]
- 종류: ${bike.type ?? "—"} / 브랜드·모델: ${bike.brand ?? "—"} ${bike.model ?? ""}
- 구동계: ${bike.drivetrain ?? "—"}
- 크랭크: ${chainring}T / 스프라켓: ${sprocket}T
- 타이어: ${bike.wheel_size ?? "—"}×${bike.tire_width ?? "—"}mm / 클리트: ${bike.cleat_type ?? "—"}`;
  }

  block += `

[목표 및 컨텍스트]
- 목표: 6개월 내 국토종주 (633km / 4박 5일)
- 현재 과제: 토크→케이던스 주행 전환 중 (목표 85~95rpm)
- 나이: ${profile?.age ?? "—"}세 / 최대심박: ${maxHR ? `${maxHR}bpm` : "—"}`;

  return block;
}

/**
 * 프롬프트 1: 훈련 분석 + 4주 플랜 요청
 */
export function buildTrainingPrompt(params) {
  return `${buildDataBlock(params)}

[질문]
위 데이터를 바탕으로 다음을 분석하고 조언해 주세요:
1. 현재 훈련 패턴에서 가장 큰 문제점은 무엇인가요?
2. Z2 달성률을 60% 이상으로 높이기 위한 구체적인 방법은?
3. 앞으로 4주간의 주간 훈련 플랜을 제안해 주세요. (출퇴근 라이딩 기반, 주 5일)
4. 국토종주까지 CTL 60 달성을 위한 페이스 조언도 부탁드립니다.`;
}

/**
 * 프롬프트 2: 케이던스 전환 코칭
 */
export function buildCadencePrompt(params) {
  return `${buildDataBlock(params)}

[질문]
토크 주행에서 케이던스 주행으로 전환 중입니다. 다음을 도와주세요:
1. Z3 고착 패턴을 깨고 출퇴근 루트에서 Z2를 유지하는 실전 방법은?
2. 85~95rpm 케이던스를 자연스럽게 유지하도록 훈련하는 방법은?
3. 케이던스 표준편차가 낮아지도록 하는 페달링 드릴이나 훈련법을 알려주세요.
4. 케이던스-심박 상관계수가 낮아지는 것이 전환 완성의 지표인데, 얼마나 걸릴까요?`;
}

/**
 * 프롬프트 3: 장비 업그레이드 추천
 */
export function buildGearPrompt(params) {
  const { fitness } = params;
  const ctl = fitness?.ctl ?? 0;
  const stage = ctl < 30 ? "입문" : ctl < 60 ? "성장" : "완성";

  return `${buildDataBlock(params)}

[질문]
현재 CTL ${ctl.toFixed(1)} (${stage} 단계) 기준으로 장비 투자 우선순위를 알려주세요:
1. 지금 단계에서 가장 효과적인 업그레이드 항목 3가지는?
2. 국토종주를 위해 반드시 갖춰야 할 장비/액세서리는?
3. 현재 바이크 스펙에서 Z2 유지 + 목표 케이던스(85rpm) 동시 달성을 위한 기어비 조언은?
4. 장거리(100km+) 라이딩 시 안장 통증 예방을 위한 세팅 팁도 부탁드립니다.`;
}

// ── 내부 유틸 ─────────────────────────────────────────────────────────────────

/** 세션 배열을 최근 4주 단위로 그룹핑 */
function groupByWeek4(sessions) {
  const weeks = [];
  for (let i = 3; i >= 0; i--) {
    const end   = new Date();
    end.setDate(end.getDate() - i * 7);
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    weeks.push(sessions.filter((s) => {
      const d = new Date(s.date);
      return d >= start && d <= end;
    }));
  }
  return weeks;
}
