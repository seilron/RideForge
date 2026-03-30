import { getAllSessions, deleteSession, exportAllData, importData } from "../db/index.js";
import { navigate } from "./router.js";

/**
 * 세션 목록 화면 렌더링
 */
export async function renderSessionList(container) {
  const sessions = await getAllSessions();

  container.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">라이딩 기록</h2>
      <div class="page-header-actions">
        <button class="btn-secondary" id="btn-export" title="전체 데이터 내보내기">내보내기</button>
        <button class="btn-secondary" id="btn-import-backup" title="백업 파일 가져오기">가져오기</button>
        <button class="btn-primary" id="goto-import">+ Import</button>
      </div>
    </div>
  `;

  document.getElementById("goto-import")
    .addEventListener("click", () => navigate("/"));

  document.getElementById("btn-export").addEventListener("click", async () => {
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rideforge-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("btn-import-backup").addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const { imported, skipped } = await importData(data);
        alert(`가져오기 완료\n추가: ${imported}개 세션\n중복 건너뜀: ${skipped}개`);
        if (imported > 0) renderSessionList(container);
      } catch {
        alert("올바른 RideForge 백업 파일이 아닙니다.");
      }
    };
    input.click();
  });

  if (sessions.length === 0) {
    container.insertAdjacentHTML("beforeend", `
      <div class="empty-state">
        <p>아직 저장된 세션이 없습니다.</p>
        <p>FIT 파일을 Import 해보세요.</p>
      </div>
    `);
    return;
  }

  const list = document.createElement("div");
  list.className = "session-list";

  for (const s of sessions) {
    const card = makeSessionCard(s);
    list.appendChild(card);
  }

  container.appendChild(list);
}

function makeSessionCard(s) {
  const card = document.createElement("div");
  card.className = "session-card";
  card.innerHTML = `
    <div class="session-card-main" data-id="${s.id}">
      <div class="session-date">${formatDate(s.date)}</div>
      <div class="session-stats">
        <span class="stat"><strong>${s.distance?.toFixed(1) ?? "—"}</strong> km</span>
        <span class="stat"><strong>${formatDuration(s.duration)}</strong></span>
        <span class="stat"><strong>${s.avg_speed?.toFixed(1) ?? "—"}</strong> km/h</span>
        ${s.avg_hr ? `<span class="stat"><strong>${Math.round(s.avg_hr)}</strong> bpm</span>` : ""}
      </div>
      <div class="session-source">${sourceLabel(s.source)}</div>
    </div>
    <button class="btn-delete" data-id="${s.id}" title="삭제">✕</button>
  `;

  card.querySelector(".session-card-main")
    .addEventListener("click", () => navigate(`/session/${s.id}`));

  card.querySelector(".btn-delete")
    .addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("이 세션을 삭제하시겠습니까?")) return;
      await deleteSession(s.id);
      card.remove();
    });

  return card;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric",
    weekday: "short", hour: "2-digit", minute: "2-digit",
  });
}

function formatDuration(sec) {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function sourceLabel(source) {
  return { merged: "Wahoo + ZEPP", wahoo_only: "Wahoo", zepp_only: "ZEPP" }[source] ?? source;
}
