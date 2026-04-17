import Chart from "chart.js/auto";
import { getAllSessions, getAllRecords, getProfile, getAllSessionsAsc,
         patchSession, saveFitnessCache } from "../db/index.js";
import { calcMaxHR, getHRZones } from "../utils/hr.js";
import { calcHRZoneDist, calcTrainingLoad, classifySession, calcFitness } from "../utils/load.js";

// ── 상태 ──────────────────────────────────────────────────────────────────────
let activeTab    = "monthly";
let viewMonth    = new Date();          // 월간 탭 현재 달
let viewWeekStart = getMonday(new Date()); // 주간 탭 현재 주 월요일
const charts = {};

// ── 진입점 ────────────────────────────────────────────────────────────────────
export async function renderStats(container) {
  const [sessions, allRecords, profile] = await Promise.all([
    getAllSessions(),
    getAllRecords(),
    getProfile(),
  ]);

  if (sessions.length === 0) {
    container.innerHTML = `
      <div class="page-header"><h2 class="page-title">누적 분석</h2></div>
      <div class="empty-state"><p>아직 저장된 세션이 없습니다.</p></div>`;
    return;
  }

  const maxHR    = profile?.max_hr_observed ?? (profile?.age ? calcMaxHR(profile.age) : null);
  const zones    = maxHR ? getHRZones(maxHR) : null;
  const summary  = calcAllTimeSummary(sessions);
  const zoneTimes = zones ? calcZoneTimes(allRecords, zones) : null;

  container.innerHTML = buildShell(summary, maxHR, profile, zones, zoneTimes);

  // 현재 HR존 기준으로 재계산
  container.querySelector("#btn-recalc-zones")?.addEventListener("click", async () => {
    if (!zones) return;
    if (!confirm("저장된 모든 세션의 HR존 분포·훈련 부하·세션 유형을\n현재 HR존 기준으로 재계산합니다.\n계속하시겠습니까?")) return;

    const btn = container.querySelector("#btn-recalc-zones");
    btn.disabled = true;
    btn.textContent = "재계산 중…";

    const recordsBySession = {};
    for (const r of allRecords) {
      if (!recordsBySession[r.session_id]) recordsBySession[r.session_id] = [];
      recordsBySession[r.session_id].push(r);
    }

    for (const s of sessions) {
      const recs = recordsBySession[s.id] ?? [];
      if (recs.length === 0) continue;
      const hrZoneDist = calcHRZoneDist(recs, zones);
      const updated    = { ...s, hr_zone_dist: hrZoneDist,
        training_load: calcTrainingLoad(s.duration, hrZoneDist),
        session_type:  classifySession({ ...s, hr_zone_dist: hrZoneDist }, zones),
      };
      await patchSession(updated);
    }

    const allAsc = await getAllSessionsAsc();
    const fitness = calcFitness(allAsc);
    await saveFitnessCache({ atl: fitness.atl, ctl: fitness.ctl, tsb: fitness.tsb });

    // 화면 새로고침
    await renderStats(container);
  });

  // 탭 전환
  container.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      container.querySelectorAll(".tab-btn").forEach((b) =>
        b.classList.toggle("active", b.dataset.tab === activeTab));
      container.querySelectorAll(".tab-panel").forEach((p) =>
        p.classList.toggle("hidden", !p.id.endsWith(activeTab)));
      renderPeriodCharts(sessions, container);
    });
  });

  // 이전/다음 내비게이션
  container.querySelector("#prev-period").addEventListener("click", () => {
    shiftPeriod(-1);
    renderPeriodCharts(sessions, container);
  });
  container.querySelector("#next-period").addEventListener("click", () => {
    shiftPeriod(+1);
    renderPeriodCharts(sessions, container);
  });

  // 심박존
  if (zones && zoneTimes) drawZones(zones, zoneTimes);

  // 초기 차트
  renderPeriodCharts(sessions, container);
}

// ── 기간 이동 ─────────────────────────────────────────────────────────────────
function shiftPeriod(dir) {
  if (activeTab === "monthly") {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + dir, 1);
  } else {
    viewWeekStart = new Date(viewWeekStart);
    viewWeekStart.setDate(viewWeekStart.getDate() + dir * 7);
  }
}

