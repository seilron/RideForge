# TASK: Phase 2 — 세션 import 연동 + 운동 후 리포트 UI

## 전제 조건 (완료된 것)

- `src/utils/load.js` 존재 (calcTrainingLoad, calcHRZoneDist, calcFitness, classifySession, SESSION_TYPE_META 포함)
- `src/db/schema.js` DB_VERSION=3 으로 업그레이드 완료
- `src/db/index.js` 에 saveFitnessCache, getRecentSessions 등 코칭 CRUD 추가 완료

---

## 작업 1: import.js — 세션 저장 시 코칭 필드 자동 계산

### 파일: `src/ui/import.js`

`saveGroup` 함수(또는 세션을 saveSession()으로 저장하는 지점)에서
세션 객체를 DB에 넣기 전에 아래 필드를 계산하여 추가한다.

```js
import { calcHRZoneDist, calcTrainingLoad, classifySession } from "../utils/load.js";
import { getHRZones, calcMaxHR } from "../utils/hr.js";
import { getProfile, getAllSessionsAsc, saveFitnessCache } from "../db/index.js";
import { calcFitness } from "../utils/load.js";
```

저장 직전 session 객체에 추가할 필드:

```js
// 1. HR존 분포 계산 (records 배열 필요)
const profile = await getProfile();
const maxHR = profile?.max_hr_observed ?? calcMaxHR(profile?.age ?? 30);
const zones = getHRZones(maxHR);
const hrZoneDist = calcHRZoneDist(records, zones);

// 2. 케이던스 표준편차 계산
const cadValues = records.map(r => r.cadence).filter(v => v != null && v > 0);
const cadMean = cadValues.reduce((a, b) => a + b, 0) / (cadValues.length || 1);
const cadVariance = cadValues.reduce((a, b) => a + (b - cadMean) ** 2, 0) / (cadValues.length || 1);
const cadenceStddev = Math.round(Math.sqrt(cadVariance) * 10) / 10;

// 3. 훈련 부하 계산
const trainingLoad = calcTrainingLoad(session.duration, hrZoneDist);

// 4. 세션 유형 분류
const sessionWithStats = { ...session, hr_zone_dist: hrZoneDist, cadence_stddev: cadenceStddev };
const sessionType = classifySession(sessionWithStats, zones);

// session 객체에 병합
Object.assign(session, {
  hr_zone_dist: hrZoneDist,
  cadence_stddev: cadenceStddev,
  training_load: trainingLoad,
  session_type: sessionType,
});
```

세션 저장 완료 후 Fitness 캐시 갱신:

```js
// 저장 후 ATL/CTL/TSB 캐시 갱신
const allSessions = await getAllSessionsAsc();
const fitness = calcFitness(allSessions);
await saveFitnessCache({ atl: fitness.atl, ctl: fitness.ctl, tsb: fitness.tsb });
```

---

## 작업 2: cadence.js 신규 생성

### 파일: `src/utils/cadence.js` (신규)

```js
/**
 * cadence.js — 케이던스 분석 유틸
 */

/**
 * 케이던스 표준편차 계산 (페달링 안정성)
 * @param {Array<{ cadence: number }>} records
 * @returns {number} stddev (낮을수록 안정적)
 */
export function calcCadenceStddev(records) { ... }

/**
 * 케이던스-심박 피어슨 상관계수
 * @param {Array<{ cadence: number, heart_rate: number }>} records
 * @returns {number} -1 ~ 1 (전환 초기엔 높음, 완성되면 낮아짐)
 */
export function calcCadenceHRCorrelation(records) { ... }

/**
 * 케이던스 안정성 등급 반환
 * @param {number} stddev
 * @returns {{ grade: "excellent"|"good"|"fair"|"poor", label: string, color: string }}
 */
export function getCadenceGrade(stddev) {
  // stddev < 5  → excellent
  // stddev < 10 → good
  // stddev < 15 → fair
  // stddev >= 15 → poor
}
```

---

## 작업 3: coach.js 신규 생성

