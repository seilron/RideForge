# TASK: Phase 3~5 — 바이크 프로파일 + 튜닝 가이드 + Claude.ai 프롬프트 생성기

## 전제 조건 (완료된 것)

- Phase 1, 2 완료
- `src/utils/load.js`, `src/utils/cadence.js` 존재
- `src/db/index.js` 에 getBike/saveBike, getCoachGoal/saveCoachGoal 존재
- `src/ui/coach.js` 섹션 A~E 구현 완료

---

## 작업 1: prompt.js 신규 생성

### 파일: `src/utils/prompt.js` (신규)

Claude.ai 연계용 프롬프트 생성기. API 직접 호출 없음.
데이터를 받아 텍스트 프롬프트를 조립해 반환하는 순수 함수 모음.

```js
/**
 * 공통 데이터 블록 조립
 * @param {object} params
 * @param {{ atl, ctl, tsb }} params.fitness
 * @param {Array} params.recentSessions  최근 28일 세션
 * @param {object} params.profile        { name, age, max_hr_observed }
 * @param {object} params.bike           바이크 프로파일 (nullable)
 * @returns {string}
 */
function buildDataBlock({ fitness, recentSessions, profile, bike }) { ... }

/**
 * 프롬프트 1: 훈련 분석 + 4주 플랜 요청
 */
export function buildTrainingPrompt(params) { ... }

/**
 * 프롬프트 2: 케이던스 전환 코칭
 * Z3 고착 해결, 출퇴근 루트에서 Z2 유지 전략
 */
export function buildCadencePrompt(params) { ... }

/**
 * 프롬프트 3: 장비 튜닝 추천
 * 현재 바이크 스펙 + CTL 기반 우선순위 업그레이드
 */
export function buildGearPrompt(params) { ... }
```

각 함수는 아래 구조의 텍스트 문자열을 반환:

```
[내 훈련 데이터 요약]
- 최근 4주 총 거리: OOkm / 주간 평균: OOkm
- 현재 CTL: OO / ATL: OO / TSB: OO
- HR존 분포 (4주 평균): Z1 OO% / Z2 OO% / Z3 OO% / Z4 OO% / Z5 OO%
- Z2 달성률 추이: 4주전 OO% → 3주전 OO% → 2주전 OO% → 이번주 OO%
- 케이던스 평균: OOrpm / 안정성(stddev): OO
- 케이던스-심박 상관계수: O.OO

[내 바이크 스펙]  ← bike null이면 섹션 생략
- 종류: OO / 구동계: OO
- 크랭크: OOT / 스프라켓: OO-OOT
- 타이어: 700×OOc / 클리트: OO

[목표 및 컨텍스트]
- 목표: 6개월 내 국토종주 (633km / 4박 5일)
- 현재 과제: 토크→케이던스 주행 전환 중
- 나이: OO세 / 최대심박: OOObpm

[질문]
← 프롬프트 유형별로 다른 질문 삽입
```

---

## 작업 2: coach.js — 섹션 F (바이크 프로파일 + 튜닝 가이드) 추가

### 파일: `src/ui/coach.js` 에 섹션 추가

**섹션 F-1 — 바이크 프로파일 입력 카드**

- getBike() 로 기존 프로파일 불러오기
- 없으면 입력 폼 표시, 있으면 저장된 스펙 카드로 표시 + "수정" 버튼

입력 폼 필드:
```
바이크 종류    : <select> road / hybrid / mtb / touring
브랜드 / 모델  : <input type="text"> × 2
구동계         : <input type="text">  예: "shimano tiagra 10단"
앞 크랭크      : <input type="text">  예: "50/34"  (슬래시 구분)
뒤 스프라켓    : <input type="text">  예: "11-34"  (하이픈 구분)
휠 사이즈      : <select> 700c / 650b / 26 / 27.5 / 29
타이어 폭(mm)  : <input type="number">
클리트 타입    : <select> 없음(none) / SPD / SPD-SL
```

