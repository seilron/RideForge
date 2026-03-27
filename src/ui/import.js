import { detectFit } from "../parser/detector.js";
import { groupSessions } from "../parser/grouper.js";
import { merge } from "../parser/merger.js";
import { hashBuffer, isDuplicate, saveSession, getProfile, saveProfile,
         getAllSessionsAsc, saveFitnessCache,
         getSessionByHash, getSessionsInTimeRange, updateSession,
         getRecordsBySession } from "../db/index.js";
import { navigate } from "./router.js";
import { showToast } from "./toast.js";
import { calcHRZoneDist, calcTrainingLoad, classifySession, calcFitness } from "../utils/load.js";
import { calcMaxHR, getHRZones, filterRecordsHR } from "../utils/hr.js";

const FIELDS = [
  "timestamp", "elapsed_time", "speed", "distance",
  "lat", "lng", "cadence", "heart_rate", "src_wahoo", "src_zepp",
];

// 파싱된 파일 목록 (state)
let parsedFiles = [];
let groups      = [];

export function initImportUI() {
  // 페이지 진입마다 상태 초기화
  parsedFiles = [];
  groups      = [];

  const dropZone  = document.getElementById("drop-zone");
  const fileInput = document.getElementById("fit-input");
  const preview   = document.getElementById("import-preview");
  const saveBtn   = document.getElementById("save-all-btn");

  // 드래그앤드롭
  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    await handleFiles([...e.dataTransfer.files].filter((f) => f.name.endsWith(".fit")));
  });

  fileInput.addEventListener("change", async () => {
    await handleFiles([...fileInput.files]);
    fileInput.value = "";
  });

  saveBtn.addEventListener("click", () => saveAll(preview, saveBtn));

  async function handleFiles(files) {
    if (files.length === 0) return;

    dropZone.textContent = `파싱 중... (0 / ${files.length})`;
    dropZone.style.pointerEvents = "none";

    let done = 0;
    for (const file of files) {
      const buf  = await file.arrayBuffer();
      const meta = await detectFit(buf, file.name);
      if (meta) {
        // buffer는 저장 시 해시 계산 + 재사용 위해 보관
        meta._buffer = buf;
        parsedFiles.push(meta);
      }
      dropZone.textContent = `파싱 중... (${++done} / ${files.length})`;
    }

    dropZone.textContent  = "📂 추가 파일을 드래그하거나 클릭해서 선택";
    dropZone.style.pointerEvents = "";

    groups = groupSessions(parsedFiles);
    renderPreview(preview, saveBtn);
  }
}

// ── 미리보기 렌더링 ────────────────────────────────────────────────────────────

function renderPreview(container, saveBtn) {
  if (groups.length === 0) {
    container.innerHTML = "";
    saveBtn.style.display = "none";
    return;
  }

  const pending = groups.filter((g) => !g._saved && !g._duplicate);

  container.innerHTML = `
    <div style="font-size:.8rem;color:var(--muted);margin-bottom:10px">
      감지된 세션 ${groups.length}개
    </div>
    ${groups.map((g, i) => renderGroup(g, i)).join("")}
  `;

  // 그룹 해제 버튼
  container.querySelectorAll(".btn-unlink").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = +btn.dataset.group;
      const g   = groups[idx];
      if (g.metas.length < 2) return;
      // 두 파일을 별도 그룹으로 분리
      const [a, b] = g.metas;
      groups.splice(idx, 1, { metas: [a], overlapRatio: null }, { metas: [b], overlapRatio: null });
      renderPreview(container, saveBtn);
    });
  });

  saveBtn.style.display = pending.length > 0 ? "block" : "none";
  saveBtn.textContent   = `저장 (${pending.length}개 세션)`;
}