### 파일: `src/ui/coach.js` (신규)
### 라우트: `#/coach`

#### 화면 구성 (섹션 순서)

**섹션 A — 컨디션 신호등 카드**

- getFitnessCache() 로 ATL/CTL/TSB 불러오기
- 데이터 없으면 getAllSessionsAsc() → calcFitness() 직접 계산
- 표시: TSB 신호등(🟢🟡🔴) + 상태 레이블 + ATL/CTL/TSB 수치 3개
- CTL 수치 아래 "체력 성장 중" / "유지 중" 텍스트 (CTL 전주 대비 증감)

**섹션 B — 최근 세션 리포트**

- getRecentSessions(7) 로 최근 7일 세션 조회
- 가장 최근 세션 1개에 대해:
  - session_type 태그 (SESSION_TYPE_META 색상 사용)
  - 한 줄 코멘트 (SESSION_TYPE_META.comment)
  - hr_zone_dist 바 차트 (가로 스택바, Chart.js)
  - cadence_stddev → getCadenceGrade() 등급 표시

**섹션 C — Z2 달성률 추이 (4주)**

- getRecentSessions(28) 조회
- 주차별(7일 단위)로 grouping → 주차별 hr_zone_dist.z2 평균 계산
- Chart.js Line 차트, 목표선 0.60 (60%) 점선 오버레이
- 현재 주 Z2% 수치 강조 표시

**섹션 D — 케이던스 전환 추적 (4주)**

- getRecentSessions(28) 조회
- 주차별 cadence_stddev 평균 → Line 차트 (낮아질수록 좋음, 방향 표시 주의)
- 가장 최근 세션의 케이던스-심박 상관계수 표시 (calcCadenceHRCorrelation)
- "전환 진행도" 텍스트: 상관계수 0.7 이상 → "전환 초기", 0.4~0.7 → "전환 중", 0.4 미만 → "전환 완성"

**섹션 E — D-Day 트래커**

- getCoachGoal() 로 목표일 불러오기
- 목표일 미설정 시 입력 폼 표시 (날짜 input + 목표 이벤트명 text input)
- 설정 시: 남은 주차 계산, CTL 목표 커브 시각화
  - 현재 CTL → 목표 CTL(60) 까지 선형 가이드라인
  - 실제 CTL history 오버레이 (calcFitness().history 마지막 8주)
  - "현재 페이스라면 목표일 CTL 예상치 OO" 메시지

#### 스타일 가이드

- 기존 stats.js, detail.js 와 동일한 카드 레이아웃 패턴 사용
- 각 섹션은 `.coach-card` 클래스 카드로 감싸기
- 신호등 카드는 TSB 상태에 따라 카드 왼쪽 border-left 색상 변경

---

## 작업 4: main.js — 라우터에 #/coach 등록

### 파일: `src/main.js`

```js
import { renderCoach } from "./ui/coach.js";
// 라우터에 추가
router.on("/coach", renderCoach);
```

네비게이션 바(있다면)에 "코치" 링크 추가.

---

## 완료 기준 체크리스트

- [ ] FIT import 후 sessions 레코드에 hr_zone_dist, training_load, cadence_stddev, session_type 저장 확인
- [ ] import 후 IndexedDB settings["fitness_cache"] 갱신 확인
- [ ] #/coach 라우트 진입 시 빈 화면 없이 각 섹션 렌더링
- [ ] 세션 데이터 없을 때 각 섹션 빈 상태(empty state) 처리 확인
- [ ] Chart.js 차트 2개 이상 정상 렌더링 확인
- [ ] 기존 #/sessions, #/stats 화면 정상 동작 회귀 없음 확인

---

## 주의사항

- 서버/백엔드 추가 금지 — IndexedDB 전용
- Chart.js 는 이미 설치되어 있음 (package.json 확인)
- 기존 hr.js, time.js 수정 금지
- import.js 수정 시 기존 saveGroup 로직(중복 방지, 병합 등) 건드리지 말 것
