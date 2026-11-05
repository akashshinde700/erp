/**
 * ForgeERP User Manual generator (Hindi + English) — docx-js
 * Cover: Recipe R1 (Pure Paragraph Left) · Palette: DM-1 Deep Cyan (tech)
 * Sections: 1) Cover (margin 0)  2) TOC (Roman)  3) Body (Arabic from 1)
 * Run: node agent-ctx/manual/generate-manual.js
 */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, PageBreak, Header, Footer, PageNumber, NumberFormat,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  TableLayoutType, SectionType, LevelFormat, TableOfContents, VerticalAlign,
} = require("docx");
const fs = require("fs");
const path = require("path");
const { imageSize } = require("image-size");

const DIR = __dirname;
const OUT = "/home/z/my-project/ForgeERP-User-Manual.docx";

// ---------- palette (DM-1 Deep Cyan — dark cover, darkened table accent) ----------
const P = {
  bg: "162235", accent: "37DCF2",
  titleColor: "FFFFFF", subtitleColor: "B0B8C0", metaColor: "90989F", footerColor: "687078",
  body: "1A1A1A", head: "1B6B7A", secondary: "5A6B72",
  table: { headerBg: "1B6B7A", headerText: "FFFFFF", innerLine: "C8DDE2", surface: "EDF3F5" },
};

// ---------- fonts ----------
const F = { ascii: "Calibri", hAnsi: "Mangal", eastAsia: "Mangal", cs: "Mangal" };
const FH = { ascii: "Calibri", hAnsi: "Mangal", eastAsia: "SimHei", cs: "Mangal" };

const allNoBorders = {
  top: { style: BorderStyle.NONE, size: 0 }, bottom: { style: BorderStyle.NONE, size: 0 },
  left: { style: BorderStyle.NONE, size: 0 }, right: { style: BorderStyle.NONE, size: 0 },
  insideHorizontal: { style: BorderStyle.NONE, size: 0 }, insideVertical: { style: BorderStyle.NONE, size: 0 },
};
const noBorders = {
  top: { style: BorderStyle.NONE, size: 0 }, bottom: { style: BorderStyle.NONE, size: 0 },
  left: { style: BorderStyle.NONE, size: 0 }, right: { style: BorderStyle.NONE, size: 0 },
};

// ---------- cover helpers (from design-system.md) ----------
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..."，。、；：！？", ..."的与和及之在于为", ..."-_—–·/", ..." \t"]);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) {
      const limit = Math.min(remaining.length, Math.ceil(charsPerLine * 1.3));
      for (let i = charsPerLine + 1; i < limit; i++) {
        if (breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
      }
    }
    if (breakAt === -1) breakAt = charsPerLine;
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += last;
  }
  return lines;
}
function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charWidth = (pt) => pt * 20;
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) {
    lines = splitTitleLines(title, charsPerLine(minPt));
    titlePt = minPt;
  }
  return { titlePt, titleLines: lines };
}
function calcCoverSpacing(params) {
  const { titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0 } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const remainingSpace = usableHeight - contentHeight;
  const safeRemaining = Math.max(remainingSpace, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0);
  return { topSpacing, midSpacing, bottomSpacing };
}

// ---------- Recipe R1: Pure Paragraph Cover (Left-Aligned) ----------
function buildCoverR1(config) {
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };
  const children = [];
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));
  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join("  "),
        size: 18, color: P.accent, font: { ascii: "Calibri", eastAsia: "SimHei" }, characterSpacing: 40 })],
    }));
  }
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true,
        color: P.titleColor, font: { eastAsia: "SimHei", ascii: "Arial" } })],
    }));
  }
  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL }, spacing: { after: 800 },
      children: [new TextRun({ text: config.subtitle, size: 24, color: P.subtitleColor,
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial", hAnsi: "Mangal", cs: "Mangal" }, sizeComplexScript: 24 })],
    }));
  }
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({ text: line, size: 24, color: P.metaColor,
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial", hAnsi: "Mangal", cs: "Mangal" }, sizeComplexScript: 24 })],
    }));
  }
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: P.footerColor, font: { ascii: "Arial" } }),
      new TextRun({ text: "                                        " }),
      new TextRun({ text: config.footerRight || "", size: 16, color: P.footerColor, font: { ascii: "Arial" } }),
    ],
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg }, borders: noBorders,
        verticalAlign: VerticalAlign.TOP,
        children,
      })],
    })],
  })];
}