// ── 기간별 차트 렌더 ──────────────────────────────────────────────────────────
function renderPeriodCharts(sessions, container) {
  // 레이블 업데이트
  const label = activeTab === "monthly"
    ? `${viewMonth.getFullYear()}년 ${viewMonth.getMonth() + 1}월`
    : `${fmt(viewWeekStart)} ~ ${fmt(addDays(viewWeekStart, 6))}`;
  container.querySelector("#period-label").textContent = label;

  // 기존 차트 파괴
  Object.values(charts).forEach((c) => c?.destroy());
  Object.keys(charts).forEach((k) => delete charts[k]);

  if (activeTab === "monthly") {
    drawMonthlyCharts(sessions);
  } else {
    drawWeeklyCharts(sessions);
  }
}

// ── 월간 차트 (주차별) ─────────────────────────────────────────────────────────
function drawMonthlyCharts(sessions) {
  const year  = viewMonth.getFullYear();
  const month = viewMonth.getMonth();

  // 해당 월에 포함된 주(월요일 기준) 목록
  const weeks = getWeeksInMonth(year, month);
  const labels = weeks.map((mon) => {
    const sun = addDays(mon, 6);
    return `${mon.getMonth() + 1}/${mon.getDate()}~${sun.getMonth() + 1}/${sun.getDate()}`;
  });

  // 세션 집계
  const dist  = new Array(weeks.length).fill(0);
  const count = new Array(weeks.length).fill(0);
  const speeds = weeks.map(() => []);
  const cadences = weeks.map(() => []);

  for (const s of sessions) {
    const d = new Date(s.date);
    const idx = weeks.findIndex((mon) => d >= mon && d <= addDays(mon, 6));
    if (idx < 0) continue;
    dist[idx]  += s.distance ?? 0;
    count[idx] += 1;
    if (s.avg_speed)   speeds[idx].push(s.avg_speed);
    if (s.avg_cadence) cadences[idx].push(s.avg_cadence);
  }

  const avgArr = (arr) => arr.map((a) => a.length ? +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(1) : null);

  mkBar("chart-m-dist",  labels, dist.map((v) => +v.toFixed(1)), "#4fc3f7", "km");
  mkBar("chart-m-count", labels, count, "#f5a623", "회");
  mkLine("chart-m-speed", labels, avgArr(speeds), "#66bb6a", "km/h");
  mkLine("chart-m-cad",   labels, avgArr(cadences), "#ab47bc", "rpm");

  // 훈련 강도 분포 (Easy / Mod / Hard)
  const pEasy = new Array(weeks.length).fill(0);
  const pMod  = new Array(weeks.length).fill(0);
  const pHard = new Array(weeks.length).fill(0);
  for (const s of sessions) {
    if (!s.hr_zone_dist) continue;
    const d = new Date(s.date);
    const idx = weeks.findIndex((mon) => d >= mon && d <= addDays(mon, 6));
    if (idx < 0) continue;
    const durMin = (s.duration ?? 0) / 60;
    pEasy[idx] += durMin * ((s.hr_zone_dist.z1 ?? 0) + (s.hr_zone_dist.z2 ?? 0));
    pMod[idx]  += durMin *  (s.hr_zone_dist.z3 ?? 0);
    pHard[idx] += durMin * ((s.hr_zone_dist.z4 ?? 0) + (s.hr_zone_dist.z5 ?? 0));
  }
  const totalE = pEasy.reduce((a, b) => a + b, 0);
  const totalM = pMod.reduce((a, b) => a + b, 0);
  const totalH = pHard.reduce((a, b) => a + b, 0);
  const summaryMEl = document.getElementById("polar-summary-m");
  if (summaryMEl) summaryMEl.innerHTML = polarSummaryHtml(totalE, totalM, totalH);
  mkStackedBar("chart-m-polar", labels,
    pEasy.map((v) => +v.toFixed(0)),
    pMod.map((v)  => +v.toFixed(0)),
    pHard.map((v) => +v.toFixed(0)),
  );
}

