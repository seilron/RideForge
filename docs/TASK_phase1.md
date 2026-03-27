# TASK: Phase 1 — 훈련 부하 계산 엔진

## 전제 조건 (완료된 것)

- 1~3단계 구현 완료 (FIT import, 세션 뷰, 누적 분석)
- `src/db/schema.js` DB_VERSION=2, settings 스토어 존재
- `src/db/index.js` 기본 CRUD 존재 (saveSession, getAllSessions, getProfile 등)
- `src/utils/hr.js` 존재 (calcMaxHR, getHRZones, getZoneForHR)

---

## 작업 1: schema.js — DB_VERSION 3으로 업그레이드

### 파일: `src/db/schema.js`

`DB_VERSION` 을 2 → 3 으로 변경.

`upgrade` 함수에 아래 블록 추가:

```js
if (oldVersion < 3) {
  // sessions 스토어에 추가되는 코칭 필드 (v3):
  //   hr_zone_dist    : { z1, z2, z3, z4, z5 }  존별 비율 (0~1)
  //   training_load   : number  세션 훈련 부하 점수
  //   cadence_stddev  : number  케이던스 표준편차
  //   session_type    : string  "recovery" | "aerobic" | "tempo" | "interval"
  //
  // IndexedDB는 기존 objectStore에 컬럼을 직접 추가할 수 없으므로
  // 새 필드는 저장 시점에 자연스럽게 포함되고,
  // 기존 레코드 조회 시 undefined → 호출부에서 nullish coalescing으로 방어한다.
  //
  // settings 키 추가 (런타임 put/get으로 사용, 별도 스토어 불필요):
  //   "bike"          → 바이크 프로파일 객체
  //   "coach_goal"    → { target_date, goal_event, updatedAt }
  //   "fitness_cache" → { atl, ctl, tsb, calculatedAt }
}
```

---

## 작업 2: index.js — 코칭 CRUD 추가

### 파일: `src/db/index.js`

기존 코드 유지하고 아래 함수들을 파일 하단에 추가한다.

```js
// ─────────────────────────────────────────────
// 4단계 코칭 엔진 CRUD
// ─────────────────────────────────────────────

/** 특정 세션 단건 조회 */
export async function getSession(sessionId) { ... }

/**
 * 코칭 계산용 세션 목록 (날짜 오름차순)
 * ATL/CTL 계산 시 전체 히스토리가 필요하므로 오름차순 반환
 */
export async function getAllSessionsAsc() { ... }

/**
 * 최근 N일 세션 조회 (기본 28일)
 * Z2 달성률 추이, 케이던스 추이 계산용
 */
export async function getRecentSessions(days = 28) { ... }

/** 바이크 프로파일 조회 */
export async function getBike() { ... }

/** 바이크 프로파일 저장 */
export async function saveBike(bike) {
  // updatedAt: new Date().toISOString() 자동 추가
}

/** 코칭 목표 조회 */
export async function getCoachGoal() { ... }

/** 코칭 목표 저장 */
export async function saveCoachGoal(goal) {
  // updatedAt: new Date().toISOString() 자동 추가
}

/**
 * Fitness 캐시 조회 (ATL/CTL/TSB 마지막 계산값)
 * 세션 import 시 갱신, 코칭 화면 초기 로드 시 빠른 표시용
 */
export async function getFitnessCache() { ... }

/** Fitness 캐시 저장 */
export async function saveFitnessCache(fitness) {
  // calculatedAt: new Date().toISOString() 자동 추가
}
```

모든 함수는 settings 스토어의 key-value 패턴 사용:
```js
// 읽기 패턴
const row = await db.get("settings", "bike");
return row?.value ?? null;

// 쓰기 패턴
await db.put("settings", { key: "bike", value: { ...bike, updatedAt: ... } });
```

---

## 작업 3: load.js 신규 생성

### 파일: `src/utils/load.js` (신규)

아래 함수를 모두 구현한다.

### 3-1. HR존 분포 계산

```js
/**
 * records 배열 → 존별 비율 객체
 * heart_rate 없는 레코드는 제외하고 계산
 * @param {Array<{ heart_rate: number }>} records
 * @param {Array<{ zone, min, max }>} zones  getHRZones() 반환값
 * @returns {{ z1, z2, z3, z4, z5 }}  각 존 비율 (0~1, 합계 ≈ 1)
 */
export function calcHRZoneDist(records, zones) { ... }
```

### 3-2. 세션 훈련 부하 계산

