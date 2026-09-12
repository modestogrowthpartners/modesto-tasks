/**
 * Componentes reutilizáveis de identidade visual Modesto Growth Partners
 * para documentos gerados com docx-js.
 *
 * Uso: const modesto = require('./modesto_docx.js');
 *      // depois use modesto.BEGE, modesto.eyebrow(...), modesto.sectionTitle(...), etc.
 *
 * IMPORTANTE: os nomes de fonte (FONT_TITULO / FONT_CORPO) são uma aproximação
 * visual, não confirmada com o time da Modesto. Se o cliente confirmar os nomes
 * reais das fontes de marca, atualize as duas constantes abaixo e regenere
 * qualquer documento já produzido com os valores antigos.
 */

const {
  Paragraph, TextRun, AlignmentType, ImageRun, Footer, PageBreak,
  BorderStyle, ShadingType, Table, TableRow, TableCell, WidthType,
  TabStopType, TabStopPosition,
} = require("docx");
const fs = require("fs");
const path = require("path");

const ASSETS_DIR = path.join(__dirname, "assets");

// ---- Paleta (extraída por amostragem de pixel dos materiais enviados pelo cliente) ----
const BEGE = "F0EDE6";        // confirmado: cor sólida da referência enviada
const PRETO = "1A1A18";       // confirmado: bate com o theme-color do site oficial
const DOURADO = "C9A227";     // APROXIMADO: média de cor extraída do logo (imagem gerada por IA, gradiente em faixas) — confirmar com o cliente
const CINZA_TEXTO = "4A4A46"; // aproximado, tom de corpo de texto secundário observado no site

// ---- Tipografia (NÃO CONFIRMADA — aproximação visual do estilo editorial do site) ----
const FONT_TITULO = "Playfair Display"; // serifada, bold, uso em títulos
const FONT_CORPO = "Inter";             // sans-serif, uso em corpo e labels

const LOGO_RATIO = 724 / 2172; // proporção real do arquivo de logo enviado

function logoBuffer(variant) {
  const files = {
    transparent: "logo_transparent.png",
    watermark: "logo_watermark.png",
    footer: "logo_footer.png",
  };
  return fs.readFileSync(path.join(ASSETS_DIR, files[variant]));
}

function eyebrow(text) {
  return new Paragraph({
    border: { left: { color: DOURADO, space: 8, style: BorderStyle.SINGLE, size: 18 } },
    spacing: { after: 60 },
    children: [
      new TextRun({
        text: text.toUpperCase(), font: FONT_CORPO, size: 16,
        bold: true, color: DOURADO, characterSpacing: 30,
      }),
    ],
  });
}

function sectionTitle(text) {
  return new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text, font: FONT_TITULO, size: 44, bold: true, color: PRETO })],
  });
}

function bodyText(text) {
  return new Paragraph({
    spacing: { after: 200, line: 300 },
    children: [new TextRun({ text, font: FONT_CORPO, size: 21, color: CINZA_TEXTO })],
  });
}

function resultCard(label, text) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "D8D3C8" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "D8D3C8" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "D8D3C8" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "D8D3C8" },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    },
    rows: [new TableRow({ children: [new TableCell({
      width: { size: 100, type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.CLEAR, fill: "FAFAF7", color: "auto" },
      margins: { top: 200, bottom: 200, left: 250, right: 250 },
      children: [
        new Paragraph({ spacing: { after: 60 }, children: [
          new TextRun({ text: label.toUpperCase(), font: FONT_CORPO, size: 15, bold: true, color: DOURADO, characterSpacing: 20 }),
        ]}),
        new Paragraph({ children: [
          new TextRun({ text, font: FONT_CORPO, size: 20, bold: true, color: PRETO }),
        ]}),
      ],
    })]})],
  });
}

function darkDivider() {
  return new Paragraph({
    border: { bottom: { color: DOURADO, space: 1, style: BorderStyle.SINGLE, size: 6 } },
    spacing: { after: 300 },
    children: [],
  });
}

function footerWithLogo() {
  return new Footer({
    children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      border: { top: { color: "D8D3C8", space: 6, style: BorderStyle.SINGLE, size: 4 } },
      children: [
        new ImageRun({ data: logoBuffer("footer"), transformation: { width: 70, height: 70 * LOGO_RATIO }, type: "png" }),
        new TextRun({ text: "\tModesto Growth Partners  ·  modestogrowth.com.br", font: FONT_CORPO, size: 14, color: CINZA_TEXTO }),
      ],
    })],
  });
}

function watermarkParagraph(sizePt = 480) {
  return new Paragraph({
    children: [new ImageRun({
      data: logoBuffer("watermark"),
      transformation: { width: sizePt, height: sizePt * LOGO_RATIO },
      floating: {
        horizontalPosition: { relative: "page", align: "center" },
        verticalPosition: { relative: "page", align: "center" },
        behindDocument: true,
        wrap: { type: "none" },
      },
      type: "png",
    })],
  });
}

function coverLogo(widthPt = 260) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
    children: [new ImageRun({
      data: logoBuffer("transparent"),
      transformation: { width: widthPt, height: widthPt * LOGO_RATIO },
      type: "png",
    })],
  });
}

module.exports = {
  BEGE, PRETO, DOURADO, CINZA_TEXTO, FONT_TITULO, FONT_CORPO, LOGO_RATIO,
  eyebrow, sectionTitle, bodyText, resultCard, darkDivider,
  footerWithLogo, watermarkParagraph, coverLogo, logoBuffer,
  PageBreak,
};