// ── 주간 차트 (요일별) ─────────────────────────────────────────────────────────
function drawWeeklyCharts(sessions) {
  const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

  const dist  = new Array(7).fill(0);
  const count = new Array(7).fill(0);
  const hrs      = Array.from({ length: 7 }, () => []);
  const cadences = Array.from({ length: 7 }, () => []);

  const weekEnd = addDays(viewWeekStart, 6);
  weekEnd.setHours(23, 59, 59, 999);

  for (const s of sessions) {
    const d = new Date(s.date);
    if (d < viewWeekStart || d > weekEnd) continue;
    const dayIdx = (d.getDay() + 6) % 7; // 월=0 … 일=6
    dist[dayIdx]  += s.distance ?? 0;
    count[dayIdx] += 1;
    if (s.avg_hr)      hrs[dayIdx].push(s.avg_hr);
    if (s.avg_cadence) cadences[dayIdx].push(s.avg_cadence);
  }

  const avgArr = (arr) => arr.map((a) => a.length ? +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(1) : null);

  mkBar("chart-w-dist",  DAY_LABELS, dist.map((v) => +v.toFixed(1)), "#f5a623", "km");
  mkBar("chart-w-count", DAY_LABELS, count, "#4fc3f7", "회");
  mkLine("chart-w-hr",  DAY_LABELS, avgArr(hrs),      "#ef5350", "bpm");
  mkLine("chart-w-cad", DAY_LABELS, avgArr(cadences), "#ab47bc", "rpm");

  // 훈련 강도 분포 (Easy / Mod / Hard)
  const wEasy = new Array(7).fill(0);
  const wMod  = new Array(7).fill(0);
  const wHard = new Array(7).fill(0);
  for (const s of sessions) {
    if (!s.hr_zone_dist) continue;
    const d = new Date(s.date);
    if (d < viewWeekStart || d > weekEnd) continue;
    const dayIdx = (d.getDay() + 6) % 7;
    const durMin = (s.duration ?? 0) / 60;
    wEasy[dayIdx] += durMin * ((s.hr_zone_dist.z1 ?? 0) + (s.hr_zone_dist.z2 ?? 0));
    wMod[dayIdx]  += durMin *  (s.hr_zone_dist.z3 ?? 0);
    wHard[dayIdx] += durMin * ((s.hr_zone_dist.z4 ?? 0) + (s.hr_zone_dist.z5 ?? 0));
  }
  const wTotalE = wEasy.reduce((a, b) => a + b, 0);
  const wTotalM = wMod.reduce((a, b) => a + b, 0);
  const wTotalH = wHard.reduce((a, b) => a + b, 0);
  const summaryWEl = document.getElementById("polar-summary-w");
  if (summaryWEl) summaryWEl.innerHTML = polarSummaryHtml(wTotalE, wTotalM, wTotalH);
  mkStackedBar("chart-w-polar", DAY_LABELS,
    wEasy.map((v) => +v.toFixed(0)),
    wMod.map((v)  => +v.toFixed(0)),
    wHard.map((v) => +v.toFixed(0)),
  );
}