// ---------- body builders ----------
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 160, line: 340, lineRule: "atLeast" },
    children: [new TextRun({ text, bold: true, size: 32, color: P.head, font: FH, sizeComplexScript: 32, boldComplexScript: true })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120, line: 312 },
    children: [new TextRun({ text, bold: true, size: 28, color: P.head, font: FH, sizeComplexScript: 28, boldComplexScript: true })],
  });
}
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 220, after: 100, line: 312 },
    children: [new TextRun({ text, bold: true, size: 24, color: "24444D", font: FH, sizeComplexScript: 24, boldComplexScript: true })],
  });
}
/** Hindi body paragraph. parts: string | {t, b, i, mono} mixed runs */
function para(parts, opts = {}) {
  const arr = Array.isArray(parts) ? parts : [parts];
  const runs = arr.map((p) => {
    if (typeof p === "string") {
      return new TextRun({ text: p, size: 24, color: P.body, font: F, sizeComplexScript: 24 });
    }
    return new TextRun({
      text: p.t, bold: !!p.b, italics: !!p.i,
      size: p.mono ? 22 : 24, color: p.c || (p.b ? "0F4C59" : P.body),
      font: p.mono ? { ascii: "Courier New", hAnsi: "Mangal", eastAsia: "Mangal", cs: "Mangal" } : F,
      sizeComplexScript: p.mono ? 22 : 24, boldComplexScript: !!p.b,
    });
  });
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 120, line: 312 },
    children: runs, ...opts,
  });
}
/** numbered step (unique reference per list!) */
const NUM_REFS = [];
function step(ref, parts) {
  NUM_REFS.push(ref);
  const arr = Array.isArray(parts) ? parts : [parts];
  const runs = arr.map((p) => typeof p === "string"
    ? new TextRun({ text: p, size: 24, color: P.body, font: F, sizeComplexScript: 24 })
    : new TextRun({ text: p.t, bold: !!p.b, size: p.mono ? 22 : 24, color: p.c || (p.b ? "0F4C59" : P.body),
        font: p.mono ? { ascii: "Courier New", hAnsi: "Mangal", eastAsia: "Mangal", cs: "Mangal" } : F,
        sizeComplexScript: p.mono ? 22 : 24, boldComplexScript: !!p.b }));
  return new Paragraph({
    numbering: { reference: "steps-" + ref, level: 0 },
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 100, line: 312 },
    children: runs,
  });
}
/** note box (tip / warning) */
function note(kind, text) {
  const isWarn = kind === "warn";
  return new Paragraph({
    spacing: { before: 60, after: 160, line: 312 },
    indent: { left: 240 },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: isWarn ? "C0392B" : "1B6B7A", space: 10 } },
    shading: { type: ShadingType.CLEAR, fill: isWarn ? "FBF1EF" : "EDF3F5" },
    children: [
      new TextRun({ text: isWarn ? "ध्यान दें: " : "टिप: ", bold: true, size: 22,
        color: isWarn ? "8E2B20" : "0F4C59", font: F, sizeComplexScript: 22, boldComplexScript: true }),
      new TextRun({ text, size: 22, color: "333333", font: F, sizeComplexScript: 22 }),
    ],
  });
}

// ---------- figures ----------
let figNo = 0;
function figure(file, caption, displayWidth) {
  const p = path.join(DIR, file);
  const buf = fs.readFileSync(p);
  const dim = imageSize(buf);
  const w = displayWidth || 540;
  const h = Math.round(w * dim.height / dim.width);
  figNo += 1;
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 160, after: 60 },
      children: [new ImageRun({ data: buf, transformation: { width: w, height: h }, type: "png" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 200, line: 276 },
      children: [
        new TextRun({ text: "चित्र " + figNo + ": ", bold: true, size: 18, color: P.secondary, font: F, sizeComplexScript: 18, boldComplexScript: true }),
        new TextRun({ text: caption, italics: true, size: 18, color: P.secondary, font: F, sizeComplexScript: 18 }),
      ],
    }),
  ];
}

// ---------- tables ----------
function cellText(t, opts = {}) {
  return new Paragraph({
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { line: 276 },
    children: [new TextRun({
      text: String(t), bold: !!opts.b, size: opts.size || 20,
      color: opts.color || "333333", font: F, sizeComplexScript: opts.size || 20, boldComplexScript: !!opts.b,
    })],
  });
}
function makeTable(headers, rows, widths) {
  const n = headers.length;
  const w = widths || Array(n).fill(Math.floor(100 / n));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: P.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: P.table.accentLine },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine },
    },
    rows: [
      new TableRow({
        tableHeader: true, cantSplit: true,
        children: headers.map((htext, i) => new TableCell({
          width: { size: w[i], type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: P.table.headerBg },
          margins: { top: 70, bottom: 70, left: 110, right: 110 },
          children: [cellText(htext, { b: true, color: P.table.headerText, center: i > 0 })],
        })),
      }),
      ...rows.map((r, ri) => new TableRow({
        cantSplit: true,
        children: r.map((c, i) => new TableCell({
          width: { size: w[i], type: WidthType.PERCENTAGE },
          shading: ri % 2 === 1 ? { type: ShadingType.CLEAR, fill: P.table.surface } : undefined,
          margins: { top: 60, bottom: 60, left: 110, right: 110 },
          children: [cellText(c, { center: i > 0 })],
        })),
      })),
    ],
  });
}
function tableTitle(text) {
  return new Paragraph({
    keepNext: true, spacing: { before: 160, after: 80 },
    children: [new TextRun({ text, bold: true, size: 21, color: "0F4C59", font: F, sizeComplexScript: 21, boldComplexScript: true })],
  });
}

// ============================  BODY CONTENT  ============================
const body = [];

