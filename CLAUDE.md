# RideForge — CLAUDE.md

자전거 주행 FIT 데이터 수집·병합·분석 개인용 코치형 PWA.
서버 없음. IndexedDB 전용. Wahoo(GPS) + ZEPP(심박/케이던스) 두 기기 FIT 파일을 단일 세션으로 병합.

---

## 기술 스택

| 항목 | 버전 |
|------|------|
| Vite | ^7.3.1 |
| Vanilla JS | ES2022+ (모듈) |
| fit-file-parser | 2.3.3 (parseAsync 지원) |
| idb | ^8.0.3 |
| Chart.js | ^4.5.1 |
| vite-plugin-pwa | ^1.2.0 |
| Kakao Maps API | 세션 상세 지도 (env: VITE_KAKAO_MAP_KEY) |

---

## 파일 구조

```
src/
  main.js                 라우터 등록, 앱 진입점
  parser/
    detector.js           FIT 파싱 + 기기 역할(gps/hr/unknown) 자동 감지
    grouper.js            여러 FIT 파일 → 세션 그룹 묶기 (시간 겹침 비율 ≥ 0.30)
    merger.js             GPS+HR records 병합 (nearest-neighbor, ±3000ms)
    wahoo.js              Wahoo 전용 파서 (GPS·속도·거리·케이던스)
    zepp.js               ZEPP 전용 파서 (심박·케이던스)
  db/
    schema.js             IndexedDB 스키마 v2, 업그레이드 함수
    index.js              DB CRUD (sessions, records, settings/profile)
  ui/
    router.js             해시 기반 SPA 라우터 (/pattern/:param 지원)
    import.js             FIT 임포트 UI (드래그앤드롭, 그룹 미리보기, 저장)
    sessions.js           세션 목록 화면
    detail.js             세션 상세 (카카오 지도, 속도/심박/케이던스 차트)
    stats.js              누적 분석 (월간/주간 차트, 심박존 분포)
    profile.js            사용자 프로필 카드 (이름, 나이, 최대심박)
    coach.js              코칭 메인 화면 (컨디션 진단 + 리포트 + 튜닝 가이드)  ← 4단계 신규
    debug.js              디버그 화면
  utils/
    hr.js                 Tanaka 공식, HR존 계산, 존 판별
    time.js               ZEPP 타임스탬프 오프셋 감지, FIT epoch 변환
    load.js               ATL / CTL / TSB 훈련 부하 계산 엔진               ← 4단계 신규
    cadence.js            케이던스 안정성 점수, 케이던스-심박 상관계수 계산  ← 4단계 신규
    prompt.js             Claude.ai 연계 프롬프트 생성기                    ← 4단계 신규
```

---

## 라우팅

```
#/              Import 화면 (프로필 카드 + FIT 드롭존)
#/sessions      세션 목록
#/session/:id   세션 상세
#/stats         누적 분석
#/coach         코칭 화면 (4단계 신규)
```

---

## IndexedDB 스키마 (v2)

### sessions
| 필드 | 타입 | 설명 |
|------|------|------|
| id | UUID | PK |
| date | ISO string | 세션 시작 시각 |
| source | string | `merged` / `wahoo_only` / `zepp_only` |
| file_hash | string | GPS 파일 SHA-256 (중복 방지, unique index) |
| distance | number | km |
| duration | number | 초 |
| avg_speed | number | km/h |
| max_speed | number | km/h |
| avg_hr | number | bpm |
| max_hr | number | bpm |
| max_hr_observed | number | 실측 최대 심박 (프로필 자동 갱신용) |
| avg_cadence | number | rpm |
| calories | number | kcal (FIT session 메시지에서 추출) |
| hr_zone_dist | object | `{ z1, z2, z3, z4, z5 }` 존별 비율 (0~1) ← 4단계 신규 |
| training_load | number | 세션 훈련 부하 점수 (duration × zone_weight) ← 4단계 신규 |
| cadence_stddev | number | 케이던스 표준편차 (페달링 안정성 지표) ← 4단계 신규 |
| session_type | string | `recovery` / `aerobic` / `tempo` / `interval` ← 4단계 신규 |

