/**
 * 단순 해시 기반 라우터
 * #/          → Import 화면
 * #/sessions  → 세션 목록
 * #/session/:id → 세션 상세
 */

const routes = {};

export function on(pattern, handler) {
  routes[pattern] = handler;
}

export function navigate(hash) {
  window.location.hash = hash;
}

export function initRouter() {
  window.addEventListener("hashchange", resolve);
  resolve();
}

function resolve() {
  const hash = window.location.hash.replace("#", "") || "/";

  // 정확한 경로 매칭
  if (routes[hash]) {
    routes[hash]({});
    return;
  }

  // 파라미터 경로 매칭 (/session/:id)
  for (const [pattern, handler] of Object.entries(routes)) {
    const regex = new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$");
    const match = hash.match(regex);
    if (match) {
      handler(match.groups ?? {});
      return;
    }
  }

  // fallback → 홈
  routes["/"]?.({});
}
