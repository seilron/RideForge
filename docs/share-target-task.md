# RideForge — Share Target 구현 작업지시서 (v3 Final)

> **목표**: Android 파일탐색기 / Windows 탐색기에서 .fit 파일을 다중 선택 후  
> RideForge PWA로 공유하면, 자동으로 FIT 파싱 → IndexedDB 저장까지 처리한다.

---

## 현재 코드 상태 (GitHub 확인 완료)

| 파일 | 현황 |
|------|------|
| `package.json` | `workbox-precaching` 없음 → 설치 필요 |
| `vite.config.js` | `generateSW` 방식, `share_target` 없음 |
| `src/ui/import.js` | `saveGroup(g)` 이 FIT 파싱 + 중복체크 + DB저장 전담 |
| `src/main.js` | 해시 라우터, `/` 진입 시 `initImportUI()` 호출 |
| `src/sw.js` | 없음 (vite-plugin-pwa 자동 생성 방식) |

---

## 작업 파일 목록

```
패키지  workbox-precaching 설치
수정    vite.config.js
신규    src/sw.js
수정    src/ui/import.js
수정    src/main.js
```

---

## Step 0 — 패키지 설치

`injectManifest` 방식은 `workbox-precaching`을 직접 import하므로 설치가 필요하다.  
**devDependencies**에 설치한다.

```bash
npm install -D workbox-precaching
```

---

## Step 1 — vite.config.js 수정

### 변경 이유
기본 `generateSW` 방식은 Service Worker 코드를 직접 작성할 수 없다.  
Share Target POST 요청을 가로채려면 **`injectManifest`** 방식으로 전환해야 한다.

### 전체 교체

```js
// vite.config.js
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      // ✅ generateSW → injectManifest 전환
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",

      // ✅ injectManifest 방식 필수: precache 대상 glob 패턴 지정
      // js, css, html 누락 시 빌드 오류 발생
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"]
      },

      manifest: {
        name: "RideForge",
        short_name: "RideForge",
        theme_color: "#1A56DB",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        icons: [],

        // ✅ Share Target 선언 (Android Chrome + Windows Edge 공통)
        share_target: {
          action: "/share-handler",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            files: [
              {
                name: "files",
                accept: [".fit", "application/octet-stream"]
              }
            ]
          }
        }
      }
    })
  ]
});
```

---

## Step 2 — src/sw.js 신규 생성

vite-plugin-pwa가 빌드 시 `self.__WB_MANIFEST`에 precache 목록을 자동 주입한다.

### src/sw.js 전체 코드

```js
// src/sw.js
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

// vite-plugin-pwa 빌드 시 자동 주입
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ─────────────────────────────────────────────────────
// Share Target POST 수신 처리
// ─────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname === "/share-handler" && event.request.method === "POST") {
    event.respondWith(handleSharedFiles(event.request));
  }
});

async function handleSharedFiles(request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files"); // 다중 파일 배열

    if (!files || files.length === 0) {
      return Response.redirect("/?share_error=no_files", 303);
    }

    // Service Worker → 메인 스레드 직접 전달 불가
    // → Cache Storage 경유로 임시 저장 후 앱에서 꺼내씀
    const cache = await caches.open("rideforge-pending-fits");

    const fileDataList = [];
    for (const file of files) {
      // .fit 파일만 필터링
      if (!file.name.toLowerCase().endsWith(".fit")) continue;

      const buffer = await file.arrayBuffer();
      fileDataList.push({
        name: file.name,
        size: file.size,
        // Uint8Array → 일반 배열로 직렬화 (JSON 저장용)
        data: Array.from(new Uint8Array(buffer))
      });
    }

    if (fileDataList.length === 0) {
      return Response.redirect("/?share_error=no_fit_files", 303);
    }

    await cache.put(
      "/pending-fits",
      new Response(JSON.stringify(fileDataList), {
        headers: { "Content-Type": "application/json" }
      })
    );

    // /?shared=true 로 리다이렉트 → 앱에서 감지해서 처리
    return Response.redirect("/?shared=true", 303);

  } catch (err) {
    console.error("[SW] Share Target 처리 실패:", err);
    return Response.redirect("/?share_error=failed", 303);
  }
}
```

---

## Step 3 — src/ui/import.js 수정

### 변경 1: saveGroup() export 추가

```js
// 기존 (변경 전)
async function saveGroup(g) {

// 변경 후
export async function saveGroup(g) {
```

### 변경 2: 파일 하단에 신규 함수 추가

