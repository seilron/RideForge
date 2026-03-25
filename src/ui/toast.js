let container;

function getContainer() {
  if (!container) container = document.getElementById("toast-container");
  return container;
}

/**
 * 토스트 알림 표시
 * @param {string} message
 * @param {"success"|"warning"|"error"|"info"} type
 * @param {number} duration  자동 닫힘 ms (기본 4000)
 */
export function showToast(message, type = "info", duration = 4000) {
  const c = getContainer();
  if (!c) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  c.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("toast-visible"));

  setTimeout(() => {
    toast.classList.remove("toast-visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, duration);
}