인덱스: `by_date`, `by_hash` (unique)

### records
| 필드 | 타입 | 설명 |
|------|------|------|
| id | UUID | PK |
| session_id | UUID | FK |
| timestamp | Unix ms | |
| elapsed_time | 초 | 세션 내 경과 시간 (rebase 처리됨) |
| speed | km/h | Wahoo 기준 |
| distance | km | Wahoo 기준 |
| lat / lng | 도 | GPS 좌표 (semicircle 변환 완료) |
| cadence | rpm | |
| heart_rate | bpm | 병합 시 ZEPP 우선 |
| src_wahoo | bool | |
| src_zepp | bool | |

인덱스: `by_session`, `by_timestamp`

### settings (key-value)
- key: `"profile"` → `{ name, age, max_hr_observed, updatedAt }`
- key: `"bike"` → 바이크 프로파일 (4단계 신규, 상세 스키마 아래 참조)
- key: `"coach_goal"` → `{ target_date, goal_event, weekly_plan_enabled, updatedAt }` ← 4단계 신규

---

## 핵심 설계 결정

### 중복 방지
- GPS 파일(Wahoo) ArrayBuffer의 SHA-256 해시 사용
- `by_hash` unique 인덱스로 저장 전 중복 체크
- `crypto.subtle.digest("SHA-256", buffer)` (외부 의존성 없음)

### 기기 역할 감지 우선순위 (detector.js)
1. FIT `device_infos` 제조사 문자열 (wahoo/garmin → gps, huami/zepp/amazfit → hr)
2. 파일명 키워드
3. GPS 비율 > 30% → gps, HR 비율 > 30% → hr

### GPS vs HR 파일 결정 우선순위 (import.js `saveGroup`)
1. role 명확히 다를 때 (gps vs hr)
2. HR 보유 여부 (HR 없는 쪽 = GPS 전용)
3. GPS 밀도 (gpsRatio 더 높은 쪽)

### 병합 알고리즘 (merger.js)
1. ZEPP 타임스탬프 오프셋 자동 보정 (±12시간 정수 단위)
2. 두 파일의 시간 교집합 구간만 사용
3. Wahoo records 기준 nearest-neighbor 매칭 (허용 오차 ±3000ms)
4. 심박만 ZEPP에서 가져오고, 속도·거리·GPS·케이던스는 Wahoo 유지
5. 매칭률 < 50% 시 경고 로그

### 심박존 (hr.js)
- 최대심박: 실측(`max_hr_observed`) 우선, 없으면 Tanaka 공식 (208 - 0.7×age)
- Z1(~60%) Z2(60~70%) Z3(70~80%) Z4(80~90%) Z5(90~100%)
- Import 시 `max_hr_observed` 자동 갱신 (프로필에 저장)

### 차트 (Chart.js)
- 세션 상세: records 10초 다운샘플 후 렌더
- 심박 차트에 HR존 배경 그라데이션 (custom plugin `zoneBg`)
- 누적 분석: 월간(주차별) / 주간(요일별) 탭 전환

---

## 구현 완료 현황

### 1단계 — FIT Import & 병합 → DB 저장 ✅
- FIT 파싱 (fit-file-parser parseAsync)
- 기기 역할 자동 감지
- 세션 그룹핑 (겹침 비율 기준)
- Wahoo+ZEPP nearest-neighbor 병합
- SHA-256 중복 방지
- IndexedDB 저장 (트랜잭션)
- Import UI (드래그앤드롭, 미리보기, 분리 버튼)

### 2단계 — 세션 뷰 ✅
- 세션 목록 (날짜 역순, 삭제 기능)
- 세션 상세
  - 카카오 지도 (경로 폴리라인, 시작/도착 마커, bounds fit)
  - 속도 차트 (line)
  - 심박 차트 (line + HR존 배경)
  - 케이던스 차트 (bar)
  - 심박존 분포 바

