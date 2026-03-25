export const DB_NAME = "rideforge";
export const DB_VERSION = 2;

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
}