function renderGroup(g, idx) {
  const mainMeta  = g.metas.find((m) => m.role === "gps") ?? g.metas[0];
  const date      = new Date(mainMeta.start);
  const dateStr   = date.toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit",
  });
  const isMerged  = g.metas.length > 1;
  const pct       = g.overlapRatio != null ? Math.round(g.overlapRatio * 100) : null;

  const statusClass = g._saved ? "group-saved" : g._duplicate ? "group-dup" : "";
  const statusBadge = g._saved
    ? `<span class="group-badge saved">${g._supplemented ? "보완됨" : "저장됨"}</span>`
    : g._duplicate
    ? `<span class="group-badge dup">중복</span>`
    : isMerged
    ? `<span class="group-badge merge">병합 ${pct}%</span>`
    : `<span class="group-badge solo">단독</span>`;

  const files = g.metas.map((m) => `
    <div class="group-file">
      <span class="file-role">${roleIcon(m.role)}</span>
      <span class="file-name">${m.fileName}</span>
      <span class="file-dur">${formatDuration(m.duration)}</span>
      <span class="file-caps">${fileCaps(m)}</span>
    </div>`).join("");

  return `
    <div class="import-group ${statusClass}">
      <div class="group-header">
        <span class="group-date">${dateStr}</span>
        ${statusBadge}
        ${isMerged && !g._saved && !g._duplicate
          ? `<button class="btn-unlink" data-group="${idx}" title="그룹 해제">✕ 분리</button>`
          : ""}
      </div>
      <div class="group-files">${files}</div>
    </div>`;
}

// ── 저장 ────────────────────────────────────────────────────────────────────

async function saveAll(previewEl, saveBtn) {
  saveBtn.disabled = true;

  for (const g of groups) {
    if (g._saved || g._duplicate) continue;

    try {
      await saveGroup(g);
    } catch (err) {
      console.error("[RideForge] save error:", err);
      g._error = err.message;
    }
  }

  renderPreview(previewEl, saveBtn);
  saveBtn.disabled = false;

  const saved = groups.filter((g) => g._saved).length;
  if (saved > 0) {
    saveBtn.textContent = `✓ ${saved}개 저장 완료 — 기록 보기`;
    saveBtn.onclick = () => navigate("/sessions");
  }
}