### 3단계 — 누적 분석 ✅
- 전체 요약 (총 거리, 총 시간, 평균 속도, 최고 심박)
- 심박존 분포 전체 (도넛 + 바)
- 월간 탭: 주차별 거리·횟수·속도·케이던스 차트
- 주간 탭: 요일별 거리·횟수·심박·케이던스 차트
- 이전/다음 기간 내비게이션

### 4단계 — 코칭 엔진 🔲 미구현

#### 유저 컨텍스트
- 목표: 6개월 내 국토종주 (633km / 4박 5일)
- 현재 수준: 주 5일 출퇴근 라이딩 (출근 20km + 퇴근 10km = 일 30km, 주 150km)
- 전환 과제: 토크 주행 → 케이던스 주행 전환 중 (목표 85~95rpm)
- 현재 문제: Z2 유지 불가, Z3 고착 패턴 (출퇴근 루트 특성상 강도 제어 어려움)
- 코칭 방향: 규칙 기반 진단 + Claude.ai 프롬프트 연계 (직접 API 호출 없음)

#### Phase 1 — 훈련 부하 계산 엔진 (load.js)

훈련 부하(TL) = `duration(분) × zone_weight`

| HR존 | zone_weight |
|------|-------------|
| Z1 | 1.0 |
| Z2 | 1.5 |
| Z3 | 2.0 |
| Z4 | 3.0 |
| Z5 | 4.0 |

세션별 TL은 sessions 저장 시점에 계산하여 `training_load` 필드에 저장.

**ATL (단기 피로, 7일 지수이동평균)**
```
ATL_today = ATL_yesterday × (1 - 1/7) + TL_today × (1/7)
```

**CTL (장기 체력, 42일 지수이동평균)**
```
CTL_today = CTL_yesterday × (1 - 1/42) + TL_today × (1/42)
```

**TSB (컨디션)**
```
TSB = CTL - ATL
TSB > 5   → 🟢 회복 / 컨디션 양호
-10 ~ 5   → 🟡 보통 / 훈련 적응 중
TSB < -10 → 🔴 피로 누적 / 과훈련 주의
```

#### Phase 2 — 세션 자동 분류 + 운동 후 리포트 (coach.js)

**운동 유형 자동 분류 규칙 (session_type)**

| 유형 | 판단 조건 |
|------|-----------|
| `recovery` | avg_hr < Z2 상한 AND duration < 3600초 |
| `aerobic` | hr_zone_dist.z2 ≥ 0.60 |
| `tempo` | hr_zone_dist.z3 + z4 ≥ 0.40 |
| `interval` | hr_zone_dist.z4 + z5 ≥ 0.25 AND cadence_stddev > 15 |

우선순위: interval > tempo > aerobic > recovery (위에서부터 첫 매칭)

**운동 후 리포트 구성**
- 운동 유형 태그 + 한 줄 코멘트 (규칙 기반 템플릿)
- 이번 주 Z2 달성률 (Z2 비율 평균) vs 목표(60%)
- 케이던스 안정성 점수 (cadence_stddev 기반, 낮을수록 좋음)
- TSB 신호등 카드

**Z2 달성률 추이**
- 최근 4주 주차별 `hr_zone_dist.z2` 평균 → 꺾은선 차트
- 목표선(0.60) 오버레이

#### Phase 3 — 케이던스 전환 추적 (cadence.js)

**케이던스 안정성 점수**
- `cadence_stddev` = 세션 records의 케이던스 표준편차
- 낮을수록 페달링 일정 → 토크→케이던스 전환 진행도 척도
- 4주 추이 차트로 시각화

**케이던스-심박 상관계수**
- 세션 records에서 `(cadence, heart_rate)` 피어슨 상관계수 계산
- 전환 초기: 상관 높음 (케이던스 오르면 심박 같이 오름)
- 전환 완성: 상관 낮아짐 (케이던스 독립적으로 제어 가능)
- 세션 상세 및 코칭 화면에 표시

