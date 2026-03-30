import Chart from "chart.js/auto";
import { getRecordsBySession, getAllSessions } from "../db/index.js";
import { getProfile } from "../db/index.js";
import { calcMaxHR, getHRZones } from "../utils/hr.js";
import { navigate } from "./router.js";

const KAKAO_KEY = import.meta.env.VITE_KAKAO_MAP_KEY;

/**
 * 세션 상세 화면 렌더링
 */
export async function renderSessionDetail(container, sessionId) {
  // 세션 메타 조회
  const sessions = await getAllSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    container.innerHTML = `<p style="padding:32px">세션을 찾을 수 없습니다.</p>`;
    return;
  }

  const records = await getRecordsBySession(sessionId);
  records.sort((a, b) => a.elapsed_time - b.elapsed_time);

  const profile = await getProfile();
  const maxHR = profile?.max_hr_observed ?? (profile?.age ? calcMaxHR(profile.age) : null);
  const zones = maxHR ? getHRZones(maxHR) : null;

  // 다운샘플 (차트용 — 10초 간격)
  const sampled = downsample(records, 10);

  container.innerHTML = buildDetailHTML(session, sampled, zones, maxHR);

  document.getElementById("back-btn")
    .addEventListener("click", () => navigate("/sessions"));

  // GPS 좌표 추출 (속도 포함)
  const gpsRecords = records
    .filter((r) => r.lat != null && r.lng != null)
    .map((r) => ({ lat: r.lat, lng: r.lng, speed: r.speed ?? 0 }));

  // 지도
  console.log(`[RideForge] GPS 포인트 수: ${gpsRecords.length}`);
  if (gpsRecords.length > 0) {
    loadKakaoMap(gpsRecords);
  } else {
    console.warn("[RideForge] GPS 데이터 없음 → 지도 숨김");
    document.getElementById("map-section").style.display = "none";
  }

  // 차트
  renderCharts(sampled, zones);

  // 심박존 바
  if (zones) renderZoneBars(records, zones);
}

// ── HTML 템플릿 ──────────────────────────────────────────────────────────────

function buildDetailHTML(session, sampled, zones, maxHR) {
  const hasHR  = sampled.some((r) => r.heart_rate != null);
  const hasCad = sampled.some((r) => r.cadence != null);

  return `
    <div class="detail-header">
      <button id="back-btn" class="btn-back">← 목록</button>
      <div class="detail-date">${formatDate(session.date)}</div>
      <div class="session-source-badge">${sourceLabel(session.source)}</div>
    </div>

    <!-- 요약 스탯 -->
    <div class="stat-grid">
      ${statCard("거리",    session.distance?.toFixed(2), "km",   "#4fc3f7")}
      ${statCard("시간",    formatDuration(session.duration), "",  "#f5a623")}
      ${statCard("평균 속도", session.avg_speed?.toFixed(1), "km/h", "#66bb6a")}
      ${statCard("최고 속도", session.max_speed?.toFixed(1), "km/h", "#66bb6a", `평균 ${session.avg_speed?.toFixed(1)}`)}
      ${hasHR  ? statCard("심박",    Math.round(session.avg_hr),   "bpm", "#ef5350", `최고 ${session.max_hr}`) : ""}
      ${hasCad ? statCard("케이던스", Math.round(session.avg_cadence), "rpm", "#ab47bc") : ""}
      ${session.calories ? statCard("칼로리", session.calories, "kcal", "#ff6b35") : ""}
    </div>

    <!-- 지도 -->
    <div class="section" id="map-section">
      <div class="section-title">경로 <span class="badge">GPS · Wahoo</span></div>
      <div class="map-clip"><div id="kakao-map"></div></div>
      <div class="speed-legend">
        <span class="speed-legend-label">느림</span>
        <div class="speed-legend-bar"></div>
        <span class="speed-legend-label">빠름</span>
      </div>
    </div>

    <!-- 속도 차트 -->
    <div class="section">
      <div class="section-title">속도 <span class="badge">Wahoo</span></div>
      <div class="chart-wrap"><canvas id="chart-speed"></canvas></div>
    </div>

    <!-- 심박 차트 -->
    ${hasHR ? `
    <div class="section">
      <div class="section-title">심박수 <span class="badge">ZEPP</span>
        ${maxHR ? `<span class="badge" style="margin-left:4px">MAX ${maxHR} bpm</span>` : ""}
      </div>
      <div class="chart-wrap"><canvas id="chart-hr"></canvas></div>
      ${zones ? `<div class="zone-bars" id="zone-bars"></div>` : ""}
    </div>` : ""}

    <!-- 케이던스 차트 -->
    ${hasCad ? `
    <div class="section">
      <div class="section-title">케이던스 <span class="badge">Wahoo</span></div>
      <div class="chart-wrap"><canvas id="chart-cad"></canvas></div>
    </div>` : ""}
  `;
}

