import { getProfile, saveProfile } from "../db/index.js";
import { calcMaxHR } from "../utils/hr.js";

/**
 * 프로필 카드 초기화
 * - 저장된 프로필이 있으면 입력값 채우고 요약 표시
 * - 저장 버튼 클릭 시 IndexedDB에 저장
 */
export async function initProfileUI() {
  const nameInput   = document.getElementById("profile-name");
  const ageInput    = document.getElementById("profile-age");
  const saveBtn     = document.getElementById("profile-save-btn");
  const profileInfo = document.getElementById("profile-info");

  // 저장된 프로필 불러오기
  const existing = await getProfile();
  if (existing) {
    nameInput.value = existing.name ?? "";
    ageInput.value  = existing.age ?? "";
    renderProfileInfo(profileInfo, existing);
  }

  saveBtn.addEventListener("click", async () => {
    const age  = parseInt(ageInput.value, 10);
    const name = nameInput.value.trim();

    if (!age || age < 10 || age > 100) {
      profileInfo.textContent = "나이를 올바르게 입력해주세요 (10~100).";
      profileInfo.style.color = "var(--danger, #dc3545)";
      return;
    }

    const profile = { name, age, updatedAt: new Date().toISOString() };
    await saveProfile(profile);
    renderProfileInfo(profileInfo, profile);
  });
}

function renderProfileInfo(el, profile) {
  const maxHR = calcMaxHR(profile.age);
  el.style.color = "";
  el.innerHTML =
    `저장됨 · ${profile.name || "이름 없음"} · ${profile.age}세` +
    `<br><span style="font-size:0.75rem;color:var(--muted)">` +
    `최대 심박 (Tanaka): <strong>${maxHR} bpm</strong></span>`;
}