#### Phase 4 — 바이크 프로파일 + 튜닝 가이드

**바이크 프로파일 스키마** (`settings["bike"]`)
```js
{
  type: "road" | "hybrid" | "mtb" | "touring",
  brand: string,
  model: string,
  drivetrain: string,          // 예: "shimano_tiagra_10s"
  chainring: [number],         // 앞 크랭크 치수 배열, 예: [50, 34]
  sprocket: [number, number],  // 뒤 스프라켓 최소-최대, 예: [11, 34]
  wheel_size: string,          // 예: "700c"
  tire_width: number,          // mm
  cleat_type: "spd" | "spd_sl" | "none",
  accessories: string[],       // 예: ["light_front", "rack", "bottle_cage"]
  saddle_height_mm: number,    // 선택
  updatedAt: string
}
```

**CTL 기반 투자 단계 분류**

| CTL 단계 | 상태 | 우선 투자 항목 |
|----------|------|---------------|
| CTL < 30 | 입문 | 헬멧, 클리트(SPD), 타이어 교체 |
| CTL 30~60 | 성장 | 케이던스 센서, 안장 피팅, 기어비 최적화 |
| CTL ≥ 60 | 완성 | 짐받이, 패니어, 장거리 안장, 투어링 타이어 |

**기어비 진단 로직**
- 목표 케이던스(85rpm) × 최소 기어비 → 최저 속도 계산
- avg_speed와 비교하여 "현재 기어비로 Z2+케이던스 동시 달성 가능 여부" 판단
- 불가능 시 → 스프라켓 교체 추천 카드 표시

#### Phase 5 — Claude.ai 연계 프롬프트 생성기 (prompt.js)

직접 API 호출 없음. 데이터를 구조화된 텍스트로 조립 후 클립보드 복사 + Claude.ai 새 탭 열기.

**프롬프트 유형 3종**

1. **훈련 분석 프롬프트** — 현재 훈련 패턴 문제점 + 4주 플랜 요청
2. **케이던스 전환 코칭 프롬프트** — Z3 고착 해결, 출퇴근 루트에서 Z2 유지 전략
3. **장비 튜닝 추천 프롬프트** — 현재 바이크 스펙 + CTL 기반 우선순위 업그레이드 추천

**프롬프트 포함 데이터 (자동 조립)**
```
[내 훈련 데이터 요약]
- 최근 4주 총 거리 / 주간 평균 거리
- 현재 CTL / ATL / TSB
- HR존 분포 (4주 평균): Z1 OO% / Z2 OO% / Z3 OO% / Z4 OO% / Z5 OO%
- Z2 달성률 추이 (주차별)
- 케이던스 안정성 점수 추이
- 케이던스-심박 상관계수

[내 바이크 스펙]
- 종류 / 구동계 / 기어비 / 타이어 / 클리트

[목표 및 컨텍스트]
- 목표: 6개월 내 국토종주
- 현재 과제: 토크→케이던스 전환 중
- 나이 / 최대심박
```

#### D-Day 트래커 (coach.js 통합)

- 목표일 설정 → 남은 주차 계산
- CTL 목표 커브 시각화 (현재 CTL → 목표 CTL 60까지 선형 증가 가이드라인)
- "지금 페이스면 목표일에 CTL OO 예상" 메시지

---

## 개발 환경

```
# 개발 서버
npm run dev

# 빌드
npm run build

# 환경변수 (.env.local)
VITE_KAKAO_MAP_KEY=<카카오 지도 API 앱 키>
```

---

## 주요 제약사항

- 서버/백엔드 없음 — IndexedDB 전용, 서버 추가 제안 불필요
- PWA (vite-plugin-pwa) — 오프라인 동작 전제
- 외부 API: Kakao Maps (지도 렌더링 전용)
- Claude.ai 연계는 프롬프트 생성 + 클립보드 복사까지만 (직접 API 호출 없음)