// ---- 1. परिचय ----
body.push(h1("1. परिचय (Introduction)"));
body.push(para([
  { t: "ForgeERP", b: true }, " एक पूर्ण भारतीय ",
  { t: "manufacturing · jobwork · GST ERP", b: true },
  " सॉफ्टवेयर है, जो छोटी और मध्यम श्रेणी की फैक्ट्रियों (MSME) के रोज़मर्रा के काम को एक ही जगह चलाता है — ग्राहक का माल अंदर लेने से लेकर जॉब वर्क प्रोसेस, सर्टिफिकेट, GST टैक्स इनवॉइस, पेमेंट, स्टॉक, बहीखाता और ",
  { t: "Tally", b: true }, " में एक्सपोर्ट तक।",
]));
body.push(para([
  "यह गाइड पूरे सॉफ्टवेयर को इस्तेमाल करने का तरीका स्क्रीन-शॉट और स्टेप-बाय-स्टेप निर्देशों के साथ बताती है। हर उदाहरण में असली डेटा इस्तेमाल हुआ है — जैसे इनवॉइस ",
  { t: "INV-2627-005", mono: true }, " (₹7,552), पार्टी ",
  { t: "CUST-004 Nashik Steel Traders", mono: true },
  " और जॉबवर्क चेन ", { t: "JWI-2627-002 → CERT-2627-002", mono: true }, " — ये सब इसी मैनुअल बनाते समय ऐप में जोड़े गए रिकॉर्ड हैं।",
]));
body.push(tableTitle("मॉड्यूल एक नज़र में (12 modules)"));
body.push(makeTable(
  ["मॉड्यूल", "काम"],
  [
    ["Dashboard", "KPI, ध्यान देने वाली चीज़ें (attention panel), quick actions"],
    ["Sales", "GST टैक्स इनवॉइस — stock ledger और double-entry GL के साथ"],
    ["Purchase", "सप्लायर इनवॉइस — GRN और स्टॉक-इन"],
    ["Jobwork", "Inward → Job Card → Certificate → Invoice — पूरी जॉबवर्क चेन"],
    ["Inventory", "Stock Summary, Stock Ledger, Opening Stock"],
    ["Accounting", "Payments, Party Ledger, running balance"],
    ["Reports", "GSTR-1, Trial Balance, Outstanding, Stock"],
    ["Masters", "Parties, Items, Warehouses, Processes, Party Rates, Company"],
    ["Tally Export", "Masters XML, Voucher XML/JSON/CSV, .bat importer, e-Invoice JSON"],
    ["Audit Trail", "हर एक्शन का रिकॉर्ड — किसने, कब, क्या"],
    ["Platform Admin", "SaaS — orgs, plans, trial/suspend"],
    ["Docs", "इन-ऐप डॉक्यूमेंटेशन"],
  ],
  [22, 78],
));
body.push(...figure("01-dashboard.png", "Dashboard — KPI cards, attention panel और quick action buttons"));

// ---- 2. शुरुआत ----
body.push(h1("2. ऐप खोलना और नेविगेशन (Getting Started)"));
body.push(para([
  "ऐप ब्राउज़र में खुलता है — कोई अलग इंस्टॉल नहीं। बाईं तरफ साइडबार में सभी 12 मॉड्यूल दिखते हैं; किसी भी मॉड्यूल पर क्लिक करें और वह स्क्रीन खुल जाती है। ऊपर बाईं तरफ ",
  { t: "ForgeERP", b: true }, " लोगो, दाईं तरफ सर्च के लिए ",
  { t: "Ctrl + K", b: true }, " कमांड पैलेट है।",
]));
body.push(tableTitle("कीबोर्ड शॉर्टकट"));
body.push(makeTable(
  ["कीज़", "क्या होगा"],
  [
    ["Ctrl / ⌘ + K", "Command palette — कहीं से भी कुछ भी खोजें/खोलें"],
    ["/", "Command palette खोलें"],
    ["g फिर d/s/p/j/i/a/r/m/t/u/o", "उस मॉड्यूल पर जाएँ (Gmail स्टाइल)"],
    ["Alt + S", "नया Sales Invoice (कहीं से भी)"],
    ["Alt + P", "नया Purchase Invoice (कहीं से भी)"],
    ["Alt + T", "Notifications देखें"],
    ["?", "शॉर्टकट हेल्प डायलॉग"],
  ],
  [34, 66],
));
body.push(para([
  "सर्च बॉक्स में पार्टी, आइटम या इनवॉइस नंबर टाइप करते ही नतीजे आते हैं — उदाहरण में ",
  { t: "inward", mono: true }, " टाइप करने पर जॉबवर्क स्क्रीन और रिलेटेड रिकॉर्ड नज़र आ रहे हैं।",
]));
body.push(...figure("32-command-palette.png", "Command Palette (Ctrl+K) — ग्लोबल सर्च और quick jump"));
body.push(para([
  "मोबाइल या छोटी स्क्रीन पर साइडबार एक ", { t: "drawer", b: true },
  " में बदल जाती है — बाईं तरफ ऊपर ☰ बटन दबाएँ और मॉड्यूल लिस्ट खुल जाएगी। पूरा ऐप 390px तक बिना किसी horizontal scroll के चलता है।",
]));
body.push(...figure("35-mobile-drawer.png", "मोबाइल (390px) — drawer नेविगेशन", 240));

