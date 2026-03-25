import Chart from "chart.js/auto";
import { getAllSessionsAsc, getRecentSessions, getFitnessCache,
         getCoachGoal, saveCoachGoal, getProfile, getRecordsBySession } from "../db/index.js";
import { calcFitness, getTSBStatus, SESSION_TYPE_META } from "../utils/load.js";
import { calcCadenceHRCorrelation, getCadenceGrade } from "../utils/cadence.js";
import { calcMaxHR, getHRZones } from "../utils/hr.js";

const charts = {};

export async function renderCoach(container) {
  container.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">코칭</h2>
    </div>
    <div id="coach-a"></div>
    <div id="coach-b"></div>
    <div id="coach-c"></div>
    <div id="coach-d"></div>
    <div id="coach-e"></div>
  `;

  // 데이터 병렬 로드
  const [fitnessCache, recentSessions28, allSessionsAsc, profile, goal] = await Promise.all([
    getFitnessCache(),
    getRecentSessions(28),
    getAllSessionsAsc(),
    getProfile(),
    getCoachGoal(),
  ]);

  const fitness = fitnessCache ?? calcFitness(allSessionsAsc);
  const maxHR   = profile?.max_hr_observed ?? (profile?.age ? calcMaxHR(profile.age) : null);
  const zones   = maxHR ? getHRZones(maxHR) : null;

  renderSectionA(document.getElementById("coach-a"), fitness);
  renderSectionB(document.getElementById("coach-b"), recentSessions28, zones);
  renderSectionC(document.getElementById("coach-c"), recentSessions28);
  renderSectionD(document.getElementById("coach-d"), recentSessions28);
  renderSectionE(document.getElementById("coach-e"), fitness, allSessionsAsc, goal);
}

// ── 섹션 A: 컨디션 신호등 ──────────────────────────────────────────────────────

function renderSectionA(el, fitness) {
  const { atl, ctl, tsb } = fitness;
  const state = getTSBStatus(tsb);

  // CTL 전주 대비 — history 마지막 7일 비교
  const history = fitness.history ?? [];
  const prevCTL = history.length >= 8 ? history[history.length - 8].ctl : null;
  const ctlDiff = prevCTL != null ? Math.round((ctl - prevCTL) * 10) / 10 : null;
  const ctlTrend = ctlDiff == null ? "" :
    ctlDiff > 0 ? `<span style="color:#66bb6a">▲ ${ctlDiff}</span>` :
    ctlDiff < 0 ? `<span style="color:#ef5350">▼ ${Math.abs(ctlDiff)}</span>` :
    `<span style="color:var(--muted)">— 유지</span>`;

  el.innerHTML = `
    <div class="coach-card" style="border-left:4px solid ${state.color}">
      <div class="coach-card-title">컨디션 ${state.emoji} ${state.label}</div>
      <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);margin:0">
        ${coachStat("ATL", atl.toFixed(1), "피로",    "#ef5350")}
        ${coachStat("CTL", ctl.toFixed(1), "체력",    "#42a5f5")}
        ${coachStat("TSB", tsb.toFixed(1), "컨디션",  state.color)}
      </div>
      ${ctlTrend ? `<div style="font-size:.8rem;margin-top:10px;color:var(--muted)">체력(CTL) 전주 대비 ${ctlTrend}</div>` : ""}
    </div>
  `;
}

// ── 섹션 B: 최근 세션 리포트 ──────────────────────────────────────────────────

async function renderSectionB(el, recent7, zones) {
  const recent = await getRecentSessions(7);
  if (recent.length === 0) {
    el.innerHTML = `<div class="coach-card"><div class="coach-card-title">최근 세션 리포트</div>
      <p class="coach-empty">최근 7일 세션이 없어요.</p></div>`;
    return;
  }

  const last    = recent[recent.length - 1];
  const meta    = SESSION_TYPE_META[last.session_type] ?? SESSION_TYPE_META.aerobic;
  const grade   = last.cadence_stddev != null ? getCadenceGrade(last.cadence_stddev) : null;
  const zd      = last.hr_zone_dist ?? {};

  // 피어슨 상관계수 (records 필요)
  let corr = null;
  try {
    const records = await getRecordsBySession(last.id);
    corr = calcCadenceHRCorrelation(records);
  } catch (_) {}

  el.innerHTML = `
    <div class="coach-card">
      <div class="coach-card-title">최근 세션 리포트</div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <span class="coach-type-badge" style="background:${meta.color}22;color:${meta.color}">${meta.label}</span>
        <span style="font-size:.85rem;color:var(--muted)">${formatDate(last.date)}</span>
      </div>
      <p style="font-size:.9rem;line-height:1.6;margin-bottom:14px">${meta.comment}</p>

      ${zones && Object.values(zd).some((v) => v > 0) ? `
      <div style="margin-bottom:14px">
        <div style="font-size:.75rem;color:var(--muted);margin-bottom:6px">HR존 분포</div>
        <div id="zone-stack-bar"></div>
      </div>` : ""}

      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:.85rem">
        ${grade ? `<span>페달링 안정성: <strong style="color:${grade.color}">${grade.label}</strong> (±${last.cadence_stddev}rpm)</span>` : ""}
        ${corr != null ? `<span>케이던스-심박 상관: <strong>${corr}</strong></span>` : ""}
      </div>
    </div>
  `;

  // 가로 스택 바
  if (zones && Object.values(zd).some((v) => v > 0)) {
    const barEl = document.getElementById("zone-stack-bar");
    if (barEl) renderZoneStackBar(barEl, zd, zones);
  }
}

function renderZoneStackBar(el, zd, zones) {
  el.style.cssText = "display:flex;height:20px;border-radius:4px;overflow:hidden;gap:1px";
  zones.forEach((z, i) => {
    const key = `z${i + 1}`;
    const pct = Math.round((zd[key] ?? 0) * 100);
    if (pct === 0) return;
    const seg = document.createElement("div");
    seg.title = `${z.label} ${pct}%`;
    seg.style.cssText = `flex:${pct};background:${z.color};transition:flex .3s`;
    el.appendChild(seg);
  });
}

// ── 섹션 C: Z2 달성률 추이 (4주) ──────────────────────────────────────────────

function renderSectionC(el, recent28) {
  const weekly = groupByWeek(recent28);
  const labels = weekly.map((w) => w.label);
  const z2Avg  = weekly.map((w) => {
    if (w.sessions.length === 0) return null;
    const avg = w.sessions.reduce((s, x) => s + (x.hr_zone_dist?.z2 ?? 0), 0) / w.sessions.length;
    return Math.round(avg * 1000) / 10; // → %
  });

  const currentZ2 = z2Avg[z2Avg.length - 1];

  el.innerHTML = `
    <div class="coach-card">
      <div class="coach-card-title">Z2 달성률 추이
        ${currentZ2 != null ? `<span class="badge" style="margin-left:8px">이번 주 ${currentZ2}%</span>` : ""}
      </div>
      ${recent28.length === 0
        ? `<p class="coach-empty">데이터가 없어요.</p>`
        : `<div class="chart-wrap" style="height:160px"><canvas id="chart-z2"></canvas></div>
           <div style="font-size:.75rem;color:var(--muted);margin-top:6px">목표: 60% 이상 (점선)</div>`
      }
    </div>
  `;

  if (recent28.length > 0) {
    const ctx = document.getElementById("chart-z2");
    if (ctx) {
      charts["z2"]?.destroy();
      charts["z2"] = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Z2 비율",
              data: z2Avg,
              borderColor: "#42a5f5",
              backgroundColor: "rgba(66,165,245,.1)",
              borderWidth: 2,
              pointRadius: 4,
              pointBackgroundColor: "#42a5f5",
              fill: true,
              tension: 0.3,
              spanGaps: true,
            },
            {
              label: "목표 60%",
              data: labels.map(() => 60),
              borderColor: "#66bb6a",
              borderWidth: 1.5,
              borderDash: [6, 4],
              pointRadius: 0,
              fill: false,
            },
          ],
        },
        options: chartOpts("%", 0, 100),
      });
    }
  }
}

// ── 섹션 D: 케이던스 전환 추적 (4주) ──────────────────────────────────────────

async function renderSectionD(el, recent28) {
  const weekly   = groupByWeek(recent28);
  const labels   = weekly.map((w) => w.label);
  const stddevs  = weekly.map((w) => {
    if (w.sessions.length === 0) return null;
    const valid = w.sessions.filter((s) => s.cadence_stddev != null);
    if (valid.length === 0) return null;
    return Math.round(valid.reduce((s, x) => s + x.cadence_stddev, 0) / valid.length * 10) / 10;
  });

  // 가장 최근 세션의 케이던스-심박 상관계수
  let corr = null;
  let corrLabel = "";
  if (recent28.length > 0) {
    const last = recent28[recent28.length - 1];
    try {
      const records = await getRecordsBySession(last.id);
      corr = calcCadenceHRCorrelation(records);
    } catch (_) {}
  }

  if (corr != null) {
    corrLabel = corr >= 0.7 ? "전환 초기" : corr >= 0.4 ? "전환 중" : "전환 완성";
  }

  el.innerHTML = `
    <div class="coach-card">
      <div class="coach-card-title">케이던스 전환 추적
        ${corr != null ? `<span class="badge" style="margin-left:8px">${corrLabel} (r=${corr})</span>` : ""}
      </div>
      ${recent28.length === 0
        ? `<p class="coach-empty">데이터가 없어요.</p>`
        : `<div class="chart-wrap" style="height:160px"><canvas id="chart-cad-trend"></canvas></div>
           <div style="font-size:.75rem;color:var(--muted);margin-top:6px">케이던스 표준편차 — 낮을수록 페달링이 안정적</div>`
      }
    </div>
  `;

  if (recent28.length > 0) {
    const ctx = document.getElementById("chart-cad-trend");
    if (ctx) {
      charts["cad"]?.destroy();
      charts["cad"] = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [{
            label: "케이던스 stddev",
            data: stddevs,
            borderColor: "#ab47bc",
            backgroundColor: "rgba(171,71,188,.1)",
            borderWidth: 2,
            pointRadius: 4,
            pointBackgroundColor: "#ab47bc",
            fill: true,
            tension: 0.3,
            spanGaps: true,
          }],
        },
        options: chartOpts("rpm"),
      });
    }
  }
}

// ── 섹션 E: D-Day 트래커 ──────────────────────────────────────────────────────

function renderSectionE(el, fitness, allSessions, goal) {
  if (!goal?.target_date) {
    el.innerHTML = `
      <div class="coach-card">
        <div class="coach-card-title">D-Day 트래커</div>
        <p style="font-size:.85rem;color:var(--muted);margin-bottom:14px">목표일을 설정하면 CTL 커브를 시각화해드려요.</p>
        <div class="field">
          <label>목표 이벤트</label>
          <input type="text" id="goal-event" placeholder="예: 국토종주" style="width:100%;padding:9px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.875rem" />
        </div>
        <div class="field" style="margin-top:10px">
          <label>목표일</label>
          <input type="date" id="goal-date" style="width:100%;padding:9px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.875rem" />
        </div>
        <button class="btn-primary" id="goal-save-btn" style="margin-top:12px">저장</button>
      </div>
    `;
    document.getElementById("goal-save-btn").addEventListener("click", async () => {
      const event = document.getElementById("goal-event").value.trim();
      const date  = document.getElementById("goal-date").value;
      if (!date) return;
      await saveCoachGoal({ target_date: date, goal_event: event || "목표 이벤트" });
      // 저장 후 재렌더
      const [updatedGoal, updatedAllSessions] = await Promise.all([getCoachGoal(), getAllSessionsAsc()]);
      renderSectionE(el, calcFitness(updatedAllSessions), updatedAllSessions, updatedGoal);
    });
    return;
  }

  const targetDate = new Date(goal.target_date);
  const today      = new Date();
  today.setHours(0, 0, 0, 0);
  const daysLeft   = Math.max(0, Math.round((targetDate - today) / (1000 * 60 * 60 * 24)));
  const weeksLeft  = Math.floor(daysLeft / 7);

  // CTL 목표 커브 (현재 → 60 선형)
  const TARGET_CTL = 60;
  const history    = fitness.history ?? [];
  const last8w     = history.slice(-56); // 최근 8주
  const labels     = last8w.map((h) => h.date.slice(5));
  const actualCTL  = last8w.map((h) => h.ctl);

  // 현재 CTL에서 목표일까지 선형 증가 가이드라인 (오늘 이후만)
  const todayStr = today.toISOString().slice(0, 10);
  const guideData = last8w.map((h) => {
    if (h.date < todayStr) return null;
    const daysToTarget = Math.max(1, Math.round((targetDate - new Date(h.date)) / (1000 * 60 * 60 * 24)));
    const totalDays    = Math.max(1, Math.round((targetDate - today) / (1000 * 60 * 60 * 24)));
    const progress     = 1 - daysToTarget / totalDays;
    return Math.round((fitness.ctl + (TARGET_CTL - fitness.ctl) * progress) * 10) / 10;
  });

  // "지금 페이스라면 목표일 CTL 예상"
  const ctlPerWeek  = history.length >= 8
    ? (history[history.length - 1].ctl - history[history.length - 8].ctl) / 7
    : 0;
  const predictCTL  = Math.round((fitness.ctl + ctlPerWeek * daysLeft) * 10) / 10;

  el.innerHTML = `
    <div class="coach-card">
      <div class="coach-card-title">D-Day 트래커
        <span class="badge" style="margin-left:8px">${goal.goal_event}</span>
        <span class="badge" style="margin-left:4px">D-${daysLeft} (${weeksLeft}주)</span>
      </div>
      <p style="font-size:.85rem;color:var(--muted);margin-bottom:14px">
        지금 페이스라면 목표일 CTL 예상: <strong style="color:var(--primary)">${predictCTL}</strong>
        (목표 ${TARGET_CTL})
      </p>
      <div class="chart-wrap" style="height:180px"><canvas id="chart-ctl"></canvas></div>
      <button class="btn-link" id="goal-reset-btn" style="margin-top:10px;font-size:.75rem;color:var(--muted)">목표 재설정</button>
    </div>
  `;

  const ctx = document.getElementById("chart-ctl");
  if (ctx && last8w.length > 0) {
    charts["ctl"]?.destroy();
    charts["ctl"] = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "실제 CTL",
            data: actualCTL,
            borderColor: "#4fc3f7",
            backgroundColor: "rgba(79,195,247,.1)",
            borderWidth: 2,
            pointRadius: 0,
            fill: true,
            tension: 0.3,
          },
          {
            label: "목표 가이드",
            data: guideData,
            borderColor: "#f5a623",
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointRadius: 0,
            fill: false,
            spanGaps: true,
          },
        ],
      },
      options: chartOpts("CTL"),
    });
  }

  document.getElementById("goal-reset-btn").addEventListener("click", async () => {
    await saveCoachGoal({ target_date: null, goal_event: null });
    const updatedGoal = await getCoachGoal();
    renderSectionE(el, fitness, allSessions, updatedGoal);
  });
}

// ── 공통 유틸 ─────────────────────────────────────────────────────────────────

function groupByWeek(sessions) {
  const weeks = [];
  for (let i = 3; i >= 0; i--) {
    const end   = new Date();
    end.setDate(end.getDate() - i * 7);
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);

    const label = `${start.getMonth() + 1}/${start.getDate()}~${end.getMonth() + 1}/${end.getDate()}`;
    const week  = sessions.filter((s) => {
      const d = new Date(s.date);
      return d >= start && d <= end;
    });
    weeks.push({ label, sessions: week });
  }
  return weeks;
}

const AX = { ticks: { color: "#6b7591", font: { size: 11 } }, grid: { color: "#1e2330" } };
function chartOpts(yLabel, yMin, yMax) {
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: false } },
    scales: {
      x: AX,
      y: {
        ...AX,
        title: { display: true, text: yLabel, color: "#6b7591", font: { size: 11 } },
        ...(yMin != null ? { min: yMin } : {}),
        ...(yMax != null ? { max: yMax } : {}),
      },
    },
  };
}

function coachStat(label, value, sub, color) {
  return `
    <div class="stat-card" style="--card-color:${color}">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
      <div class="stat-sub">${sub}</div>
    </div>`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("ko-KR", {
    month: "long", day: "numeric", weekday: "short",
  });
}