저장 시 saveBike() 호출. 입력값 파싱:
- 크랭크 "50/34" → `chainring: [50, 34]`
- 스프라켓 "11-34" → `sprocket: [11, 34]`

**섹션 F-2 — CTL 기반 튜닝 가이드 카드**

현재 CTL에 따라 투자 단계 자동 표시:

| CTL | 단계 | 표시 내용 |
|-----|------|-----------|
| < 30 | 입문 | 헬멧, 클리트(SPD), 타이어 교체 |
| 30~60 | 성장 | 케이던스 센서, 안장 피팅, 기어비 최적화 |
| ≥ 60 | 완성 | 짐받이, 패니어, 장거리 안장, 투어링 타이어 |

각 항목은 우선순위 번호 + 아이콘 + 한 줄 설명으로 표시.

**기어비 진단** (bike 프로파일 저장된 경우에만 표시):

```
목표 케이던스 85rpm × 최소 기어비(최소 chainring ÷ 최대 sprocket)
→ 최저 주행 속도(km/h) 계산
→ 세션 avg_speed(최근 28일 평균)와 비교
```

- 최저 속도 ≤ avg_speed × 0.7 → "⚠️ 현재 기어비로는 Z2 구간에서 목표 케이던스 달성이 어려울 수 있어요. 스프라켓 교체를 고려하세요."
- 그 외 → "✅ 현재 기어비로 케이던스 목표 달성 가능합니다."

---

## 작업 3: coach.js — 섹션 G (Claude.ai 프롬프트 생성기) 추가

### 파일: `src/ui/coach.js` 에 섹션 추가

**섹션 G — Claude.ai 에게 물어보기**

버튼 3개를 카드로 표시:

```
[ 📊 훈련 패턴 분석 받기 ]
[ 🚴 케이던스 전환 코칭 받기 ]
[ 🔧 장비 업그레이드 추천 받기 ]
```

각 버튼 클릭 시:
1. 해당 prompt.js 함수로 프롬프트 텍스트 생성
2. `navigator.clipboard.writeText(prompt)` 로 클립보드 복사
3. `window.open("https://claude.ai/new", "_blank")` 로 Claude.ai 새 탭 열기
4. 버튼 아래 "✅ 프롬프트가 클립보드에 복사됐어요. Claude.ai에 붙여넣기 하세요." 토스트 메시지 표시 (2초 후 사라짐)

프롬프트 생성에 필요한 데이터 수집:
```js
const [fitness, recentSessions, profile, bike] = await Promise.all([
  getFitnessCache(),       // 없으면 calcFitness(await getAllSessionsAsc())
  getRecentSessions(28),
  getProfile(),
  getBike(),               // null 허용
]);
```

---

## 완료 기준 체크리스트

- [ ] `src/utils/prompt.js` 생성, 3개 함수 모두 구현 및 빈 데이터 방어 처리
- [ ] 바이크 프로파일 저장/불러오기/수정 정상 동작
- [ ] 기어비 진단 로직 정상 동작 (bike 없으면 섹션 미표시)
- [ ] 클립보드 복사 + Claude.ai 새 탭 열기 정상 동작
- [ ] 프롬프트 텍스트에 실제 데이터값 정상 삽입 확인 (OO 플레이스홀더 없이)
- [ ] 모바일(PWA) 환경에서 navigator.clipboard 권한 예외 처리 확인
  - 클립보드 실패 시 → 텍스트 textarea로 표시하고 직접 복사 유도

---

## 주의사항

- 서버/백엔드 추가 금지 — IndexedDB 전용
- Claude.ai API 직접 호출 금지 — 클립보드 복사 + 새 탭 열기까지만
- prompt.js 는 순수 함수만 포함 (DB 접근 금지, 데이터는 인자로 받을 것)
- 기존 섹션 A~E 동작에 영향 없도록 섹션 F, G는 하단에 추가
