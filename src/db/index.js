import { openDB } from "idb";
import { DB_NAME, DB_VERSION, upgrade } from "./schema.js";

let _db;
async function getDB() {
  if (!_db) _db = await openDB(DB_NAME, DB_VERSION, { upgrade });
  return _db;
}

/**
 * FIT ArrayBuffer → SHA-256 hex 해시
 * 중복 import 방지용
 */
export async function hashBuffer(buffer) {
  const hashBuf = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 해시로 이미 저장된 세션인지 확인
 * @returns {boolean}
 */
export async function isDuplicate(fileHash) {
  const db = await getDB();
  const existing = await db.getFromIndex("sessions", "by_hash", fileHash);
  return existing != null;
}

/**
 * Session + Records 트랜잭션으로 한 번에 저장
 */
export async function saveSession(session, records) {
  const db = await getDB();
  const tx = db.transaction(["sessions", "records"], "readwrite");

  tx.objectStore("sessions").put(session);

  const recStore = tx.objectStore("records");
  for (const record of records) {
    recStore.put(record);
  }

  await tx.done;
}

/** 세션 목록 (날짜 역순) */
export async function getAllSessions() {
  const db = await getDB();
  const all = await db.getAllFromIndex("sessions", "by_date");
  return all.reverse();
}

/** 특정 세션의 레코드 전체 */
export async function getRecordsBySession(sessionId) {
  const db = await getDB();
  return db.getAllFromIndex("records", "by_session", sessionId);
}

/** 전체 레코드 조회 (누적 분석용) */
export async function getAllRecords() {
  const db = await getDB();
  return db.getAll("records");
}

/** 사용자 프로필 조회 */
export async function getProfile() {
  const db = await getDB();
  const row = await db.get("settings", "profile");
  return row?.value ?? null;
}

/** 사용자 프로필 저장 */
export async function saveProfile(profile) {
  const db = await getDB();
  await db.put("settings", { key: "profile", value: profile });
}

/** 세션 삭제 (레코드 cascade 삭제) */
export async function deleteSession(sessionId) {
  const db = await getDB();

  // 먼저 해당 세션의 레코드 ID 목록 조회
  const records = await db.getAllFromIndex("records", "by_session", sessionId);

  // 세션 + 레코드 한 트랜잭션으로 삭제
  const tx = db.transaction(["sessions", "records"], "readwrite");
  tx.objectStore("sessions").delete(sessionId);
  const recStore = tx.objectStore("records");
  for (const r of records) {
    recStore.delete(r.id);
  }
  await tx.done;
}
