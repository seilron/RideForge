import { getProfile, saveProfile } from "../db/index.js";
import { calcMaxHR, isValidHRmax } from "../utils/hr.js";

/**
 * 프로필 카드 초기화
 * - 저장된 프로필이 있으면 입력값 채우고 요약 표시
 * - 저장 버튼 클릭 시 IndexedDB에 저장
 */
export async function initProfileUI() {
  const nameInput   = document.getElementById("profile-name");
  const ageInput    = document.getElementById("profile-age");
  const maxhrInput  = document.getElementById("profile-maxhr");
  const saveBtn     = document.getElementById("profile-save-btn");
  const profileInfo = document.getElementById("profile-info");

  // 저장된 프로필 불러오기
  const existing = await getProfile();
  if (existing) {
    nameInput.value  = existing.name ?? "";
    ageInput.value   = existing.age  ?? "";
    if (existing.max_hr_observed) maxhrInput.value = existing.max_hr_observed;
    renderProfileInfo(profileInfo, existing);
  }

  // 나이 변경 시 placeholder 갱신
  ageInput.addEventListener("input", () => {
    const age = parseInt(ageInput.value, 10);
    maxhrInput.placeholder = age >= 10 && age <= 100
      ? `${calcMaxHR(age)} (Nes 공식 자동계산)`
      : "Nes 공식 자동계산";
  });
  // 초기 placeholder 설정
  if (existing?.age) maxhrInput.placeholder = `${calcMaxHR(existing.age)} (Nes 공식 자동계산)`;

  saveBtn.addEventListener("click", async () => {
    const age  = parseInt(ageInput.value, 10);
    const name = nameInput.value.trim();

    if (!age || age < 10 || age > 100) {
      profileInfo.textContent = "나이를 올바르게 입력해주세요 (10~100).";
      profileInfo.style.color = "var(--danger, #dc3545)";
      return;
    }

    const rawMaxHR = maxhrInput.value !== "" ? parseInt(maxhrInput.value, 10) : null;
    if (rawMaxHR !== null && !isValidHRmax(rawMaxHR)) {
      profileInfo.textContent = "HRmax는 100~220 범위로 입력해주세요.";
      profileInfo.style.color = "var(--danger, #dc3545)";
      return;
    }

    const profile = {
      name,
      age,
      max_hr_observed: rawMaxHR,   // null이면 공식 적용
      updatedAt: new Date().toISOString(),
    };
    await saveProfile(profile);
    renderProfileInfo(profileInfo, profile);
  });
}

function renderProfileInfo(el, profile) {
  const nesHR      = calcMaxHR(profile.age);
  const usedHR     = isValidHRmax(profile.max_hr_observed) ? profile.max_hr_observed : nesHR;
  const sourceLabel = isValidHRmax(profile.max_hr_observed)
    ? `<span style="color:var(--green);font-size:0.7rem">실측값 적용</span>`
    : `<span style="color:var(--muted);font-size:0.7rem">Nes 공식 (211 − 0.64 × 나이)</span>`;

  el.style.color = "";
  el.innerHTML =
    `저장됨 · ${profile.name || "이름 없음"} · ${profile.age}세` +
    `<br><span style="font-size:0.75rem;color:var(--muted)">` +
    `최대 심박: <strong>${usedHR} bpm</strong> ${sourceLabel}</span>`;
}
