import { detectFit } from "../parser/detector.js";
import { groupSessions } from "../parser/grouper.js";
import { merge } from "../parser/merger.js";
import { hashBuffer, isDuplicate, saveSession, getProfile, saveProfile } from "../db/index.js";
import { navigate } from "./router.js";
import { showToast } from "./toast.js";

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
    ? `<span class="group-badge saved">저장됨</span>`
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
    g._duplicate = true;
    return;
  }

  // src 플래그 설정
  const wahooRecords = gpsMeta.records.map((r) => ({ ...r, src_wahoo: true,  src_zepp: false }));
  const zeppRecords  = hrMeta
    ? hrMeta.records.map((r) => ({ ...r, src_wahoo: false, src_zepp: true }))
    : null;
  const calories = gpsMeta.calories ?? hrMeta?.calories ?? null;

  const { session: summary, records: mergedRecords } = merge(wahooRecords, zeppRecords, calories);

  const sessionId = crypto.randomUUID();
  const session = {
    id:        sessionId,
    date:      new Date(gpsMeta.start).toISOString(),
    source:    zeppRecords ? "merged" : "wahoo_only",
    file_hash: fileHash,
    ...summary,
  };

  const records = mergedRecords.map((r) => ({
    id:         crypto.randomUUID(),
    session_id: sessionId,
    ...pickFields(r),
  }));

  await saveSession(session, records);

  // 실측 max_hr 갱신
  if (session.max_hr_observed) {
    const profile = await getProfile();
    if (profile) {
      const current = profile.max_hr_observed ?? 0;
      if (session.max_hr_observed > current) {
        await saveProfile({ ...profile, max_hr_observed: session.max_hr_observed });
      }
    }
  }

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