function statCard(label, value, unit, color, sub = "") {
  return `
    <div class="stat-card" style="--card-color:${color}">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value ?? "—"}<span class="stat-unit">${unit}</span></div>
      ${sub ? `<div class="stat-sub">${sub}</div>` : ""}
    </div>`;
}

// ── 카카오 지도 ──────────────────────────────────────────────────────────────

function loadKakaoMap(gpsRecords) {
  if (!KAKAO_KEY) {
    console.error("[RideForge] VITE_KAKAO_MAP_KEY 환경변수가 없습니다.");
    return;
  }

  if (typeof window.kakao?.maps?.Map === "function") {
    waitForSizeAndDraw(gpsRecords);
    return;
  }

  const script = document.createElement("script");
  script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false`;
  script.onload = () => {
    window.kakao.maps.load(() => waitForSizeAndDraw(gpsRecords));
  };
  script.onerror = () => {
    console.error("[RideForge] 카카오 지도 SDK 로드 실패 — 키/도메인 설정 확인");
  };
  document.head.appendChild(script);
}

/**
 * ResizeObserver로 컨테이너가 실제로 height > 0이 된 뒤 지도 생성
 * SPA에서 innerHTML 직후 layout이 미확정일 때의 race condition 방지
 */
function waitForSizeAndDraw(gpsRecords) {
  const container = document.getElementById("kakao-map");
  if (!container) return;

  if (container.offsetHeight > 0) {
    drawKakaoMap(container, gpsRecords);
    return;
  }

  const ro = new ResizeObserver((entries) => {
    const h = entries[0]?.contentRect?.height ?? 0;
    console.log(`[RideForge] kakao-map 컨테이너 height: ${h}px`);
    if (h > 0) {
      ro.disconnect();
      drawKakaoMap(container, gpsRecords);
    }
  });
  ro.observe(container);
}

function drawKakaoMap(container, gpsRecords) {
  console.log(`[RideForge] drawKakaoMap 시작 — container: ${container.offsetWidth}×${container.offsetHeight}px, points: ${gpsRecords.length}`);

  // 세그먼트 수 제한 (성능) — 최대 300개로 다운샘플
  const MAX_SEGMENTS = 300;
  const step = gpsRecords.length > MAX_SEGMENTS
    ? Math.ceil(gpsRecords.length / MAX_SEGMENTS)
    : 1;
  const sampled = gpsRecords.filter((_, i) => i % step === 0 || i === gpsRecords.length - 1);

  const center = sampled[Math.floor(sampled.length / 2)];
  const map = new window.kakao.maps.Map(container, {
    center: new window.kakao.maps.LatLng(center.lat, center.lng),
    level: 5,
  });

  console.log("[RideForge] kakao.maps.Map 생성 완료");

  // 속도 범위 계산
  const speeds = sampled.map((r) => r.speed);
  const minSpeed = Math.min(...speeds);
  const maxSpeed = Math.max(...speeds);
  console.log(`[RideForge] 속도 범위: min=${minSpeed} max=${maxSpeed} 샘플=`, speeds.slice(0, 5));

  // 구간별 속도 색상 폴리라인
  const latLngs = sampled.map((r) => new window.kakao.maps.LatLng(r.lat, r.lng));
  for (let i = 0; i < sampled.length - 1; i++) {
    new window.kakao.maps.Polyline({
      map,
      path: [latLngs[i], latLngs[i + 1]],
      strokeWeight: 4,
      strokeColor: speedToColor(sampled[i].speed, minSpeed, maxSpeed),
      strokeOpacity: 0.9,
      strokeStyle: "solid",
    });
  }

  // 시작 / 도착 마커
  new window.kakao.maps.Marker({ map, position: latLngs[0],                  title: "출발" });
  new window.kakao.maps.Marker({ map, position: latLngs[latLngs.length - 1], title: "도착" });

  // bounds
  const bounds = latLngs.reduce(
    (b, latlng) => b.extend(latlng),
    new window.kakao.maps.LatLngBounds()
  );
  map.relayout();
  map.setBounds(bounds, 40);

  console.log("[RideForge] relayout + setBounds 완료");
}

/**
 * 속도값 → 색상 보간 (파랑 → 초록 → 주황 → 빨강)
 */
function speedToColor(speed, minSpeed, maxSpeed) {
  const t = maxSpeed > minSpeed
    ? Math.max(0, Math.min(1, (speed - minSpeed) / (maxSpeed - minSpeed)))
    : 0;

  // 색상 정류장: 파랑 → 초록 → 주황 → 빨강
  const stops = [
    [79,  195, 247],  // #4fc3f7
    [102, 187, 106],  // #66bb6a
    [245, 166,  35],  // #f5a623
    [239,  83,  80],  // #ef5350
  ];

  const pos     = t * (stops.length - 1);
  const idx     = Math.min(Math.floor(pos), stops.length - 2);
  const frac    = pos - idx;
  const [r0, g0, b0] = stops[idx];
  const [r1, g1, b1] = stops[idx + 1];

  const r = Math.round(r0 + (r1 - r0) * frac);
  const g = Math.round(g0 + (g1 - g0) * frac);
  const b = Math.round(b0 + (b1 - b0) * frac);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ── Chart.js ─────────────────────────────────────────────────────────────────

function renderCharts(sampled, zones) {
  const labels = sampled.map((r) => formatElapsed(r.elapsed_time));

  const chartOpts = (yLabel, color, yMax) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false } },
    scales: {
      x: {
        ticks: { color: "#6b7591", maxTicksLimit: 8, font: { size: 11 } },
        grid: { color: "#1e2330" },
      },
      y: {
        ticks: { color: "#6b7591", font: { size: 11 } },
        grid: { color: "#1e2330" },
        title: { display: true, text: yLabel, color: "#6b7591", font: { size: 11 } },
        ...(yMax ? { max: yMax } : {}),
      },
    },
  });

  // 속도
  new Chart(document.getElementById("chart-speed"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: sampled.map((r) => r.speed),
        borderColor: "#66bb6a",
        backgroundColor: "rgba(102,187,106,0.08)",
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        tension: 0.3,
      }],
    },
    options: chartOpts("km/h", "#66bb6a"),
  });

  // 심박
  const hrCanvas = document.getElementById("chart-hr");
  if (hrCanvas) {
    const hrData = sampled.map((r) => r.heart_rate);

    // 심박존 배경 플러그인
    const zoneBgPlugin = zones ? makeZoneBgPlugin(zones) : null;

    new Chart(hrCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
          data: hrData,
          borderColor: "#ef5350",
          backgroundColor: "rgba(239,83,80,0.08)",
          borderWidth: 1.5,
          pointRadius: 0,
          fill: true,
          tension: 0.3,
        }],
      },
      options: {
        ...chartOpts("bpm", "#ef5350"),
        plugins: {
          ...(chartOpts("bpm", "#ef5350").plugins),
          ...(zoneBgPlugin ? { zoneBg: zoneBgPlugin } : {}),
        },
      },
      ...(zoneBgPlugin ? { plugins: [zoneBgPlugin] } : {}),
    });
  }

  // 케이던스
  const cadCanvas = document.getElementById("chart-cad");
  if (cadCanvas) {
    new Chart(cadCanvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          data: sampled.map((r) => r.cadence),
          backgroundColor: "rgba(171,71,188,0.7)",
          borderWidth: 0,
        }],
      },
      options: {
        ...chartOpts("rpm", "#ab47bc"),
        barPercentage: 1.0,
        categoryPercentage: 1.0,
      },
    });
  }
}

// 심박존 배경 플러그인 (Chart.js custom plugin)
function makeZoneBgPlugin(zones) {
  return {
    id: "zoneBg",
    beforeDraw(chart) {
      const { ctx, chartArea: { top, bottom, left, right }, scales: { y } } = chart;
      if (!y) return;
      ctx.save();
      for (const z of zones) {
        const yTop = y.getPixelForValue(Math.min(z.max, y.max));
        const yBot = y.getPixelForValue(Math.max(z.min, y.min));
        ctx.fillStyle = z.color + "18"; // 10% 투명도
        ctx.fillRect(left, yTop, right - left, yBot - yTop);
      }
      ctx.restore();
    },
  };
}

// ── 심박존 바 ─────────────────────────────────────────────────────────────────

function renderZoneBars(records, zones) {
  const container = document.getElementById("zone-bars");
  if (!container) return;

  const counts = new Array(zones.length).fill(0);
  for (const r of records) {
    if (r.heart_rate == null) continue;
    for (let i = zones.length - 1; i >= 0; i--) {
      if (r.heart_rate >= zones[i].min) { counts[i]++; break; }
    }
  }
  const total = counts.reduce((a, b) => a + b, 0);
  const maxCount = Math.max(...counts);

  container.innerHTML = zones.map((z, i) => {
    const pct = total > 0 ? Math.round(counts[i] / total * 100) : 0;
    const barH = total > 0 ? Math.round(counts[i] / maxCount * 60) + 4 : 4;
    return `
      <div class="zone-bar-wrap">
        <div class="zone-bar-pct">${pct}%</div>
        <div class="zone-bar" style="height:${barH}px;background:${z.color}"></div>
        <div class="zone-bar-label">${z.label}</div>
        <div class="zone-bar-range">${z.min}–${z.max}</div>
      </div>`;
  }).join("");
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function downsample(records, intervalSec) {
  const result = [];
  let lastTs = -Infinity;
  for (const r of records) {
    if (r.elapsed_time - lastTs >= intervalSec) {
      result.push(r);
      lastTs = r.elapsed_time;
    }
  }
  return result;
}

function formatElapsed(sec) {
  if (sec == null) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatDuration(sec) {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
}

function sourceLabel(source) {
  return { merged: "Wahoo + ZEPP", wahoo_only: "Wahoo", zepp_only: "ZEPP" }[source] ?? source;
}
