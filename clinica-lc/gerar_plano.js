const modesto = require("./brand/modesto_docx.js");
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, Header, PageBreak,
  BorderStyle, ShadingType, Table, TableRow, TableCell, WidthType,
} = require("docx");
const fs = require("fs");

const { BEGE, PRETO, DOURADO, CINZA_TEXTO, FONT_TITULO, FONT_CORPO } = modesto;
const LINHA = "D8D3C8";

/* ---------- helpers extras ---------- */

function h2(text) {
  return new Paragraph({
    spacing: { before: 260, after: 140 },
    children: [new TextRun({ text, font: FONT_TITULO, size: 28, bold: true, color: PRETO })],
  });
}

function h3(text) {
  return new Paragraph({
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, font: FONT_CORPO, size: 20, bold: true, color: DOURADO })],
  });
}

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after || 140, line: 290 },
    children: [new TextRun({
      text, font: FONT_CORPO, size: opts.size || 19,
      color: opts.color || CINZA_TEXTO, bold: !!opts.bold, italics: !!opts.italics,
    })],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    spacing: { after: 70, line: 280 },
    indent: { left: 340 + level * 280, hanging: 200 },
    children: [
      new TextRun({ text: "•  ", font: FONT_CORPO, size: 19, color: DOURADO, bold: true }),
      new TextRun({ text, font: FONT_CORPO, size: 19, color: CINZA_TEXTO }),
    ],
  });
}

// bullet com rótulo em negrito antes do texto
function bulletKV(label, text, level = 0) {
  return new Paragraph({
    spacing: { after: 70, line: 280 },
    indent: { left: 340 + level * 280, hanging: 200 },
    children: [
      new TextRun({ text: "•  ", font: FONT_CORPO, size: 19, color: DOURADO, bold: true }),
      new TextRun({ text: label + " ", font: FONT_CORPO, size: 19, color: PRETO, bold: true }),
      new TextRun({ text, font: FONT_CORPO, size: 19, color: CINZA_TEXTO }),
    ],
  });
}

function cell(text, o = {}) {
  return new TableCell({
    width: o.width ? { size: o.width, type: WidthType.PERCENTAGE } : undefined,
    shading: { type: ShadingType.CLEAR, fill: o.fill || (o.head ? PRETO : "FAFAF7"), color: "auto" },
    margins: { top: 110, bottom: 110, left: 150, right: 150 },
    columnSpan: o.span || 1,
    children: [new Paragraph({
      alignment: o.align === "right" ? AlignmentType.RIGHT : (o.align === "center" ? AlignmentType.CENTER : AlignmentType.LEFT),
      children: [new TextRun({
        text: String(text),
        font: FONT_CORPO,
        size: o.head ? 15 : 17,
        bold: o.head || o.bold,
        color: o.head ? BEGE : (o.color || CINZA_TEXTO),
        characterSpacing: o.head ? 16 : 0,
      })],
    })],
  });
}

function table(headers, rows, widths, opts = {}) {
  const border = { style: BorderStyle.SINGLE, size: 3, color: LINHA };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => cell(h.toUpperCase(), {
          head: true, width: widths[i],
          align: i > 0 && opts.numeric ? "right" : "left",
        })),
      }),
      ...rows.map((r) => new TableRow({
        children: r.map((c, i) => {
          const isTotal = typeof r[0] === "string" && /^total/i.test(r[0]);
          return cell(c, {
            width: widths[i],
            align: i > 0 && opts.numeric ? "right" : "left",
            bold: isTotal,
            color: isTotal ? PRETO : undefined,
            fill: isTotal ? "F2EEE2" : undefined,
          });
        }),
      })),
    ],
  });
}

function spacer(h = 160) {
  return new Paragraph({ spacing: { after: h }, children: [] });
}

// caixa de destaque / alerta
function callout(label, text) {
  const border = { style: BorderStyle.SINGLE, size: 3, color: LINHA };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: border, bottom: border, right: border,
      left: { style: BorderStyle.SINGLE, size: 18, color: DOURADO },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    },
    rows: [new TableRow({ children: [new TableCell({
      width: { size: 100, type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.CLEAR, fill: "FAFAF7", color: "auto" },
      margins: { top: 190, bottom: 190, left: 240, right: 240 },
      children: [
        new Paragraph({ spacing: { after: 70 }, children: [new TextRun({
          text: label.toUpperCase(), font: FONT_CORPO, size: 15, bold: true, color: DOURADO, characterSpacing: 20,
        })]}),
        new Paragraph({ spacing: { line: 280 }, children: [new TextRun({
          text, font: FONT_CORPO, size: 18, color: PRETO,
        })]}),
      ],
    })]})],
  });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

module.exports = { h2, h3, p, bullet, bulletKV, table, spacer, callout, pageBreak, cell };