// ---- 3. Masters ----
body.push(h1("3. Masters — पार्टी और आइटम"));
body.push(para([
  "कोई भी ट्रांज़ैक्शन करने से पहले ", { t: "Masters", b: true },
  " में पार्टी और आइटम बना लें। इसी मैनुअल के उदाहरण में हमने नई पार्टी ",
  { t: "CUST-004 — Nashik Steel Traders", b: true }, " बनाई।",
]));
body.push(h2("3.1 नई पार्टी बनाना"));
body.push(step("party", ["Masters → Parties टैब खोलें → ", { t: "New Party", b: true }, " बटन दबाएँ।"]));
body.push(step("party", [{ t: "Code", b: true }, " (जैसे CUST-004) और ", { t: "Name", b: true }, " भरें — दोनों ज़रूरी हैं।"]));
body.push(step("party", [{ t: "Types", b: true }, " में चुनें: CUSTOMER (बिक्री), SUPPLIER (खरीद), JOBWORKER — एक साथ कई भी चुन सकते हैं।"]));
body.push(step("party", [{ t: "GSTIN", b: true }, " भरें (15 अक्षर, जैसे 27AAANF4821K1Z0) — checksum अपने आप जाँचा जाता है।"]));
body.push(step("party", ["State, Address, City, Pincode (6 अंक), Phone, Email भरें।"]));
body.push(step("party", [{ t: "Create party", b: true }, " दबाएँ — पार्टी लिस्ट में आ जाती है।"]));
body.push(note("warn",
  "GSTIN का आख़िरी अक्षर checksum होता है। गलत अक्षर डालने पर ऐप मना कर देगा — Invalid GSTIN — checksum failed। अगले सेक्शन के e-Invoice के लिए GSTIN और 6-अंकीय pincode ज़रूरी हैं।"));
body.push(...figure("25-masters-parties.png", "Masters → Parties — कोड, नाम, GSTIN, state और types के साथ पूरी लिस्ट"));
body.push(...figure("26-new-party-form.png", "New Party फॉर्म — CUST-004 Nashik Steel Traders भरते हुए"));
body.push(h2("3.2 Items"));
body.push(para([
  "Items टैब में हर आइटम का ", { t: "HSN code", b: true }, " (6/8 अंक), ",
  { t: "UOM", b: true }, " (PCS, KGS), ", { t: "reorder level", b: true },
  " और rate रहते हैं। HSN सही होना ज़रूरी है — e-Invoice JSON में 4-अंकीय HSN वाली लाइन रिजेक्ट हो जाती है।",
]));
body.push(...figure("27-masters-items.png", "Masters → Items — HSN, UOM, reorder level के साथ"));

// ---- 4. Sales ----
body.push(h1("4. Sales — GST टैक्स इनवॉइस बनाना"));
body.push(para([
  "Sales मॉड्यूल में ", { t: "New Invoice", b: true },
  " दबाने पर इनवॉइस फॉर्म खुलता है। एक बार Post करने पर इनवॉइस, स्टॉक लेजर और बहीखाता (double-entry GL) — तीनों एक साथ बनते हैं; आधा-अधूरा कोई रिकॉर्ड नहीं छूटता।",
]));
body.push(h2("4.1 नई इनवॉइस — स्टेप बाय स्टेप"));
body.push(step("inv", ["Sales → ", { t: "New Invoice", b: true }, " दबाएँ।"]));
body.push(step("inv", [{ t: "Customer", b: true }, " चुनें — Place of Supply पार्टी के state से अपने आप सेट हो जाता है।"]));
body.push(step("inv", ["Date, PO/Challan No, warehouse चेक करें। ", { t: "Tax inclusive", b: true }, " स्विच से तय होता है कि रेट में GST शामिल है या नहीं।"]));
body.push(step("inv", ["लाइन में ", { t: "Item", b: true }, " चुनें, ", { t: "Qty", b: true }, " और ", { t: "Rate ₹", b: true }, " भरें; ", { t: "Disc %", b: true }, " से डिस्काउंट, detail से विवरण।"]));
body.push(step("inv", [{ t: "Add line", b: true }, " से और आइटम जोड़ें — totals लाइव अपडेट होते हैं।"]));
body.push(step("inv", [{ t: "Post Invoice", b: true }, " दबाएँ — इनवॉइस नंबर अपने आप बनता है।"]));
body.push(para([
  "उदाहरण: ", { t: "INV-2627-005", mono: true }, " में ", { t: "Flange DN50 SS316", b: true },
  " 10 पीस × ₹640 = ₹6,400 taxable, CGST+SGST 18% जुड़कर कुल ₹7,552 बने।",
]));
body.push(note("warn",
  "जिस आइटम का स्टॉक नहीं है उसे बेचा नहीं जा सकता — ऐप बताता है: Insufficient stock। पहले Purchase इनवॉइस या Opening Stock से स्टॉक अंदर लाएँ।"));
