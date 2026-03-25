export const DB_NAME = "rideforge";
export const DB_VERSION = 3;

export function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    const sessions = db.createObjectStore("sessions", { keyPath: "id" });
    sessions.createIndex("by_date", "date");
    sessions.createIndex("by_hash", "file_hash", { unique: true });

    const records = db.createObjectStore("records", { keyPath: "id" });
    records.createIndex("by_session", "session_id");
    records.createIndex("by_timestamp", "timestamp");
  }

  if (oldVersion < 2) {
    // 사용자 프로필 및 앱 설정 스토어
    // key-value 구조: { key: "profile", value: { age, name, ... } }
    db.createObjectStore("settings", { keyPath: "key" });
  }

  // v3: 코칭 엔진용 필드 추가
  // IndexedDB는 기존 objectStore에 컬럼을 직접 추가할 수 없으므로
  // 새 필드는 저장 시점에 자연스럽게 포함되고,
  // 기존 레코드는 getSession 조회 시 undefined → 기본값으로 처리한다.
  // (별도 마이그레이션 불필요 — 읽기 측에서 nullish coalescing으로 방어)
  //
  // sessions에 추가되는 필드:
  //   hr_zone_dist    : { z1, z2, z3, z4, z5 }  존별 비율 (0~1)
  //   training_load   : number  세션 훈련 부하 점수
  //   cadence_stddev  : number  케이던스 표준편차
  //   session_type    : string  "recovery" | "aerobic" | "tempo" | "interval"
  //
  // v3에서 실제로 수행하는 작업:
  //   - settings 스토어에 "bike", "coach_goal" 키 사용 선언 (스토어 자체는 v2에서 생성됨)
  //   - 향후 인덱스 추가가 필요할 경우를 위한 버전 bump
  if (oldVersion < 3) {
    // settings 스토어는 이미 존재하므로 objectStore() 로 참조만 한다.
    // 현재는 구조 변경 없이 버전만 올려 둔다.
    // (bike, coach_goal 키는 런타임에 put/get으로 사용)
  }
}