// ── HTML 뼈대 ─────────────────────────────────────────────────────────────────
function buildShell(summary, maxHR, profile, zones, zoneTimes) {
  return `
    <div class="page-header">
      <h2 class="page-title">누적 분석</h2>
      <span class="badge" style="font-size:.75rem;padding:4px 10px">
        총 ${summary.count}회 · ${summary.totalDistance.toFixed(0)} km
      </span>
    </div>

    <!-- 전체 요약 -->
    <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:12px">
      ${sc("총 거리",   summary.totalDistance.toFixed(1), "km",   "#4fc3f7")}
      ${sc("총 시간",   formatDur(summary.totalDuration), "",     "#f5a623")}
      ${sc("평균 속도", summary.avgSpeed.toFixed(1),      "km/h", "#66bb6a")}
      ${sc("최고 심박", maxHR ?? "—", maxHR ? "bpm" : "", "#ef5350",
            profile?.max_hr_observed ? "실측" : profile?.age ? "Nes 공식" : "")}
    </div>

    <!-- 심박존 -->
    ${zones && zoneTimes ? `
    <div class="section">
      <div class="section-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span>심박존 분포 <span class="badge">전체</span>
        <span class="badge">MAX ${maxHR} bpm · ${profile?.max_hr_observed ? "실측" : "Nes 공식"}</span></span>
        <button id="btn-recalc-zones" class="btn-secondary"
          style="font-size:0.75rem;padding:4px 10px;margin-left:auto"
          title="모든 세션의 HR존 분포·훈련 부하·세션 유형을 현재 프로필 기준으로 재계산합니다">
          분석 마이그레이션
        </button>
      </div>
      <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-top:10px">
        <div style="width:160px;height:160px;flex-shrink:0"><canvas id="chart-zones"></canvas></div>
        <div class="zone-bars" id="zone-bars" style="flex:1;min-width:180px;align-items:flex-end"></div>
      </div>
    </div>` : ""}

    <!-- 탭 + 기간 내비 -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <div class="tab-bar" style="margin:0;flex:1;min-width:160px">
        <button class="tab-btn ${activeTab === "monthly" ? "active" : ""}" data-tab="monthly">월간</button>
        <button class="tab-btn ${activeTab === "weekly"  ? "active" : ""}" data-tab="weekly">주간</button>
      </div>
      <div class="period-nav">
        <button id="prev-period">←</button>
        <span id="period-label"></span>
        <button id="next-period">→</button>
      </div>
    </div>

    <!-- 월간 패널 -->
    <div id="panel-monthly" class="tab-panel ${activeTab === "monthly" ? "" : "hidden"}">
      <div class="section">
        <div class="section-title">거리 <span class="badge">주차별 km</span></div>
        <div class="chart-wrap" style="height:180px"><canvas id="chart-m-dist"></canvas></div>
      </div>
      <div class="section">
        <div class="section-title">라이딩 횟수 <span class="badge">주차별 회</span></div>
        <div class="chart-wrap" style="height:140px"><canvas id="chart-m-count"></canvas></div>
      </div>
      <div class="section">
        <div class="section-title">평균 속도 <span class="badge">주차별 km/h</span></div>
        <div class="chart-wrap" style="height:140px"><canvas id="chart-m-speed"></canvas></div>
      </div>
      <div class="section">
        <div class="section-title">케이던스 트렌드 <span class="badge">주차별 rpm</span></div>
        <div class="chart-wrap" style="height:140px"><canvas id="chart-m-cad"></canvas></div>
      </div>
      <div class="section">
        <div class="section-title">훈련 강도 분포 <span class="badge">주차별 분</span></div>
        <div id="polar-summary-m" class="polar-summary"></div>
        <div class="chart-wrap" style="height:180px"><canvas id="chart-m-polar"></canvas></div>
      </div>
    </div>

    <!-- 주간 패널 -->
    <div id="panel-weekly" class="tab-panel ${activeTab === "weekly" ? "" : "hidden"}">
      <div class="section">
        <div class="section-title">거리 <span class="badge">요일별 km</span></div>
        <div class="chart-wrap" style="height:180px"><canvas id="chart-w-dist"></canvas></div>
      </div>
      <div class="section">
        <div class="section-title">라이딩 횟수 <span class="badge">요일별 회</span></div>
        <div class="chart-wrap" style="height:140px"><canvas id="chart-w-count"></canvas></div>
      </div>
      <div class="section">
        <div class="section-title">평균 심박 <span class="badge">요일별 bpm</span></div>
        <div class="chart-wrap" style="height:140px"><canvas id="chart-w-hr"></canvas></div>
      </div>
      <div class="section">
        <div class="section-title">케이던스 <span class="badge">요일별 rpm</span></div>
        <div class="chart-wrap" style="height:140px"><canvas id="chart-w-cad"></canvas></div>
      </div>
      <div class="section">
        <div class="section-title">훈련 강도 분포 <span class="badge">요일별 분</span></div>
        <div id="polar-summary-w" class="polar-summary"></div>
        <div class="chart-wrap" style="height:180px"><canvas id="chart-w-polar"></canvas></div>
      </div>
    </div>
  `;
}

// ── 차트 헬퍼 ─────────────────────────────────────────────────────────────────
const AX = { ticks: { color: "#6b7591", font: { size: 11 } }, grid: { color: "#1e2330" } };
const BASE = (yLabel) => ({
  responsive: true, maintainAspectRatio: false, animation: false,
  plugins: { legend: { display: false } },
  scales: { x: AX, y: { ...AX, title: { display: true, text: yLabel, color: "#6b7591", font: { size: 11 } } } },
});

function mkStackedBar(id, labels, easyData, modData, hardData) {
  const el = document.getElementById(id);
  if (!el) return;
  charts[id] = new Chart(el, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Easy Z1+Z2", data: easyData, backgroundColor: "#42a5f5b0", stack: "pol", borderWidth: 0, borderRadius: 0 },
        { label: "Mod Z3",     data: modData,  backgroundColor: "#66bb6ab0", stack: "pol", borderWidth: 0, borderRadius: 0 },
        { label: "Hard Z4+Z5", data: hardData, backgroundColor: "#ef5350b0", stack: "pol", borderWidth: 0, borderRadius: 0 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: true, labels: { color: "#6b7591", font: { size: 11 }, boxWidth: 12, boxHeight: 10 } } },
      scales: {
        x: { ...AX, stacked: true },
        y: { ...AX, stacked: true, title: { display: true, text: "분", color: "#6b7591", font: { size: 11 } } },
      },
    },
  });
}