body.push(...figure("03-new-invoice-form.png", "नई इनवॉइस फॉर्म — customer, date, lines और totals"));
body.push(...figure("04-invoice-filled.png", "भरी हुई इनवॉइस — लाइन आइटम, qty 10, rate ₹640, totals लाइव"));
body.push(...figure("05-sales-list-after.png", "Post के बाद Sales लिस्ट — INV-2627-005 ऊपर दिख रहा है"));
body.push(h2("4.2 इनवॉइस डिटेल — View / Print / Payment / Tally"));
body.push(para([
  "लिस्ट में किसी भी इनवॉइस पर क्लिक करें — डिटेल स्क्रीन में ऊपर ",
  { t: "Receive Payment", b: true }, ", ", { t: "Duplicate", b: true }, ", ", { t: "Tally", b: true },
  " और ", { t: "Print", b: true },  " बटन मिलते हैं। Print बटन A4 print-views इनवॉइस खोलता है — IRN/QR वाली गुलाबी GST इनवॉइस भी।",
]));
body.push(...figure("06-invoice-detail.png", "इनवॉइस डिटेल — पूरा ब्रेकअप और एक्शन बटन (Receive Payment ₹7,552)"));

// ---- 5. Payment ----
body.push(h1("5. Payment — पैसा आया/गया रिकॉर्ड करना"));
body.push(step("pay", ["इनवॉइस डिटेल पर ", { t: "Receive Payment", b: true }, " दबाएँ (या Accounting → New Payment)।"]));
body.push(step("pay", ["Amount भरें — allocation लिस्ट में खुली इनवॉइस पर अपने आप बँट जाता है; आप मैन्युअली भी बाँट सकते हैं।"]));
body.push(step("pay", [{ t: "Post Payment", b: true }, " — डबल-एंट्री GL बनता है (Cash/Bank डेबिट, पार्टी क्रेडिट) और इनवॉइस का balance घटता है।"]));
body.push(para([
  "उदाहरण में INV-2627-005 की पूरी ₹7,552 एक ही पेमेंट में रिसीव हुई — paid आधा-अधूरा कभी नहीं रहता।",
]));
body.push(...figure("08-payment-dialog.png", "Receive Payment डायलॉग — amount और invoice-wise allocation"));

// ---- 6. Jobwork ----
body.push(h1("6. Jobwork — पूरी जॉबवर्क चेन (यह ऐप की सबसे खास सुविधा है)"));
body.push(para([
  "फाउंड्री/मशीनिंग शॉप का असली फ्लो: ग्राहक अपना कच्चा माल देता है → आप उस पर प्रोसेस चलाते हैं → सर्टिफिकेट (टेस्ट सर्टिफिकेट/QR) बनता है → और सिर्फ़ ",
  { t: "सर्विस चार्ज", b: true }, " की GST इनवॉइस काटी जाती है। ForgeERP में यह चार कदमों की चेन है:",
]));
body.push(makeTable(
  ["कदम", "स्क्रीन", "क्या बनता है"],
  [
    ["1. Inward", "Jobwork → Inwards → New Inward", "ग्राहक का माल — value-neutral स्टॉक में अंदर"],
    ["2. Job Card", "इनवॉर्ड डिटेल → New Job Card", "कौन-से प्रोसेस, कितनी qty — काम का ऑर्डर"],
    ["3. Certificate", "Job Card COMPLETED → Issue Certificate", "CERT-… सर्टिफिकेट, ग्राहक को जाने वाला दस्तावेज़"],
    ["4. Invoice", "Certificate के बाद → Generate Invoice", "सिर्फ़ जॉबवर्क चार्ज की GST इनवॉइस (सामान नहीं)"],
  ],
  [16, 34, 50],
));
body.push(h2("6.1 Inward दर्ज करना"));
body.push(step("jw", ["Jobwork → ", { t: "New Inward", b: true }, " — पार्टी, challan no, गोदाम और आइटम qty/weight भरें।"]));
body.push(step("jw", ["Post करते ही माल ", { t: "customer-owned", b: true }, " स्टॉक में आ जाता है — यह हमारी कीमत की बही में नहीं गिना जाता (value-neutral)।"]));
body.push(...figure("11-jobwork-inwards.png", "Jobwork → Inwards — ग्राहक का अंदर आया माल"));
body.push(...figure("12-jobwork-pending.png", "Pending टैब — कौन-सा काम अधूरा है (कौन-सा इनवॉर्ड अभी invoice नहीं हुआ)"));
body.push(h2("6.2 Job Card — प्रोसेस का काम"));
body.push(step("jc", ["इनवॉर्ड डिटेल खोलें → ", { t: "New Job Card", b: true }, "।"]));
body.push(step("jc", ["आइटम चुनें (partial qty भी चलती है) और प्रोसेस पकड़ाएँ — Shot Blasting, Heat Treatment, CNC Machining, Quality Check & NDT, Packing & Marking आदि।"]));
body.push(step("jc", ["Rate पार्टी-rate से अपने आप आती है, नहीं तो प्रोसेस डिफ़ॉल्ट — नीचे estimate लाइव दिखता है।"]));
body.push(step("jc", [{ t: "Post Job Card", b: true }, " — काम COMPLETED होने पर Issue Certificate बटन चालू हो जाता है।"]));
body.push(...figure("13-jobwork-inward-detail.png", "इनवॉर्ड डिटेल — New Job Card / Issue Certificate / Generate Invoice बटन चेन"));
body.push(...figure("14-job-card-form.png", "Job Card फॉर्म — आइटम qty और प्रोसेस चुनने के साथ estimate"));
body.push(...figure("15-job-card-completed.png", "JWI-2627-002 COMPLETED — अब सर्टिफिकेट जारी हो सकता है"));
body.push(h2("6.3 Certificate और इनवॉइस"));
body.push(step("cert", [{ t: "Issue Certificate", b: true }, " दबाएँ — CERT-2627-002 बनता है।"]));
body.push(step("cert", [{ t: "Generate Invoice", b: true }, " — जॉबवर्क चार्ज की GST इनवॉइस बन जाती है (माल की कीमत नहीं, सिर्फ़ सर्विस)।"]));
body.push(step("cert", ["इनवॉइस बनते ही pending लिस्ट से इनवॉर्ड हट जाता है — चेन पूरी।"]));
body.push(...figure("16-certificate.png", "Certificate CERT-2627-002 — जॉबवर्क का पूरा ब्यौरा"));
body.push(...figure("17-jobwork-invoice-generated.png", "Generate Invoice के बाद — चेन पूरी, ग्राहक को सिर्फ़ चार्ज की इनवॉइस"));
body.push(note("tip",
  "चेन में अगला बटन तभी चालू होता है जब पिछला कदम पूरा हो — ग़लती से स्किप करना नामुमकिन।"));