```js
// src/ui/import.js 하단에 추가

/**
 * Share Target으로 수신된 FIT 파일 일괄 처리
 * URL 파라미터 ?shared=true 감지 시 호출
 */
export async function processPendingSharedFits() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("shared")) return;

  // URL 파라미터 즉시 제거 (새로고침 시 재처리 방지)
  // 해시 라우터이므로 hash 보존, search만 제거
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

    // 처리 전 즉시 삭제 (재처리 방지)
    await cache.delete("/pending-fits");

    console.log(`[RideForge] 공유 FIT 파일 ${fileDataList.length}개 처리 시작`);

    const results = { success: 0, duplicate: 0, error: 0 };

    for (const { name, data } of fileDataList) {
      try {
        // Uint8Array 복원
        const buffer = new Uint8Array(data).buffer;

        // 기존 detectFit + saveGroup 파이프라인 그대로 재사용
        const meta = await detectFit(buffer, name);
        if (!meta) {
          console.warn(`[RideForge] ${name} — FIT 파싱 실패, 건너뜀`);
          results.error++;
          continue;
        }

        meta._buffer = buffer;

        // saveGroup()이 중복 체크 + DB 저장까지 처리
        const group = { metas: [meta], overlapRatio: null };
        await saveGroup(group);

        if (group._duplicate) {
          results.duplicate++;
        } else if (group._saved) {
          results.success++;
        }

      } catch (err) {
        console.error(`[RideForge] ${name} 저장 실패:`, err);
        results.error++;
      }
    }

    notifySharedResult(results);

  } catch (err) {
    console.error("[RideForge] 공유 파일 처리 실패:", err);
  }
}

function notifySharedResult({ success, duplicate, error }) {
  const parts = [
    success   > 0 && `${success}개 저장 완료`,
    duplicate > 0 && `${duplicate}개 중복 건너뜀`,
    error     > 0 && `${error}개 오류`,
  ].filter(Boolean);

  const msg = parts.join(", ");
  console.log(`[RideForge] 공유 처리 결과: ${msg}`);

  // TODO: toast/알림 UI가 생기면 console.log 대신 교체
}
```

---

## Step 4 — src/main.js 수정

### 변경 내용

```js
// 기존
import { initImportUI } from "./ui/import.js";

// 변경 후
import { initImportUI, processPendingSharedFits } from "./ui/import.js";
```

```js
// initRouter() 직후에 추가
initRouter();
updateNav();

// ✅ Share Target 수신 처리 (앱 시작 시 1회)
processPendingSharedFits();
```

---

## 전체 데이터 흐름

```
[Android] 파일탐색기 → .fit 다중선택 → 공유 → RideForge
[Windows] 탐색기 → .fit 다중선택 → 우클릭 → 공유 → RideForge (Edge 전용)
                    ↓
       SW: /share-handler POST 수신
       formData.getAll("files") → .fit 파일만 필터링
       ArrayBuffer → Uint8Array → JSON 직렬화
                    ↓
       Cache Storage "rideforge-pending-fits" / "/pending-fits" 임시 저장
                    ↓
       Response.redirect("/?shared=true", 303)
                    ↓
       앱 로드 → main.js → processPendingSharedFits() 실행
                    ↓
       Cache에서 꺼냄 → Uint8Array 복원 → detectFit(buffer, name)
                    ↓
       saveGroup(group) ← SHA-256 중복체크 + IndexedDB 저장 (기존 로직 그대로)
                    ↓
       notifySharedResult() — 성공/중복/오류 건수 출력
```

---

## 플랫폼별 조건

| 항목 | Android (Chrome) | Windows (Edge) |
|------|-----------------|----------------|
| 지원 여부 | ✅ | ✅ |
| 필수 조건 | PWA 설치 | PWA 설치 + **Edge** 브라우저 |
| 공유 진입 | 파일탐색기 → 공유 버튼 | 탐색기 → 우클릭 → 공유 |
| Windows Chrome | - | ❌ Windows Share Sheet 미연동 |
| 로컬 개발 테스트 | ❌ HTTPS 필요 | ❌ HTTPS 필요 |

---

## 로컬 테스트 방법

Share Target은 **HTTPS + PWA 설치** 후에만 동작한다. `npm run dev` 로는 불가.

```bash
# 터미널 1
npm run build && npm run preview

# 터미널 2 (ngrok 설치 필요)
ngrok http 4173
# 생성된 https://xxxx.ngrok.io 로 모바일 접속 → PWA 설치 → 파일 공유 테스트
```

---

## 최종 체크리스트

- [ ] `npm install -D workbox-precaching` — devDependencies에 설치
- [ ] `vite.config.js` — `injectManifest` 전환 + `injectManifest.globPatterns` + `share_target` 추가
- [ ] `src/sw.js` — 신규 생성
- [ ] `src/ui/import.js` — `saveGroup()` 에 `export` 추가
- [ ] `src/ui/import.js` — `processPendingSharedFits()` + `notifySharedResult()` 하단 추가
- [ ] `src/main.js` — `processPendingSharedFits` import 추가
- [ ] `src/main.js` — `initRouter()` 직후 `processPendingSharedFits()` 호출
- [ ] `npm run build` 빌드 오류 없음 확인
- [ ] HTTPS 환경에서 PWA 설치 후 공유 동작 테스트
