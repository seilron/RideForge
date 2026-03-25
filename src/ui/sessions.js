import { getAllSessions, deleteSession } from "../db/index.js";
import { navigate } from "./router.js";

/**
 * 세션 목록 화면 렌더링
 */
export async function renderSessionList(container) {
  const sessions = await getAllSessions();

  container.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">라이딩 기록</h2>
      <button class="btn-primary" id="goto-import">+ Import</button>
    </div>
  `;

  document.getElementById("goto-import")
    .addEventListener("click", () => navigate("/"));

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