// ---- 7. Purchase ----
body.push(h1("7. Purchase — खरीद की इनवॉइस"));
body.push(para([
  "Purchase वैसी ही फॉर्म है, बस सप्लायर के साथ। Post करने पर स्टॉक अंदर आता है और GRNI (Goods Received Not Invoiced) अकाउंटिंग भी सही रहती है। ऊपर दिए जॉबवर्क इनवॉइस बनाने के लिए भी स्टॉक यहीं से आता है।",
]));
body.push(...figure("20-purchase.png", "Purchase Invoices — सप्लायर, taxable और tax के साथ लिस्ट"));

// ---- 8. Inventory ----
body.push(h1("8. Inventory — स्टॉक"));
body.push(para([
  { t: "Stock Summary", b: true }, " में हर आइटम का closing qty, avg cost और reorder level; ",
  { t: "Stock Ledger", b: true }, " में हर इन/आउट मूवमेंट — कौन-सी इनवॉइस से आया, कहाँ गया। ",
  { t: "Opening Stock", b: true }, " से शुरुआती स्टॉक (godown-wise) दर्ज होता है।",
]));
body.push(...figure("18-inventory.png", "Stock Summary — closing value, reorder level violations नारा-ए-अलार्ट"));
body.push(...figure("19-stock-ledger.png", "Stock Ledger — आइटम की हर मूवमेंट"));

// ---- 9. Accounting ----
body.push(h1("9. Accounting — बहीखाता"));
body.push(para([
  "हर payment/receipt डबल-एंट्री जर्नल बनाता है — कभी भी Trial Balance खोलकर देखें, डेबिट=क्रेडिट हमेशा। ",
  { t: "Party Ledger", b: true }, " में पार्टी का पूरा हिसाब चलती balance के साथ मिलता है।",
]));
body.push(...figure("09-accounting-payments.png", "Accounting → Payments — रिसीव/पे दोनों, allocation सहित"));
body.push(...figure("10-party-ledger.png", "Party Ledger — पार्टी का running balance वाला पूरा हिसाब"));

// ---- 10. Reports ----
body.push(h1("10. Reports — GSTR-1 और बाकी"));
body.push(para([
  "Reports मॉड्यूल में तीन टैब: ", { t: "GSTR-1", b: true }, " (B2B/B2C बिक्री का GST ब्यौरा — फाइलिंग के लिए), ",
  { t: "Trial Balance", b: true }, " (हर अकाउंट का डेबिट/क्रेडिट balance), ",
  { t: "Outstanding", b: true }, " (किसको कितना देना/लेना)। साथ ही Stock Summary report।",
]));
body.push(...figure("22-gstr1-report.png", "GSTR-1 report — posted B2B बिक्री, CGST/SGST/IGST कॉलम"));
body.push(...figure("23-outstanding-report.png", "Outstanding report — receivables और payables"));
body.push(...figure("24-trial-balance.png", "Trial Balance — डेबिट = क्रेडिट, हमेशा"));

