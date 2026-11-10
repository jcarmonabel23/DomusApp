/**
 * @project DomusApp - API
 * @file src/lib/reportExport.ts
 * @description Exportación de reportes con varias secciones (indicadores + tablas) a Excel y PDF
 *
 * A diferencia de `exports.ts` (una tabla por archivo), un reporte tiene secciones: cada una con sus
 * indicadores clave y una o más tablas. En Excel cada sección va en su propia hoja; en el PDF, una tras otra.
 * Los números se escriben como número en Excel (para que se puedan sumar o graficar) y nunca como fórmula.
 */

import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { Response } from "express";

export type ReportCell = string | number | null;

export interface ReportTable {
  title: string;
  columns: { header: string; width: number; align?: "left" | "right" }[];
  rows: ReportCell[][];
}

export interface ReportSection {
  title: string;
  note?: string;
  kpis: { label: string; value: string }[];
  tables: ReportTable[];
}

export interface ReportDoc {
  title: string;
  subtitle: string;
  condominium: string;
  color: string | null;
  timezone: string;
  fileBase: string;
  sections: ReportSection[];
}

const DOMUS = "#1572d3";
const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");
const fmtNow = (tz: string) => new Intl.DateTimeFormat("es-419", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(new Date());
const text = (v: ReportCell) => (v === null || v === undefined ? "" : typeof v === "number" ? new Intl.NumberFormat("es-419", { maximumFractionDigits: 2 }).format(v) : v);

export async function sendReportXlsx(res: Response, doc: ReportDoc): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "DomusApp";
  wb.created = new Date();
  const argb = (doc.color ?? DOMUS).replace("#", "FF");
  const used = new Set<string>();

  for (const s of doc.sections) {
    // Nombre de hoja: máx. 31 caracteres, sin \ / ? * [ ] : y único
    let name = s.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
    for (let i = 2; used.has(name); i++) name = `${s.title.slice(0, 27)} (${i})`;
    used.add(name);
    const ws = wb.addWorksheet(name);
    const width = Math.max(2, ...s.tables.map((t) => t.columns.length));

    ws.mergeCells(1, 1, 1, width);
    ws.getCell(1, 1).value = `${doc.condominium} · ${doc.title} · ${s.title}`;
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb } };
    ws.mergeCells(2, 1, 2, width);
    ws.getCell(2, 1).value = s.note ? `${doc.subtitle} · ${s.note}` : doc.subtitle;
    ws.getCell(2, 1).font = { size: 10, color: { argb: "FF6B7280" } };

    let r = 4;
    for (const k of s.kpis) {
      ws.getCell(r, 1).value = k.label;
      ws.getCell(r, 1).font = { color: { argb: "FF374151" } };
      ws.getCell(r, 2).value = k.value;
      ws.getCell(r, 2).font = { bold: true };
      r++;
    }
    for (const t of s.tables) {
      r++;
      ws.getCell(r, 1).value = t.title;
      ws.getCell(r, 1).font = { bold: true, size: 12, color: { argb } };
      r++;
      t.columns.forEach((c, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = c.header;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
        const col = ws.getColumn(i + 1);
        col.width = Math.max(col.width ?? 10, c.width);
      });
      r++;
      if (t.rows.length === 0) {
        ws.getCell(r, 1).value = "Sin registros en el período";
        ws.getCell(r, 1).font = { italic: true, color: { argb: "FF6B7280" } };
        r++;
      }
      for (const row of t.rows) {
        row.forEach((v, i) => {
          const cell = ws.getCell(r, i + 1);
          cell.value = v ?? null;
          if (t.columns[i]?.align === "right") cell.alignment = { horizontal: "right" };
        });
        r++;
      }
    }
    ws.getColumn(1).width = Math.max(ws.getColumn(1).width ?? 10, 34);
    ws.getColumn(2).width = Math.max(ws.getColumn(2).width ?? 10, 18);
  }
  if (doc.sections.length === 0) wb.addWorksheet("Reporte").getCell(1, 1).value = "No hay secciones para exportar";

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${doc.fileBase}_${stamp()}.xlsx"`);
  res.setHeader("Content-Length", String(buffer.length));
  res.end(buffer);
}

