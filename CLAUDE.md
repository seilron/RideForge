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
    debug.js              디버그 화면
  utils/
    hr.js                 Tanaka 공식, HR존 계산, 존 판별
    time.js               ZEPP 타임스탬프 오프셋 감지, FIT epoch 변환
```

---

## 라우팅

```
#/              Import 화면 (프로필 카드 + FIT 드롭존)
#/sessions      세션 목록
#/session/:id   세션 상세
#/stats         누적 분석
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
- 규칙 기반 코칭 vs AI 기반 코칭 방향 아직 미결정
- 구현 전 아이디어 확정 필요

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
