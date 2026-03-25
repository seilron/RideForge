import { initImportUI } from "./ui/import.js";
import { initProfileUI } from "./ui/profile.js";
import { renderSessionList } from "./ui/sessions.js";
import { renderSessionDetail } from "./ui/detail.js";
import { renderStats } from "./ui/stats.js";
import { on, initRouter, navigate } from "./ui/router.js";

const app = document.getElementById("app");

on("/", () => {
  app.innerHTML = `
    <div id="import-page" class="page">
      <div class="page-header">
        <h2 class="page-title">Import</h2>
        <button class="btn-link" id="goto-sessions">기록 보기 →</button>
      </div>
    </div>
  `;
  document.getElementById("goto-sessions")
    .addEventListener("click", () => window.location.hash = "#/sessions");

  // 프로필 + import 카드를 import-page 안에 마운트
  const importPage = document.getElementById("import-page");
  importPage.insertAdjacentHTML("beforeend", document.getElementById("profile-card-tpl").innerHTML);
  importPage.insertAdjacentHTML("beforeend", document.getElementById("import-card-tpl").innerHTML);
  importPage.insertAdjacentHTML("beforeend", `<div id="result"></div><div id="debug"></div>`);

  initProfileUI();
  initImportUI();
});

on("/sessions", async () => {
  app.innerHTML = `<div class="page" id="sessions-page"></div>`;
  await renderSessionList(document.getElementById("sessions-page"));
});

on("/session/:id", async ({ id }) => {
  app.innerHTML = `<div class="page" id="detail-page"></div>`;
  await renderSessionDetail(document.getElementById("detail-page"), id);
});

on("/stats", async () => {
  app.innerHTML = `<div class="page" id="stats-page"></div>`;
  await renderStats(document.getElementById("stats-page"));
});

// 활성 네비게이션 링크 표시
function updateNav() {
  const hash = window.location.hash.replace("#", "") || "/";
  document.querySelectorAll(".nav-link").forEach((el) => {
    el.classList.toggle("active", el.dataset.path === hash || hash.startsWith(el.dataset.path + "/"));
  });
}
window.addEventListener("hashchange", updateNav);

initRouter();
updateNav();