export async function sendReportPdf(res: Response, rep: ReportDoc): Promise<void> {
  const doc = new PDFDocument({ size: "LETTER", margin: 40, bufferPages: true, info: { Title: rep.title, Creator: "DomusApp" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on("end", () => resolve()));

  const color = rep.color ?? DOMUS;
  const left = doc.page.margins.left;
  const usable = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 24;
  const ensure = (h: number) => {
    if (doc.y + h > bottom()) {
      doc.addPage();
      doc.y = doc.page.margins.top;
    }
  };

  doc.fillColor(color).font("Helvetica-Bold").fontSize(16).text(rep.condominium, left, 40);
  doc.fillColor("#111827").fontSize(13).text(rep.title);
  doc.fillColor("#6b7280").font("Helvetica").fontSize(9).text(rep.subtitle);
  doc.moveDown(0.8);

  for (const s of rep.sections) {
    ensure(90);
    const y0 = doc.y;
    doc.rect(left, y0, usable, 22).fill(color);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11).text(s.title, left + 8, y0 + 6, { width: usable - 16, lineBreak: false });
    doc.y = y0 + 28;
    if (s.note) {
      doc.fillColor("#6b7280").font("Helvetica").fontSize(8).text(s.note, left, doc.y, { width: usable });
      doc.moveDown(0.4);
    }

    // Indicadores en una cuadrícula de 3 columnas
    const cols = 3;
    const boxW = (usable - (cols - 1) * 8) / cols;
    for (let i = 0; i < s.kpis.length; i += cols) {
      ensure(40);
      const y = doc.y;
      s.kpis.slice(i, i + cols).forEach((k, j) => {
        const x = left + j * (boxW + 8);
        doc.roundedRect(x, y, boxW, 34, 4).fill("#f3f4f6");
        doc.fillColor("#6b7280").font("Helvetica").fontSize(7.5).text(k.label, x + 6, y + 5, { width: boxW - 12, lineBreak: false, ellipsis: true });
        doc.fillColor("#111827").font("Helvetica-Bold").fontSize(11).text(k.value, x + 6, y + 17, { width: boxW - 12, lineBreak: false, ellipsis: true });
      });
      doc.y = y + 40;
    }

    for (const t of s.tables) {
      const total = t.columns.reduce((n, c) => n + c.width, 0);
      const widths = t.columns.map((c) => (c.width / total) * usable);
      const header = () => {
        const y = doc.y;
        doc.rect(left, y, usable, 16).fill("#e5e7eb");
        let x = left;
        doc.fillColor("#111827").font("Helvetica-Bold").fontSize(8);
        t.columns.forEach((c, i) => {
          doc.text(c.header, x + 4, y + 4, { width: widths[i] - 8, lineBreak: false, ellipsis: true, align: c.align ?? "left" });
          x += widths[i];
        });
        doc.y = y + 18;
      };
      ensure(50);
      doc.moveDown(0.3);
      doc.fillColor(color).font("Helvetica-Bold").fontSize(9.5).text(t.title, left, doc.y);
      doc.moveDown(0.2);
      header();
      doc.font("Helvetica").fontSize(8);
      if (t.rows.length === 0) {
        doc.fillColor("#6b7280").text("Sin registros en el período.", left + 4, doc.y + 2);
        doc.moveDown(0.5);
      }
      t.rows.forEach((row, r) => {
        const texts = row.map(text);
        const h = Math.max(13, ...texts.map((v, i) => doc.heightOfString(v, { width: widths[i] - 8 }) + 5));
        if (doc.y + h > bottom()) {
          doc.addPage();
          doc.y = doc.page.margins.top;
          header();
          doc.font("Helvetica").fontSize(8);
        }
        const y = doc.y;
        if (r % 2 === 1) doc.rect(left, y - 1, usable, h).fill("#f9fafb");
        let x = left;
        doc.fillColor("#111827");
        texts.forEach((v, i) => {
          doc.text(v, x + 4, y + 2, { width: widths[i] - 8, align: t.columns[i]?.align ?? "left" });
          x += widths[i];
        });
        doc.y = y + h;
      });
      doc.moveDown(0.6);
    }
    doc.moveDown(0.6);
  }
  if (rep.sections.length === 0) doc.fillColor("#6b7280").font("Helvetica").fontSize(10).text("No hay secciones para exportar.");

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.fillColor("#9ca3af").font("Helvetica").fontSize(8).text(
      `Generado con DomusApp · ${fmtNow(rep.timezone)} · Página ${i + 1} de ${range.count}`,
      left,
      doc.page.height - doc.page.margins.bottom - 10,
      { width: usable, align: "right", lineBreak: false }
    );
  }
  doc.end();
  await done;

  const buffer = Buffer.concat(chunks);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${rep.fileBase}_${stamp()}.pdf"`);
  res.setHeader("Content-Length", String(buffer.length));
  res.end(buffer);
}