export async function saveGroup(g) {
  let gpsMeta, hrMeta;
  if (g.metas.length === 1) {
    gpsMeta = g.metas[0];
    hrMeta  = null;
  } else {
    const [a, b] = g.metas;

    // 우선순위 1: role이 명확히 다를 때
    if (a.role !== b.role && a.role !== "unknown" && b.role !== "unknown") {
      gpsMeta = a.role === "gps" ? a : b;
      hrMeta  = a.role === "gps" ? b : a;

    // 우선순위 2: HR 보유 여부 — HR 없는 쪽이 GPS 전용 기기 (Wahoo)
    } else if (a.hasHR !== b.hasHR) {
      gpsMeta = a.hasHR ? b : a;
      hrMeta  = a.hasHR ? a : b;

    // 우선순위 3: GPS 밀도 (둘 다 HR 있거나 둘 다 없을 때)
    } else {
      gpsMeta = a.gpsRatio >= b.gpsRatio ? a : b;
      hrMeta  = a.gpsRatio >= b.gpsRatio ? b : a;
    }
  }

  // 중복 체크 (GPS 파일 해시 기준)
  const fileHash = await hashBuffer(gpsMeta._buffer);
  if (await isDuplicate(fileHash)) {
    // GPS 파일이 이미 저장됐지만 HR 파일이 새로 들어온 경우 → 기존 세션 보완 시도
    if (hrMeta) {
      const existingSession = await getSessionByHash(fileHash);
      if (existingSession?.source === "wahoo_only") {
        await supplementSession(existingSession, gpsMeta, hrMeta, fileHash, g);
        return;
      }
    }
    g._duplicate = true;
    return;
  }

  // ── 기존 세션 보완 체크 ──────────────────────────────────────────────────────
  // 별도 Import로 들어온 경우: 시간대 겹치는 기존 세션 중 보완 가능한 것을 찾아 업데이트
  {
    const startMs    = gpsMeta.start;
    const endMs      = gpsMeta.end;
    const candidates = await getSessionsInTimeRange(startMs, endMs);
    const target     = findComplementTarget(candidates, gpsMeta, hrMeta);
    if (target) {
      await supplementSession(target, gpsMeta, hrMeta, fileHash, g);
      return;
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  // ── 프로필 + 기준 HRmax (노이즈 필터 / 존 계산에 공통 사용) ────────────────
  const profile = await getProfile();
  const maxHR   = (profile?.max_hr_observed ?? 0) > 0
    ? profile.max_hr_observed
    : calcMaxHR(profile?.age ?? 30);
  const zones   = getHRZones(maxHR);

  // src 플래그 설정
  const wahooRecords = gpsMeta.records.map((r) => ({ ...r, src_wahoo: true,  src_zepp: false }));
  const zeppRecords  = hrMeta
    ? hrMeta.records.map((r) => ({ ...r, src_wahoo: false, src_zepp: true }))
    : null;
  const calories = gpsMeta.calories ?? hrMeta?.calories ?? null;

  const { session: rawSummary, records: rawRecords } = merge(wahooRecords, zeppRecords, calories);

  // ── HR 노이즈 필터 적용 (HRmax 5% 초과 스파이크 → 선형 보간) ────────────────
  const mergedRecords = filterRecordsHR(rawRecords, maxHR);

  // 필터 후 HR 통계 재계산
  const filteredHRs  = mergedRecords.map((r) => r.heart_rate).filter((v) => v != null);
  const filteredMaxHR = filteredHRs.length ? Math.max(...filteredHRs) : null;
  const filteredAvgHR = filteredHRs.length
    ? Math.round(filteredHRs.reduce((a, b) => a + b, 0) / filteredHRs.length)
    : null;

  const sessionId = crypto.randomUUID();
  const session = {
    id:        sessionId,
    date:      new Date(gpsMeta.start).toISOString(),
    source:    zeppRecords ? "merged" : "wahoo_only",
    file_hash: fileHash,
    ...rawSummary,
    avg_hr:          filteredAvgHR          ?? rawSummary.avg_hr,
    max_hr:          filteredMaxHR          ?? rawSummary.max_hr,
    max_hr_observed: filteredMaxHR          ?? rawSummary.max_hr_observed,
  };

  const records = mergedRecords.map((r) => ({
    id:         crypto.randomUUID(),
    session_id: sessionId,
    ...pickFields(r),
  }));

  // ── 코칭 필드 계산 (저장 전) ────────────────────────────────────────────────
  const hrZoneDist = calcHRZoneDist(mergedRecords, zones);

  const cadValues  = mergedRecords.map((r) => r.cadence).filter((v) => v != null && v > 0);
  const cadMean    = cadValues.length ? cadValues.reduce((a, b) => a + b, 0) / cadValues.length : 0;
  const cadStddev  = cadValues.length
    ? Math.round(Math.sqrt(cadValues.reduce((a, b) => a + (b - cadMean) ** 2, 0) / cadValues.length) * 10) / 10
    : 0;

  const trainingLoad  = calcTrainingLoad(session.duration, hrZoneDist);
  const sessionWithStats = { ...session, hr_zone_dist: hrZoneDist, cadence_stddev: cadStddev };
  const sessionType   = classifySession(sessionWithStats, zones);

  Object.assign(session, {
    hr_zone_dist:    hrZoneDist,
    cadence_stddev:  cadStddev,
    training_load:   trainingLoad,
    session_type:    sessionType,
  });
  // ────────────────────────────────────────────────────────────────────────────

  await saveSession(session, records);

  // 실측 max_hr 갱신
  if (session.max_hr_observed) {
    if (profile) {
      const current = profile.max_hr_observed ?? 0;
      if (session.max_hr_observed > current) {
        await saveProfile({ ...profile, max_hr_observed: session.max_hr_observed });
      }
    }
  }

  // Fitness 캐시 갱신 (ATL/CTL/TSB)
  const allSessions = await getAllSessionsAsc();
  const fitness     = calcFitness(allSessions);
  await saveFitnessCache({ atl: fitness.atl, ctl: fitness.ctl, tsb: fitness.tsb });

  g._saved = true;
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function pickFields(record) {
  const out = {};
  for (const f of FIELDS) out[f] = record[f] ?? null;
  return out;
}

function roleIcon(role) {
  return role === "gps" ? "📍 GPS" : role === "hr" ? "❤️ HR" : "📄";
}

function fileCaps(meta) {
  const caps = [];
  if (meta.hasGps) caps.push("GPS");
  if (meta.hasHR)  caps.push("심박");
  if (meta.records.some((r) => r.cadence != null)) caps.push("케이던스");
  if (meta.records.some((r) => r.speed   != null)) caps.push("속도");
  return caps.join(" · ");
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Share Target ──────────────────────────────────────────────────────────────

/**
 * Share Target으로 수신된 FIT 파일 일괄 처리
 * URL 파라미터 ?shared=true 감지 시 호출
 */
export async function processPendingSharedFits() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("shared")) return;

  // URL 파라미터 즉시 제거 (새로고침 시 재처리 방지)
  const hash = window.location.hash;
  window.history.replaceState({}, "", window.location.pathname + hash);

  try {
    const cache = await caches.open("rideforge-pending-fits");
    const response = await cache.match("/pending-fits");

    if (!response) {
      console.warn("[RideForge] pending-fits 없음 — 이미 처리되었거나 만료됨");
      return;
    }

    const fileDataList = await response.json();
    await cache.delete("/pending-fits");

    console.log(`[RideForge] 공유 FIT 파일 ${fileDataList.length}개 처리 시작`);

    const results = { success: 0, duplicate: 0, error: 0 };

    for (const { name, data } of fileDataList) {
      try {
        const buffer = new Uint8Array(data).buffer;
        const meta = await detectFit(buffer, name);

        if (!meta) {
          console.warn(`[RideForge] ${name} — FIT 파싱 실패, 건너뜀`);
          results.error++;
          continue;
        }

        meta._buffer = buffer;
        const group = { metas: [meta], overlapRatio: null };
        await saveGroup(group);

        if (group._duplicate) results.duplicate++;
        else if (group._saved)  results.success++;

      } catch (err) {
        console.error(`[RideForge] ${name} 저장 실패:`, err);
        results.error++;
      }
    }

    notifySharedResult(results);

  } catch (err) {
    console.error("[RideForge] 공유 파일 처리 실패:", err);
    showToast("공유 파일 처리 중 오류가 발생했습니다.", "error");
  }
}

function notifySharedResult({ success, duplicate, error }) {
  if (success > 0)   showToast(`${success}개 세션 저장 완료`, "success");
  if (duplicate > 0) showToast(`${duplicate}개 중복 — 건너뜀`, "warning");
  if (error > 0)     showToast(`${error}개 파일 처리 실패`, "error");
}

// ── 보완 병합 ─────────────────────────────────────────────────────────────────

/**
 * 기존 세션 목록 중 현재 파일로 보완 가능한 세션 반환
 * - wahoo_only 세션 + HR 파일(단독 zepp, 또는 hrMeta)
 * - zepp_only 세션  + GPS 파일(wahoo)
 */
function findComplementTarget(existingSessions, gpsMeta, hrMeta) {
  for (const s of existingSessions) {
    if (s.source === "merged") continue;
    if (s.source === "wahoo_only" && (hrMeta?.hasHR || gpsMeta.role === "hr")) return s;
    if (s.source === "zepp_only"  && gpsMeta.hasGps) return s;
  }
  return null;
}

/**
 * 기존 세션을 새 파일 데이터로 보완 병합 후 DB 업데이트
 *
 * @param {object} existing      보완 대상 기존 세션
 * @param {object} gpsMeta       현재 import의 gpsMeta (단독이면 zepp일 수도 있음)
 * @param {object|null} hrMeta   현재 import의 hrMeta
 * @param {string} gpsFileHash   gpsMeta 파일 해시 (미리 계산됨)
 * @param {object} g             group 객체 (상태 플래그 설정용)
 */
async function supplementSession(existing, gpsMeta, hrMeta, gpsFileHash, g) {
  const existingRecords = await getRecordsBySession(existing.id);

  let wahooRecords, zeppRecords, newFileHash;

  if (existing.source === "wahoo_only") {
    // 기존 Wahoo records + 새 Zepp(HR) records
    wahooRecords = existingRecords.map((r) => ({ ...r, src_wahoo: true,  src_zepp: false }));
    const hrSource = hrMeta ?? gpsMeta; // hrMeta가 있으면 hrMeta, 단독 zepp이면 gpsMeta
    zeppRecords  = hrSource.records.map((r) => ({ ...r, src_wahoo: false, src_zepp: true }));
    newFileHash  = existing.file_hash; // GPS(Wahoo) 해시 유지

  } else if (existing.source === "zepp_only") {
    // 새 Wahoo(GPS) records + 기존 Zepp records
    wahooRecords = gpsMeta.records.map((r) => ({ ...r, src_wahoo: true,  src_zepp: false }));
    zeppRecords  = existingRecords.map((r) => ({ ...r, src_wahoo: false, src_zepp: true }));
    newFileHash  = gpsFileHash; // 새 GPS(Wahoo) 해시로 교체

  } else {
    return; // 보완 불가
  }

  const calories = existing.calories ?? gpsMeta.calories ?? hrMeta?.calories ?? null;
  const { session: rawSummary, records: rawRecords } = merge(wahooRecords, zeppRecords, calories);

  // 코칭 필드 재계산 + 노이즈 필터
  const profile = await getProfile();
  const maxHR   = (profile?.max_hr_observed ?? 0) > 0
    ? profile.max_hr_observed
    : calcMaxHR(profile?.age ?? 30);
  const zones   = getHRZones(maxHR);

  const mergedRecords = filterRecordsHR(rawRecords, maxHR);
  const filteredHRs   = mergedRecords.map((r) => r.heart_rate).filter((v) => v != null);
  const filteredMaxHR = filteredHRs.length ? Math.max(...filteredHRs) : null;
  const filteredAvgHR = filteredHRs.length
    ? Math.round(filteredHRs.reduce((a, b) => a + b, 0) / filteredHRs.length)
    : null;

  const session = {
    ...existing,
    source: "merged",
    file_hash: newFileHash,
    ...rawSummary,
    avg_hr:          filteredAvgHR ?? rawSummary.avg_hr,
    max_hr:          filteredMaxHR ?? rawSummary.max_hr,
    max_hr_observed: filteredMaxHR ?? rawSummary.max_hr_observed,
  };

  const records = mergedRecords.map((r) => ({
    id:         crypto.randomUUID(),
    session_id: existing.id,
    ...pickFields(r),
  }));

  const hrZoneDist = calcHRZoneDist(mergedRecords, zones);
  const cadValues  = mergedRecords.map((r) => r.cadence).filter((v) => v != null && v > 0);
  const cadMean    = cadValues.length ? cadValues.reduce((a, b) => a + b, 0) / cadValues.length : 0;
  const cadStddev  = cadValues.length
    ? Math.round(Math.sqrt(cadValues.reduce((a, v) => a + (v - cadMean) ** 2, 0) / cadValues.length) * 10) / 10
    : 0;
  const trainingLoad    = calcTrainingLoad(session.duration, hrZoneDist);
  const sessionWithStats = { ...session, hr_zone_dist: hrZoneDist, cadence_stddev: cadStddev };
  const sessionType     = classifySession(sessionWithStats, zones);

  Object.assign(session, {
    hr_zone_dist:   hrZoneDist,
    cadence_stddev: cadStddev,
    training_load:  trainingLoad,
    session_type:   sessionType,
  });

  await updateSession(session, records);

  // 실측 max_hr 갱신
  if (session.max_hr_observed) {
    const latestProfile = await getProfile();
    if (latestProfile && session.max_hr_observed > (latestProfile.max_hr_observed ?? 0)) {
      await saveProfile({ ...latestProfile, max_hr_observed: session.max_hr_observed });
    }
  }

  // Fitness 캐시 갱신
  const allSessions = await getAllSessionsAsc();
  const fitness     = calcFitness(allSessions);
  await saveFitnessCache({ atl: fitness.atl, ctl: fitness.ctl, tsb: fitness.tsb });

  g._supplemented = true;
  g._saved        = true;
}
