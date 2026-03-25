import FitParser from "fit-file-parser";

const parser = new FitParser({
  force: true,
  speedUnit: "km/h",
  lengthUnit: "km",
  elapsedRecordField: true,
  mode: "list",
});

/**
 * ZEPP FIT ArrayBuffer → 내부 records[] 변환
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Array>} records
 */
export async function parseZepp(buffer) {
  const fitData = await parser.parseAsync(new Uint8Array(buffer));
  const raw = fitData.records ?? [];

  return raw
    .filter((r) => r.timestamp != null)
    .map((r) => {
      const ts = r.timestamp instanceof Date
        ? r.timestamp.getTime()
        : r.timestamp * 1000;

      return {
        timestamp: ts,
        elapsed_time: r.elapsed_time ?? null,
        heart_rate: r.heart_rate ?? null,
        cadence: r.cadence ?? null,
        src_wahoo: false,
        src_zepp: true,
      };
    });
}
