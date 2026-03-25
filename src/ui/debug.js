/**
 * 디버그 뷰 — 개발용, 1단계 완료 후 제거 또는 hidden 처리
 */

export function renderDebug(container, { wahooRecords, zeppRecords, mergedRecords, matchRate }) {
  container.innerHTML = "";

  if (wahooRecords) {
    container.appendChild(makeRecordTable("Wahoo records[0..4]", wahooRecords.slice(0, 5)));
  }
  if (zeppRecords) {
    container.appendChild(makeRecordTable("ZEPP records[0..4]", zeppRecords.slice(0, 5)));
  }
  if (mergedRecords) {
    container.appendChild(makeRecordTable("Merged records[0..4]", mergedRecords.slice(0, 5)));
  }
  if (matchRate != null) {
    const p = document.createElement("p");
    p.textContent = `병합 매칭률: ${(matchRate * 100).toFixed(1)}% (${Math.round(matchRate * mergedRecords.length)} / ${mergedRecords.length})`;
    p.style.fontWeight = "bold";
    p.style.color = matchRate >= 0.95 ? "green" : "orange";
    container.appendChild(p);
  }
}

function makeRecordTable(title, records) {
  const section = document.createElement("div");

  const h3 = document.createElement("h3");
  h3.textContent = title;
  section.appendChild(h3);

  if (!records || records.length === 0) {
    const p = document.createElement("p");
    p.textContent = "(데이터 없음)";
    section.appendChild(p);
    return section;
  }

  const keys = Object.keys(records[0]);
  const table = document.createElement("table");
  table.style.borderCollapse = "collapse";
  table.style.fontSize = "12px";

  // 헤더
  const thead = table.createTHead();
  const headerRow = thead.insertRow();
  for (const k of keys) {
    const th = document.createElement("th");
    th.textContent = k;
    th.style.border = "1px solid #ccc";
    th.style.padding = "4px 8px";
    th.style.background = "#f0f0f0";
    headerRow.appendChild(th);
  }

  // 바디
  const tbody = table.createTBody();
  for (const rec of records) {
    const row = tbody.insertRow();
    for (const k of keys) {
      const td = row.insertCell();
      const val = rec[k];
      td.textContent = val == null ? "—" : typeof val === "number" ? val.toFixed(4) : String(val);
      td.style.border = "1px solid #ccc";
      td.style.padding = "4px 8px";
    }
  }

  section.appendChild(table);
  return section;
}
