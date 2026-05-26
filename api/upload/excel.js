import fs from "fs/promises";
import os from "os";
import ExcelJS from "exceljs";
import { formidable } from "formidable";
import { applyCors } from "../_lib/cors.js";
import { readSabgSession, isAdminSession } from "../_lib/session.js";
import { bulkInsertRows, mapMatrixRowsToPayloads } from "../_lib/trimestralBulk.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

function parseMultipart(req) {
  const form = formidable({
    multiples: false,
    maxFileSize: 25 * 1024 * 1024,
    uploadDir: os.tmpdir(),
    keepExtensions: true,
  });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

function cellToText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.result === "string" || typeof value.result === "number") return String(value.result);
    if (Array.isArray(value.richText)) {
      return value.richText.map((item) => item?.text || "").join("");
    }
  }
  return String(value);
}

async function workbookFileToPayloads(filePath) {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    entries: "emit",
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    worksheets: "emit",
  });

  let fallbackMatrix = null;

  for await (const worksheetReader of reader) {
    const matrix = [];

    for await (const row of worksheetReader) {
      const cells = [];
      const values = Array.isArray(row.values) ? row.values : [];
      for (let colNumber = 1; colNumber < values.length; colNumber += 1) {
        cells[colNumber - 1] = cellToText(values[colNumber]);
      }
      matrix.push(cells);
    }

    if (!fallbackMatrix && matrix.length) {
      fallbackMatrix = matrix;
    }

    if (worksheetReader.name === "RUTA DCEVE") {
      return mapMatrixRowsToPayloads(matrix);
    }
  }

  if (fallbackMatrix && fallbackMatrix.length) {
    return mapMatrixRowsToPayloads(fallbackMatrix);
  }

  throw new Error("No se encontró ninguna hoja con datos en el archivo XLSX.");
}

export default async function handler(req, res) {
  const pre = applyCors(req, res);
  if (pre) return;

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Método no permitido" });
  }

  const session = readSabgSession(req);
  if (!session) return res.status(401).json({ success: false, message: "Unauthorized" });
  if (!isAdminSession(session)) {
    return res.status(403).json({ success: false, message: "No autorizado" });
  }

  let uploadedPath = null;

  try {
    const { files } = await parseMultipart(req);
    const uploaded = files?.file || files?.excel || files?.archivo || null;
    const file = Array.isArray(uploaded) ? uploaded[0] : uploaded;
    uploadedPath = file?.filepath || null;

    if (!file || !uploadedPath) {
      return res.status(400).json({ success: false, message: "No se recibió archivo XLSX." });
    }

    const filename = String(file.originalFilename || file.newFilename || "").toLowerCase();
    if (!filename.endsWith(".xlsx")) {
      return res.status(400).json({
        success: false,
        message: "La carga Excel directa soporta únicamente archivos .xlsx del sistema SABG.",
      });
    }

    const payloads = await workbookFileToPayloads(uploadedPath);
    const rows = payloads.map((row) => ({
      ...row,
      usuario_registro: row?.usuario_registro || session.usuario || "",
    }));

    const report = await bulkInsertRows(rows);

    return res.status(200).json({
      success: true,
      message: "Carga XLSX completada",
      report,
    });
  } catch (error) {
    console.error("Error /api/upload/excel:", error);
    return res.status(500).json({
      success: false,
      message: "No se pudo procesar el archivo XLSX.",
    });
  } finally {
    if (uploadedPath) {
      try {
        await fs.unlink(uploadedPath);
      } catch (_) {
        // no-op
      }
    }
  }
}
