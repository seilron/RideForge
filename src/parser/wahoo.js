import FitParser from "fit-file-parser";

const SEMICIRCLES_TO_DEG = 180 / Math.pow(2, 31);

const parser = new FitParser({
  force: true,
  speedUnit: "km/h",
  lengthUnit: "km",
  elapsedRecordField: true,
  mode: "list",
});

/**
 * Wahoo FIT ArrayBuffer → { records[], calories }
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ records: Array, calories: number|null }>}
 */
export async function parseWahoo(buffer) {
  const fitData = await parser.parseAsync(new Uint8Array(buffer));
  const raw = fitData.records ?? [];

  // FIT session 메시지에서 calories 추출
  const sessions = fitData.sessions ?? [];
  const calories = sessions[0]?.total_calories ?? null;

  const records = raw
    .filter((r) => r.timestamp != null)
    .map((r) => {
      const ts = r.timestamp instanceof Date
        ? r.timestamp.getTime()
        : r.timestamp * 1000;

      return {
        timestamp: ts,
        elapsed_time: r.elapsed_time ?? null,
        speed: r.speed ?? null,
        distance: r.distance ?? null,
        lat: r.position_lat != null ? r.position_lat * SEMICIRCLES_TO_DEG : null,
        lng: r.position_long != null ? r.position_long * SEMICIRCLES_TO_DEG : null,
        cadence: r.cadence ?? null,
        heart_rate: r.heart_rate ?? null,
        src_wahoo: true,
        src_zepp: false,
      };
    });

  return { records, calories };
}