// ---- 11. Tally + e-Invoice ----
body.push(h1("11. Tally Export और e-Invoice JSON (GST पोर्टल)"));
body.push(para([
  "हिसाब जहाँ रहता है वहाँ भेजें: हर डॉक्यूमेंट से ", { t: "Tally", b: true },
  " ड्रॉपडाउन खोलें — नीचे वही मेन्यू मिलेगा जो साथ वाले टूल्स में दिखता है।",
]));
body.push(makeTable(
  ["मेन्यू आइटम", "क्या देता है"],
  [
    ["Tally XML (import file)", "उस एक डॉक्यूमेंट का Tally XML"],
    ["Tally JSON", "वही वाउचर JSON फ़ाइल में"],
    ["Tally Excel (CSV)", "Excel में खोलने लायक CSV"],
    ["Tally importer (.bat)", "Windows बैच फ़ाइल — फ़ोल्डर की सारी XML एक क्लिक में Tally में"],
    ["Tally masters (XML)", "पहले इम्पोर्ट करें — लेजर बन जाते हैं, फिर वाउचर कभी fail नहीं"],
    ["Queue for Tally connector", "कनेक्टर अपने आप ले जाएगा"],
    ["Mark as sent to Tally", "मैन्युअली भेजा हो तो निशानी"],
    ["e-Invoice JSON (GST portal)", "IRP v1.1 JSON + GST पोर्टल की Bulk Upload साइट अपने आप खुलती है"],
  ],
  [34, 66],
));
body.push(...figure("07-tally-dropdown.png", "इनवॉइस का Tally मेन्यू — XML/JSON/CSV, .bat, masters, e-Invoice JSON"));
body.push(h2("11.1 e-Invoice JSON — स्टेप बाय स्टेप"));
body.push(step("ei", ["इनवॉइस पर ", { t: "Tally → e-Invoice JSON (GST portal)", b: true }, " दबाएँ।"]));
body.push(step("ei", ["JSON डाउनलोड होता है (जैसे INV-2627-003_einvoice.json) और साथ ही GST पोर्टल का ", { t: "Bulk Upload", b: true }, " पेज नए टैब में खुलता है।"]));
body.push(step("ei", ["पोर्टल पर लॉगिन करें → e-Invoice → Upload JSON → यही फ़ाइल अपलोड करें → IRN बनता है।"]));
body.push(step("ei", ["Bulk के लिए: Tally Export मॉड्यूल → तारीख़ रेंज → ", { t: "Download bulk IRP JSON", b: true }, " — पूरे महीने की एक फ़ाइल।"]));
body.push(note("warn",
  "कमज़ोर डॉक्यूमेंट पोर्टल तक जाते ही नहीं: बिना ग्राहक GSTIN, बिना 6-अंकीय pincode, 4-अंकीय HSN या गलत जोड़ वाली इनवॉइस जाँच में रुक जाती है और reason टोस्ट में दिखता है। 30 दिन से पुरानी इनवॉइस पर warning मिलती है।"));
body.push(...figure("28-tally-export.png", "Tally Export मॉड्यूल — masters, bulk voucher, bulk IRP JSON, connector, .bat", 480));

// ---- 12. Platform Admin ----
body.push(h1("12. Platform Admin (SaaS कंसोल)"));
body.push(para([
  "Platform Admin मॉड्यूल सारी कंपनियों (orgs) को एक जगह देखता है — plans, trial, suspension, मर्द-ए-आँकड़े (MRR, usage)। डेमो में key ",
  { t: "forge-admin", mono: true }, " है।",
]));
body.push(...figure("30-platform-admin-gate.png", "Platform Admin — key गेट (demo key: forge-admin)"));
body.push(...figure("31-platform-admin.png", "Platform Admin कंसोल — orgs, plans, trial/suspend एक्शन"));

// ---- 13. Audit ----
body.push(h1("13. Audit Trail — हर हरकत का रिकॉर्ड"));
body.push(para([
  "कौन कब क्या बनाया/बदलाव/डिलीट/एक्सपोर्ट किया — सब ", { t: "Audit Trail", b: true },
  " में। इनवॉइस बनाने से e-Invoice JSON एक्सपोर्ट तक, हर एक्शन अपने आप लिखा जाता है।",
]));
body.push(...figure("29-audit-trail.png", "Audit Trail — action, entity, details, timestamp"));

// ---- 14. Mobile ----
body.push(h1("14. मोबाइल से इस्तेमाल"));
body.push(para([
  "फ़ोन (390px) पर पूरा ऐप चलता है — बिना horizontal scroll, drawer नेविगेशन के साथ। फैक्टरी फ़्लोर से ही इनवॉइस/पेमेंट दर्ज की जा सकती है।",
]));
body.push(...figure("34-mobile-dashboard.png", "मोबाइल डैशबोर्ड — KPI cards एक-एक करके स्टैक", 230));

// ---- 15. Playwright tests ----
body.push(h1("15. Playwright E2E टेस्ट — पूरी रिपोर्ट"));
body.push(para([
  "इस मैनुअल के साथ पूरे ऐप का ऑटोमेटेड टेस्ट चलाया गया (Playwright 1.57, Chromium, फ़ाइल ",
  { t: "tests/e2e_playwright.py", mono: true }, ")। नतीजा: ",
  { t: "49 / 49 टेस्ट PASS", b: true }, " — एक भी fail नहीं, console में एक भी error नहीं।",
]));
body.push(tableTitle("टेस्ट रिपोर्ट — 16 ग्रुप्स, 49 टेस्ट"));
body.push(makeTable(
  ["ग्रुप", "टेस्ट", "नतीजा"],
  [
    ["App load", "title, nav, KPI", "PASS"],
    ["12 modules", "सब हेडिंग लोड", "PASS"],
    ["Sales data", "6 posted invoices, INV-2627-005", "PASS"],
    ["Tally dropdown", "सब 7 मेन्यू आइटम", "PASS"],
    ["e-Invoice JSON", "सिंगल फ़ाइल + bulk + preview", "PASS"],
    ["Tally exports", "voucher XML + masters XML", "PASS"],
    ["Jobwork chain", "inwards + CERT-2627-002", "PASS"],
    ["Reports", "GSTR-1 / Trial Balance / Outstanding", "PASS"],
    ["Accounting", "payment ₹7,552 recorded", "PASS"],
    ["Masters", "CUST-004 Nashik Steel Traders", "PASS"],
    ["Palette & search", "Ctrl+K + /api/search", "PASS"],
    ["Audit trail", "सेशन के एक्शन लॉग", "PASS"],
    ["Platform admin", "key gate + unlock", "PASS"],
    ["Mobile 390px", "no overflow + drawer", "PASS"],
    ["Sticky footer", "gap = 0px", "PASS"],
    ["Console", "zero errors", "PASS"],
  ],
  [30, 50, 20],
));