```js
/**
 * TL = duration(분) × 존별 가중 합산
 *
 * 존별 가중치:
 *   Z1: 1.0 / Z2: 1.5 / Z3: 2.0 / Z4: 3.0 / Z5: 4.0
 *
 * @param {number} durationSec
 * @param {{ z1, z2, z3, z4, z5 }} hrZoneDist
 * @returns {number}
 */
export function calcTrainingLoad(durationSec, hrZoneDist) { ... }
```

### 3-3. ATL / CTL / TSB 계산

```js
/**
 * 전체 세션 히스토리 기반 피트니스 지표 계산
 *
 * - ATL: 7일 지수이동평균  (ATL_K = 1/7)
 * - CTL: 42일 지수이동평균 (CTL_K = 1/42)
 * - TSB: CTL - ATL
 *
 * 데이터 없는 날도 감쇠(decay) 적용:
 * 첫 세션 날짜 ~ 오늘까지 전체 날짜 시퀀스를 생성하여 순회
 *
 * 같은 날 세션이 여러 개면 TL 합산
 *
 * @param {Array<{ date: string, training_load: number }>} sessions
 *   날짜 오름차순 정렬된 세션 배열
 * @returns {{
 *   atl: number,
 *   ctl: number,
 *   tsb: number,
 *   history: Array<{ date, atl, ctl, tsb, load }>
 * }}
 */
export function calcFitness(sessions) { ... }
```

### 3-4. TSB 상태

```js
/**
 * TSB 수치 → 컨디션 상태 객체
 * TSB > 5    → { status: "good",   label: "컨디션 양호",    emoji: "🟢", color: "#66bb6a" }
 * -10 ~ 5   → { status: "normal", label: "훈련 적응 중",   emoji: "🟡", color: "#ffa726" }
 * TSB < -10  → { status: "tired",  label: "피로 누적 주의", emoji: "🔴", color: "#ef5350" }
 */
export function getTSBStatus(tsb) { ... }
```

### 3-5. 세션 유형 자동 분류

```js
/**
 * 세션 유형 분류 (우선순위: interval > tempo > aerobic > recovery)
 *
 * interval : z4+z5 >= 0.25 AND cadence_stddev > 15
 * tempo    : z3+z4 >= 0.40
 * aerobic  : z2 >= 0.60
 * recovery : avg_hr < Z2 상한 AND duration < 3600
 * 기본값   : aerobic
 *
 * @param {{ avg_hr, duration, hr_zone_dist, cadence_stddev }} session
 * @param {Array<{ zone, min, max }>} zones
 * @returns {"recovery"|"aerobic"|"tempo"|"interval"}
 */
export function classifySession(session, zones) { ... }
```

### 3-6. 세션 유형 메타데이터

```js
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
```

---

## 완료 기준 체크리스트

- [ ] `DB_VERSION` 이 3으로 변경되고 기존 DB 열려도 오류 없음
- [ ] `getSession`, `getAllSessionsAsc`, `getRecentSessions` 정상 동작
- [ ] `getBike` / `saveBike` / `getCoachGoal` / `saveCoachGoal` 저장·조회 정상
- [ ] `getFitnessCache` / `saveFitnessCache` 저장·조회 정상
- [ ] `calcHRZoneDist`: heart_rate 없는 레코드 필터링, 비율 합계 ≈ 1.0
- [ ] `calcTrainingLoad`: 60분 Z2 위주(z2=0.6, z3=0.3) → 약 102점 내외
- [ ] `calcFitness`: 빈 배열 입력 시 `{ atl:0, ctl:0, tsb:0, history:[] }` 반환
- [ ] `classifySession`: 아래 5개 케이스 모두 올바른 유형 반환
  - z2=0.65, cadStddev=8 → `aerobic`
  - z3=0.50, z4=0.30, cadStddev=12 → `tempo`
  - z4=0.40, z5=0.20, cadStddev=18 → `interval`
  - z1=0.50, z2=0.40, duration=1800 → `recovery`
  - z3=0.60, z4=0.10, cadStddev=11 → `tempo`
- [ ] 기존 화면(#/, #/sessions, #/session/:id, #/stats) 정상 동작 회귀 없음

---

## 주의사항

- 서버/백엔드 추가 금지 — IndexedDB 전용
- `src/utils/hr.js` 수정 금지 (load.js 에서 import 하여 사용)
- `load.js` 내부에서 DB 직접 접근 금지 — 순수 계산 함수만 포함
- `index.js` 기존 함수(saveSession, getAllSessions, deleteSession 등) 수정 금지
