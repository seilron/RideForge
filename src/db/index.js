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
 * 해시로 세션 조회 (보완 병합용)
 * @returns {object|null}
 */
export async function getSessionByHash(fileHash) {
  const db = await getDB();
  return db.getFromIndex("sessions", "by_hash", fileHash);
}

/**
 * 시간대가 겹치는 세션 조회 (보완 병합 후보 탐색)
 * @param {number} startMs   Unix ms
 * @param {number} endMs     Unix ms
 * @param {number} threshold 최소 겹침 비율 (기본 0.30)
 */
export async function getSessionsInTimeRange(startMs, endMs, threshold = 0.30) {
  const db = await getDB();
  // ±2시간 여유를 두고 by_date 인덱스로 후보 조회 후 실제 겹침 필터
  const startISO = new Date(startMs - 7_200_000).toISOString();
  const endISO   = new Date(endMs   + 7_200_000).toISOString();
  const range    = IDBKeyRange.bound(startISO, endISO);
  const sessions = await db.getAllFromIndex("sessions", "by_date", range);
  return sessions.filter((s) => {
    const sStart = new Date(s.date).getTime();
    const sEnd   = sStart + (s.duration ?? 0) * 1000;
    const overlap = Math.max(0, Math.min(sEnd, endMs) - Math.max(sStart, startMs));
    const minDur  = Math.min(sEnd - sStart, endMs - startMs);
    return minDur > 0 && overlap / minDur >= threshold;
  });
}

/**
 * 세션 메타데이터만 업데이트 (레코드 변경 없음)
 * hr_zone_dist, training_load, session_type 등 재계산 시 사용
 */
export async function patchSession(session) {
  const db = await getDB();
  await db.put("sessions", session);
}

/**
 * 세션 + 레코드 업데이트 (기존 레코드 교체)
 */
export async function updateSession(session, records) {
  const db = await getDB();
  const oldRecords = await db.getAllFromIndex("records", "by_session", session.id);
  const tx = db.transaction(["sessions", "records"], "readwrite");
  tx.objectStore("sessions").put(session);
  const recStore = tx.objectStore("records");
  for (const r of oldRecords) recStore.delete(r.id);
  for (const r of records)    recStore.put(r);
  await tx.done;
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

/**
 * 코칭 계산용 경량 세션 목록 조회
 * records 없이 sessions 필드만 반환 (날짜 오름차순)
 * ATL/CTL/TSB 계산 시 전체 히스토리가 필요하므로 오름차순으로 반환
 */
export async function getAllSessionsAsc() {
  const db = await getDB();
  return db.getAllFromIndex("sessions", "by_date");
}

/** 특정 세션 단건 조회 */
export async function getSession(sessionId) {
  const db = await getDB();
  return db.get("sessions", sessionId);
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

// ─────────────────────────────────────────────
// 4단계 코칭 엔진 CRUD
// ─────────────────────────────────────────────

/**
 * 바이크 프로파일 조회
 * @returns {object|null}
 */
export async function getBike() {
  const db = await getDB();
  const row = await db.get("settings", "bike");
  return row?.value ?? null;
}

/**
 * 바이크 프로파일 저장
 * @param {object} bike  바이크 스펙 객체 (CLAUDE.md 스키마 참조)
 */
export async function saveBike(bike) {
  const db = await getDB();
  await db.put("settings", {
    key: "bike",
    value: { ...bike, updatedAt: new Date().toISOString() },
  });
}

/**
 * 코칭 목표 조회
 * @returns {{ target_date, goal_event, updatedAt }|null}
 */
export async function getCoachGoal() {
  const db = await getDB();
  const row = await db.get("settings", "coach_goal");
  return row?.value ?? null;
}

/**
 * 코칭 목표 저장
 * @param {{ target_date: string, goal_event: string }} goal
 */
export async function saveCoachGoal(goal) {
  const db = await getDB();
  await db.put("settings", {
    key: "coach_goal",
    value: { ...goal, updatedAt: new Date().toISOString() },
  });
}

/**
 * Fitness 캐시 조회 (ATL/CTL/TSB 마지막 계산값)
 * 매 세션 import 시 갱신, 코칭 화면 초기 로드 시 빠른 표시용
 * @returns {{ atl, ctl, tsb, calculatedAt }|null}
 */
export async function getFitnessCache() {
  const db = await getDB();
  const row = await db.get("settings", "fitness_cache");
  return row?.value ?? null;
}

/**
 * Fitness 캐시 저장
 * @param {{ atl: number, ctl: number, tsb: number }} fitness
 */
export async function saveFitnessCache(fitness) {
  const db = await getDB();
  await db.put("settings", {
    key: "fitness_cache",
    value: { ...fitness, calculatedAt: new Date().toISOString() },
  });
}

/**
 * 최근 N일 세션 조회 (Z2 달성률 추이, 케이던스 추이 계산용)
 * @param {number} days  조회할 일수 (기본 28일 = 4주)
 * @returns {Array}
 */
export async function getRecentSessions(days = 28) {
  const db = await getDB();
  const all = await db.getAllFromIndex("sessions", "by_date");
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return all.filter((s) => new Date(s.date) >= cutoff);
}