function polarSummaryHtml(easy, mod, hard) {
  const total = easy + mod + hard;
  if (total === 0) return `<span style="color:var(--muted);font-size:0.8rem">HR 데이터가 있는 세션이 없습니다 — HR존 재계산을 실행하세요.</span>`;
  const pE = Math.round(easy / total * 100);
  const pM = Math.round(mod  / total * 100);
  const pH = Math.round(hard / total * 100);
  const gap = 80 - pE;
  const targetNote = gap <= 0
    ? `<span style="color:#66bb6a;font-size:0.75rem">80/20 목표 달성 ✓</span>`
    : `<span style="color:var(--muted);font-size:0.75rem">Easy 목표 80% 대비 ${gap}% 부족</span>`;
  return `
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px">
      <span class="polar-chip" style="background:#42a5f518;color:#42a5f5">Easy Z1+Z2 <strong>${pE}%</strong> · ${fmtMin(easy)}</span>
      <span class="polar-chip" style="background:#66bb6a18;color:#66bb6a">Mod Z3 <strong>${pM}%</strong> · ${fmtMin(mod)}</span>
      <span class="polar-chip" style="background:#ef535018;color:#ef5350">Hard Z4+Z5 <strong>${pH}%</strong> · ${fmtMin(hard)}</span>
      ${targetNote}
    </div>`;
}

function fmtMin(min) {
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return h > 0 ? `${h}h${m}m` : `${Math.round(m)}m`;
}

function mkBar(id, labels, data, color, yLabel) {
  const el = document.getElementById(id);
  if (!el) return;
  charts[id] = new Chart(el, {
    type: "bar",
    data: { labels, datasets: [{ data, backgroundColor: color + "b0", borderRadius: 4, borderWidth: 0 }] },
    options: BASE(yLabel),
  });
}

function mkLine(id, labels, data, color, yLabel) {
  const el = document.getElementById(id);
  if (!el) return;
  charts[id] = new Chart(el, {
    type: "line",
    data: { labels, datasets: [{ data, borderColor: color, backgroundColor: color + "18",
      borderWidth: 2, pointRadius: 3, pointBackgroundColor: color, fill: true, tension: 0.3, spanGaps: true }] },
    options: BASE(yLabel),
  });
}

function drawZones(zones, counts) {
  const total    = counts.reduce((a, b) => a + b, 0);
  const maxCount = Math.max(...counts);

  charts["zones"] = new Chart(document.getElementById("chart-zones"), {
    type: "doughnut",
    data: {
      labels: zones.map((z) => z.label),
      datasets: [{ data: counts, backgroundColor: zones.map((z) => z.color), borderWidth: 0 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) =>
          ` ${ctx.label}: ${total > 0 ? Math.round(ctx.raw / total * 100) : 0}%` } },
      },
    },
  });

  document.getElementById("zone-bars").innerHTML = zones.map((z, i) => {
    const pct  = total > 0 ? Math.round(counts[i] / total * 100) : 0;
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

// ── 집계 유틸 ─────────────────────────────────────────────────────────────────
function calcAllTimeSummary(sessions) {
  const totalDistance = sessions.reduce((s, x) => s + (x.distance ?? 0), 0);
  const totalDuration = sessions.reduce((s, x) => s + (x.duration ?? 0), 0);
  const sp = sessions.filter((x) => x.avg_speed);
  const avgSpeed = sp.length ? sp.reduce((s, x) => s + x.avg_speed, 0) / sp.length : 0;
  return { count: sessions.length, totalDistance, totalDuration, avgSpeed };
}

function calcZoneTimes(records, zones) {
  const counts = new Array(zones.length).fill(0);
  for (const r of records) {
    if (r.heart_rate == null) continue;
    for (let i = zones.length - 1; i >= 0; i--) {
      if (r.heart_rate >= zones[i].min) { counts[i]++; break; }
    }
  }
  return counts;
}

// ── 날짜 유틸 ─────────────────────────────────────────────────────────────────

/** 해당 월에 걸쳐있는 ISO 주의 월요일 목록 */
function getWeeksInMonth(year, month) {
  const mondays = [];
  const first   = new Date(year, month, 1);
  const last    = new Date(year, month + 1, 0);

  // 첫 날이 속한 주의 월요일부터 시작
  let mon = getMonday(first);
  while (mon <= last) {
    mondays.push(new Date(mon));
    mon = addDays(mon, 7);
  }
  return mondays;
}

function getMonday(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function fmt(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatDur(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function sc(label, value, unit, color, sub = "") {
  return `
    <div class="stat-card" style="--card-color:${color}">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value ?? "—"}<span class="stat-unit">${unit}</span></div>
      ${sub ? `<div class="stat-sub">${sub}</div>` : ""}
    </div>`;
}
