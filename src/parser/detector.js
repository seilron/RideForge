import FitParser from "fit-file-parser";

const parser = new FitParser({
  force: true,
  speedUnit: "km/h",
  lengthUnit: "km",
  elapsedRecordField: true,
  mode: "list",
});

// 제조사 문자열 → role 매핑
const MANUFACTURER_ROLE = {
  wahoo:    "gps",
  garmin:   "gps",
  huami:    "hr",   // Amazfit / Zepp
  zepp:     "hr",
  amazfit:  "hr",
  polar:    "hr",
  suunto:   "hr",
};

/**
 * FIT 파일 파싱 → 역할 감지 + 정규화된 records 반환
 *
 * role:
 *   "gps"     — GPS 주 기기 (Wahoo 역할)
 *   "hr"      — 심박 주 기기 (ZEPP 역할)
 *   "unknown" — 판단 불가
 *
 * @param {ArrayBuffer} buffer
 * @param {string} fileName
 */
export async function detectFit(buffer, fileName) {
  const fitData = await parser.parseAsync(new Uint8Array(buffer));
  const raw     = fitData.records ?? [];
  const valid   = raw.filter((r) => r.timestamp != null);

  if (valid.length === 0) return null;

  const toMs = (ts) => ts instanceof Date ? ts.getTime() : ts * 1000;
  const timestamps = valid.map((r) => toMs(r.timestamp));
  const start = Math.min(...timestamps);
  const end   = Math.max(...timestamps);

  // 유효 GPS: 0이 아닌 실제 좌표
  const gpsCount = valid.filter((r) =>
    r.position_lat != null && Math.abs(r.position_lat) > 1
  ).length;
  const hrCount  = valid.filter((r) => r.heart_rate != null).length;
  const gpsRatio = gpsCount / valid.length;

  // 1순위: FIT 제조사 메타 → 2순위: 파일명 → 3순위: GPS/HR 비율
  const role = detectRoleFromManufacturer(fitData)
    ?? detectRoleFromFileName(fileName)
    ?? (gpsRatio > 0.3 ? "gps" : hrCount / valid.length > 0.3 ? "hr" : "unknown");

  // 레코드 정규화
  const records = valid.map((r) => ({
    timestamp:    toMs(r.timestamp),
    elapsed_time: r.elapsed_time ?? null,
    speed:        r.speed        ?? null,
    distance:     r.distance     ?? null,
    lat:  r.position_lat  != null && Math.abs(r.position_lat)  > 1 ? r.position_lat  : null,
    lng:  r.position_long != null && Math.abs(r.position_long) > 1 ? r.position_long : null,
    cadence:    r.cadence    ?? null,
    heart_rate: r.heart_rate ?? null,
    src_wahoo:  false,
    src_zepp:   false,
  }));

  return {
    fileName,
    role,
    gpsRatio,
    gpsCount,
    hrCount,
    start,
    end,
    duration: (end - start) / 1000,
    calories: fitData.sessions?.[0]?.total_calories ?? null,
    records,
    hasGps: gpsCount > 0,
    hasHR:  hrCount  > 0,
  };
}

function detectRoleFromManufacturer(fitData) {
  // device_infos 배열에서 제조사 확인
  const infos = fitData.device_infos ?? [];
  for (const info of infos) {
    const mfr = (info.manufacturer ?? "").toString().toLowerCase();
    for (const [key, role] of Object.entries(MANUFACTURER_ROLE)) {
      if (mfr.includes(key)) return role;
    }
  }
  // file_creator에서도 확인
  const creator = (fitData.file_creator?.software_version ?? "").toString().toLowerCase();
  for (const [key, role] of Object.entries(MANUFACTURER_ROLE)) {
    if (creator.includes(key)) return role;
  }
  return null;
}

/** 파일명 기반 role 감지 (최후 수단) */
function detectRoleFromFileName(fileName) {
  const lower = fileName.toLowerCase();
  for (const [key, role] of Object.entries(MANUFACTURER_ROLE)) {
    if (lower.includes(key)) return role;
  }
  return null;
}