// ---- 16. Troubleshooting ----
body.push(h1("16. समस्या निवारण (Troubleshooting)"));
body.push(makeTable(
  ["समस्या", "कारण और इलाज"],
  [
    ["Invalid GSTIN — checksum failed", "आख़िरी अक्षर गलत — सही 15वें अक्षर के साथ दोबारा भरें"],
    ["Insufficient stock for item", "उस आइटम का स्टॉक ख़त्म — पहले Purchase/Opening Stock से भरें"],
    ["e-Invoice JSON नहीं बन रहा", "ग्राहक GSTIN गायब, pincode गायब या HSN 4-अंकीय — Masters में ठीक करें"],
    ["Tally में Ledger not found", "पहले Tally masters (XML) इम्पोर्ट करें, उसके बाद वाउचर"],
    ["GST पोर्टल टैब नहीं खुला", "ब्राउज़र popup block — allow करें; JSON डाउनलोड फिर भी हो चुका होता है"],
    ["एक ही वाउचर दो बार गया", "नहीं जाता — REMOTEID वाला दोबारा इम्पोर्ट अपडेट करता है, duplicate नहीं"],
  ],
  [40, 60],
));
body.push(para([
  "इसके अलावा ऐप के अंदर ही ", { t: "Docs", b: true },
  " मॉड्यूल में पूरा रेफ़रेंस है — reverse-engineering notes से लेकर हर फ़ील्ड की ख़ास बात तक।",
]));
body.push(...figure("33-docs.png", "Docs मॉड्यूल — इन-ऐप पूरा रेफ़रेंस", 300));

// ============================  DOCUMENT  ============================
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

function pageFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "888888", font: { ascii: "Calibri" } })],
    })],
  });
}
function docHeader() {
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine, space: 4 } },
      children: [new TextRun({ text: "ForgeERP — User Manual (हिंदी)", size: 16, color: "999999", font: F, sizeComplexScript: 16 })],
    })],
  });
}

const numberingConfig = [...new Set(NUM_REFS)].map((ref) => ({
  reference: "steps-" + ref,
  levels: [{
    level: 0, format: LevelFormat.DECIMAL, text: "%1.",
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 640, hanging: 360 } }, run: { font: F } },
  }],
}));

const doc = new Document({
  creator: "ForgeERP",
  title: "ForgeERP User Manual",
  styles: {
    default: {
      document: {
        run: { font: F, size: 24, color: P.body },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: { run: { font: FH, size: 32, bold: true, color: P.head }, paragraph: { spacing: { before: 400, after: 160 }, outlineLevel: 0 } },
      heading2: { run: { font: FH, size: 28, bold: true, color: P.head }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
      heading3: { run: { font: FH, size: 24, bold: true, color: "24444D" }, paragraph: { spacing: { before: 220, after: 100 }, outlineLevel: 2 } },
    },
  },
  numbering: { config: numberingConfig },
  sections: [
    // -------- Section 1: Cover (margin 0, no footer, no page numbers) --------
    {
      properties: {
        page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
      },
      children: buildCoverR1({
        title: "ForgeERP User Manual",
        subtitle: "Manufacturing · Jobwork · GST ERP — पूरी गाइड हिंदी में",
        englishLabel: "USER GUIDE",
        metaLines: [
          "संस्करण 1.0 — 06 नवंबर 2026",
          "12 मॉड्यूल · 36 स्क्रीन-शॉट · स्टेप-बाय-स्टेप निर्देश",
          "उदाहरण-डेटा सहित: INV-2627-005 · CERT-2627-002 · CUST-004",
          "Playwright E2E: 49/49 पास",
        ],
        footerLeft: "Shree Forge Industries — ForgeERP",
        footerRight: "2026",
      }),
    },
    // -------- Section 2: TOC (Roman) --------
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      footers: { default: pageFooter() },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 480, after: 360 },
          children: [new TextRun({ text: "विषय-सूची", bold: true, size: 32, color: P.head, font: FH, sizeComplexScript: 32, boldComplexScript: true })],
        }),
        new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" }),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({
            text: "नोट: यह विषय-सूची field-code से बनी है। एडिट करने के बाद पेज नंबर ताज़ा करने के लिए इस पर राइट-क्लिक करके Update Field चुनें।",
            italics: true, size: 18, color: "888888", font: F, sizeComplexScript: 18,
          })],
        }),
        // NOTE: no trailing PageBreak — body starts a NEXT_PAGE section (double break = blank page)
      ],
    },
    // -------- Section 3: Body (Arabic from 1) --------
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: docHeader() },
      footers: { default: pageFooter() },
      children: body,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log("WROTE", OUT, buf.length, "bytes ·", figNo, "figures ·", NUM_REFS.length, "steps");
});
