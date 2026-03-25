import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

// vite-plugin-pwa 빌드 시 자동 주입
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ─────────────────────────────────────────────────────────────────────────────
// Share Target POST 수신 처리
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname === "/share-handler" && event.request.method === "POST") {
    event.respondWith(handleSharedFiles(event.request));
  }
});

async function handleSharedFiles(request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files");

    if (!files || files.length === 0) {
      return Response.redirect("/?share_error=no_files", 303);
    }

    const cache = await caches.open("rideforge-pending-fits");

    const fileDataList = [];
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(".fit")) continue;

      const buffer = await file.arrayBuffer();
      fileDataList.push({
        name: file.name,
        size: file.size,
        data: Array.from(new Uint8Array(buffer)),
      });
    }

    if (fileDataList.length === 0) {
      return Response.redirect("/?share_error=no_fit_files", 303);
    }

    await cache.put(
      "/pending-fits",
      new Response(JSON.stringify(fileDataList), {
        headers: { "Content-Type": "application/json" },
      })
    );

    return Response.redirect("/?shared=true", 303);

  } catch (err) {
    console.error("[SW] Share Target 처리 실패:", err);
    return Response.redirect("/?share_error=failed", 303);
  }
}
