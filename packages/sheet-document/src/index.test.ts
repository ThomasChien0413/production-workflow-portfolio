import { describe, expect, it } from "vitest";
import {
  cutProcessingOrderV1,
  cutProcessingOrderV2,
  cutCustomerOrderDaYinV1,
  cutCustomerOrderShihlinV1,
  cutCustomerOrderShihlinV2,
  cutAnnealingListV2,
  cutCustomerOrderV1,
  cutCharacteristicInspectionShintaiV1,
  cutCharacteristicInspectionShintaiV2,
  cutCharacteristicInspectionV2,
  cutCharacteristicInspectionSongmaoV1,
  cutCharacteristicInspectionV1,
  cutDailyReportV1,
  cutFactoryInspectionChiaoliV1,
  cutFinishedInspectionV1,
  cutFinishedInspectionV2,
  cutPatrolInspectionV1,
  cutFiringQualityRecordV1,
  cutPersonalDailyReportV1,
  cutProductionBoardV1,
  flatShearCuttingRequestV1,
  slittingKnifeLayoutV1,
  slittingProductionOrderV1,
  slittingProductionOrderV2,
  slittingRequestV1,
  slittingRequestV2,
  stampingEiCustomerOrderV1,
  stampingDailyReportV1,
  stampingProductDemandV1,
  warehouseLocationIntakeV1,
} from "@workflow/contracts";
import {
  PDF_WATERMARK_LABEL,
  buildSheetDocumentModel,
  escapeHtml,
  flattenSheetValues,
  renderSheetDocumentHtml,
} from "./index.js";

// The stylesheet names these classes too, so tests that need the position of
// the grid itself anchor on its opening tag rather than on the class name.
const GRID_START = '<table class="grid fixed-rows"';

describe("sheet document model", () => {
  it("flattens every persisted value shape without losing scalar values", () => {
    expect(
      Object.fromEntries(
        flattenSheetValues({
          date: "2026-08-11",
          rows: [{ material: "SUS304" }],
          checks: { flatness: { coil1: "良" } },
          count: 3,
        }),
      ),
    ).toEqual({
      date: "2026-08-11",
      "rows.0.material": "SUS304",
      "checks.flatness.coil1": "良",
      count: "3",
    });
  });

  it("shares the same section selection facts used by web and PDF", () => {
    const model = buildSheetDocumentModel(slittingRequestV1, {});
    expect(model.headerSection?.type).toBe("FIELDS");
    expect(model.rowSection?.type).toBe("FIXED_ROWS");
    expect(model.approvalSection?.type).toBe("APPROVAL_STATUS");
    expect(model.documentAtTop).toBe(true);
    expect(model.headerLayout).toBe("DATE_TITLE_DOCUMENT");
    expect(model.printLayout.orientation).toBe("LANDSCAPE");
  });

  it("renders legacy v1 and explicit v2 layout metadata identically", () => {
    const render = (definition: typeof slittingRequestV1) =>
      renderSheetDocumentHtml({ definition, values: {}, state: "DRAFT" });
    expect(render(slittingRequestV1)).toBe(render(slittingRequestV2));

    const legacyOrder = renderSheetDocumentHtml({
      definition: slittingProductionOrderV1,
      values: {},
      state: "IN_PROGRESS",
    });
    const explicitOrder = renderSheetDocumentHtml({
      definition: slittingProductionOrderV2,
      values: {},
      state: "IN_PROGRESS",
    });
    expect(legacyOrder).toBe(explicitOrder);
    expect(legacyOrder).toContain('class="header title-only"');
  });
});

describe("print-faithful HTML", () => {
  it("renders all current section structures and escapes production values", () => {
    const malicious = '<script>alert("x")</script> & 鋼材';
    const request = renderSheetDocumentHtml({
      definition: slittingRequestV1,
      values: { requestDate: "2026-08-11", items: [{ specification: malicious }] },
      state: "DRAFT",
    });
    const order = renderSheetDocumentHtml({
      definition: slittingProductionOrderV1,
      values: {},
      state: "IN_PROGRESS",
    });
    const knife = renderSheetDocumentHtml({
      definition: slittingKnifeLayoutV1,
      values: {},
      state: "COMPLETED",
    });

    expect(request).toContain("分條申請單");
    expect(request).toContain("草稿");
    expect(request).toContain(escapeHtml(malicious));
    expect(request).not.toContain(malicious);
    expect(order).toContain("matrix");
    expect(order).toContain("blanks");
    expect(order).toContain("生產中");
    expect(knife).toContain("A4 portrait");
    expect(knife).not.toContain('class="watermark"');
  });

  it("fills only recorded workflow signatures", () => {
    const html = renderSheetDocumentHtml({
      definition: slittingRequestV1,
      values: {},
      state: "PENDING_ASSOCIATE",
      signatures: {
        ORIGIN_MANAGER: { displayName: "分條主管", decidedAt: "2026/08/11 09:00" },
        SALES: { displayName: "業務人員", decidedAt: "2026/08/11 09:15" },
      },
    });
    expect(html).toContain("分條主管");
    expect(html).toContain("業務人員");
    expect(html).not.toContain("協理人員");
  });

  it("prints 裁剪需求表's header as the paper wraps it", () => {
    const html = renderSheetDocumentHtml({
      definition: flatShearCuttingRequestV1,
      values: { customerName: "台電", deliveryDate: "2026-09-01" },
      state: "DRAFT",
    });
    const header = html.slice(
      html.indexOf('<table class="grid band fields-wrapped">'),
      html.indexOf(GRID_START),
    );
    // One table per printed row, so each sizes to its own words rather than
    // to the longest label on the form.
    expect(header.match(/<table class="grid band fields-wrapped">/g)).toHaveLength(3);
    expect(header.match(/<tr>/g)).toHaveLength(3);
    // A short row fills its own table, so it needs no padding cell.
    expect(header).not.toContain("colspan");
    expect(header).toContain("台電");
    expect(header).toContain("2026-09-01");
  });

  it("inlines the drawings rather than linking to them", () => {
    const html = renderSheetDocumentHtml({
      definition: flatShearCuttingRequestV1,
      values: {},
      state: "DRAFT",
    });
    // The renderer aborts every request but `data:`, so a linked image would
    // print as a blank box and nothing would say why.
    expect(html).toContain("積鐵芯疊法");
    expect(html.match(/<img src="data:image\//g)).toHaveLength(3);
    expect(html).not.toContain('src="/templates/');
    expect(html).toContain("主鐵芯(一)");
  });

  it("prints EI客戶訂購表 without a row-number column", () => {
    const html = renderSheetDocumentHtml({
      definition: stampingEiCustomerOrderV1,
      values: { orders: [{ customer: "台電", quantity: "120" }] },
      state: "DRAFT",
    });
    const grid = html.slice(html.indexOf('class="grid fixed-rows"'));
    // Seven columns, seven widths, and no eighth cell holding a serial number.
    expect(grid.match(/<col /g)).toHaveLength(7);
    expect(grid).not.toContain('class="number"');
    expect(grid).toContain("訂日");
    expect(grid).toContain("台電");
    // Every other form still draws its numbers.
    const warehouse = renderSheetDocumentHtml({
      definition: warehouseLocationIntakeV1,
      values: {},
      state: "DRAFT",
    });
    expect(warehouse).toContain('class="number"');
  });

  it("watermarks every non-final state and no final state", () => {
    expect(PDF_WATERMARK_LABEL.COMPLETED).toBeUndefined();
    expect(PDF_WATERMARK_LABEL.ARCHIVED).toBeUndefined();
    expect(PDF_WATERMARK_LABEL.RETURNED).toBe("已退回");
    expect(Object.values(PDF_WATERMARK_LABEL)).toHaveLength(8);
  });

  it("prints the three CUT registers with their own widths and identifiers", () => {
    const generic = renderSheetDocumentHtml({
      definition: cutCustomerOrderV1,
      values: {},
      state: "DRAFT",
    });
    const daYin = renderSheetDocumentHtml({
      definition: cutCustomerOrderDaYinV1,
      values: {},
      state: "DRAFT",
    });
    const shihlin = renderSheetDocumentHtml({
      definition: cutCustomerOrderShihlinV1,
      values: {},
      state: "DRAFT",
    });

    expect(generic).toContain("CUT客戶訂購表");
    expect(generic).toContain("文件編號：F/P5-07-01");
    expect(generic).toContain("訂號/工單號");
    // No row-number gutter: the first printed column is the form's own.
    expect(generic).not.toContain("rownum");

    // 大銀.直得 prints no identifier, so none may be rendered — the renderer
    // must not fall back to the literal "undefined" a template string gives.
    expect(daYin).toContain("客戶訂購表（大銀·直得）");
    expect(daYin).not.toContain("文件編號");
    expect(daYin).not.toContain("undefined");
    expect(daYin).toContain("入帳年/月");

    expect(shihlin).toContain("CUT客戶訂單表（士電）");
    expect(shihlin).toContain("文件編號：F/P5-07-01");
    expect(shihlin).toContain("日期/發票號碼");
    // The paper names the customer beside the title; the other two do not.
    expect(shihlin).toContain("士林電機");
    expect(generic).not.toContain("士林電機");
    // One ruled cell per date column per body row, heading excluded.
    expect(generic.split('class="diagonal"').length - 1).toBe(25);
    expect(daYin.split('class="diagonal"').length - 1).toBe(16 * 4);
    expect(shihlin).not.toContain('class="diagonal"');
    // 士電's identifier sits above the grid, the other two below it.
    expect(shihlin.indexOf("F/P5-07-01")).toBeLessThan(
      shihlin.indexOf(GRID_START),
    );
    expect(generic.indexOf("F/P5-07-01")).toBeGreaterThan(
      generic.indexOf(GRID_START),
    );

    for (const [html, definition] of [
      [generic, cutCustomerOrderV1],
      [daYin, cutCustomerOrderDaYinV1],
      [shihlin, cutCustomerOrderShihlinV1],
    ] as const) {
      const rows = definition.sections[0];
      if (rows?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
      const body = html.slice(html.indexOf(GRID_START));
      // One <col> per printed column. The renderer normalises the source
      // units to percentages, so the proportions are what carries over.
      const units = rows.columnWidthUnits ?? [];
      const total = units.reduce((sum, unit) => sum + unit, 0);
      const printed = [...body.matchAll(/<col style="width:([0-9.]+)%">/g)].map(
        (match) => Number(match[1]),
      );
      expect(printed).toHaveLength(units.length);
      printed.forEach((percent, index) => {
        expect(percent).toBeCloseTo(((units[index] ?? 0) / total) * 100, 1);
      });
      expect(body.split("<tr").length - 1).toBe(rows.rowCount + 1);
    }
  });

  it("closes 生產作業看板 on its legend, inside the box, across every column", () => {
    const html = renderSheetDocumentHtml({
      definition: cutProductionBoardV1,
      values: {},
      state: "DRAFT",
    });
    const table = html.slice(html.indexOf(GRID_START));
    // One footer row, one cell spanning all seven columns.
    expect(table.match(/<tfoot>/g)).toHaveLength(1);
    expect(table).toContain('<td class="legend" colspan="7">');
    expect(table).toContain("捲繞 = (1)");
    expect(table).toContain("包裝 = (9)");
    // The footer sits after the rows and before the table closes.
    expect(table.indexOf("</tbody>")).toBeLessThan(table.indexOf("<tfoot>"));
    expect(html).toContain("A4 landscape");
    expect(html).toContain("文件編號：F/P5-01-01");
  });

  it("escapes a legend and prints none where a register has none", () => {
    const rows = cutProductionBoardV1.sections[0];
    if (rows?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
    const hostile = renderSheetDocumentHtml({
      definition: {
        ...cutProductionBoardV1,
        sections: [{ ...rows, legend: '<b onclick="x">定義</b>' }],
      },
      values: {},
      state: "DRAFT",
    });
    expect(hostile).not.toContain('<b onclick="x">');
    expect(hostile).toContain("&lt;b onclick=");

    const plain = renderSheetDocumentHtml({
      definition: cutCustomerOrderV1,
      values: {},
      state: "DRAFT",
    });
    expect(plain).not.toContain("<tfoot>");
  });

  it("stacks 個人生產日報表's 姓名 and 日期 beside the title, and starts its key at the left", () => {
    const html = renderSheetDocumentHtml({
      definition: cutPersonalDailyReportV1,
      values: { name: "王小明", reportDate: "2026-09-25" },
      state: "DRAFT",
    });
    expect(html).toContain('<header class="header title-fields-right">');
    expect(html).toContain(
      '<div class="date"><div>姓名：王小明</div><div>日期：2026-09-25</div></div>',
    );
    const table = html.slice(html.indexOf(GRID_START));
    expect(table).toContain('<td class="legend start" colspan="5">工作代號:\n1.捲繞');
    expect(html).toContain("文件編號：F/P5-04-01");
  });

  it("prints 生產日報表 as one block per person, four to a page", () => {
    const entries = Array.from({ length: 64 }, (_, row) => ({
      name: row === 0 ? "粘靜鴻" : row === 1 ? "看不見" : "",
      workContent: row === 9 ? "捲繞" : "",
      quantity: "",
      time: "",
      note: "",
    }));
    const html = renderSheetDocumentHtml({
      definition: cutDailyReportV1,
      values: { reportDate: "2026-09-25", entries },
      state: "DRAFT",
    });
    const start = html.indexOf('<table class="grid fixed-rows grouped"');
    const table = html.slice(start, html.indexOf("</table>", start));
    // Eight bodies, the fifth starting a new page.
    expect(table.match(/<tbody class="group/g)).toHaveLength(8);
    expect(table.match(/<tbody class="group page-start">/g)).toHaveLength(1);
    const bodies = table.split("<tbody").slice(1);
    expect(bodies[4]).toMatch(/^ class="group page-start">/);
    // Each block: its number outside the box and its name down the side,
    // both spanning its eight rows, then the rows' own cells.
    expect(table.match(/<th class="group-number" rowspan="8">/g)).toHaveLength(8);
    expect(table.match(/<td class="group-name" rowspan="8">/g)).toHaveLength(8);
    expect(bodies[0]).toContain('<th class="group-number" rowspan="8">1</th>');
    expect(bodies[7]).toContain('<th class="group-number" rowspan="8">8</th>');
    expect(table).toContain('<td class="group-name" rowspan="8"><div class="value">粘靜鴻</div></td>');
    // A value stored under a covered cell is never printed.
    expect(html).not.toContain("看不見");
    expect(bodies[1]).toContain("捲繞");
    // 64 rows, each with four cells of its own.
    expect(table.match(/<tr>/g)).toHaveLength(64 + 1);
    // Signatures print below the grid; no identifier anywhere.
    expect(html.indexOf("經理")).toBeGreaterThan(html.indexOf("</table>"));
    expect(html).toContain("組長");
    expect(html).not.toContain("文件編號");
  });

  it("prints CUT成品檢查表 with its ticked 判定, corner cell and reference band", () => {
    const html = renderSheetDocumentHtml({
      definition: cutFinishedInspectionV1,
      values: {
        workOrderNo: "W-1",
        verdict: "NG",
        dimensions: [{ item: "看不見", a: "12.0" }, { item: "1", a: "12.1" }],
      },
      state: "DRAFT",
    });
    // The document's own letterhead, inlined.
    expect(html).toContain('<div class="letterhead"><img src="data:image/png;base64,');
    expect(html).toContain("工單號：W-1");
    // Printed boxes, the ticked one filled.
    expect(html).toContain('<div class="value choices">□OK ■NG</div>');
    const start = html.indexOf(GRID_START);
    const table = html.slice(start, html.indexOf("</table>", start));
    expect(table).toContain('<th class="caption-row" colspan="6"><span class="caption-text">外觀尺寸</span><span class="caption-note">單位: mm</span></th>');
    expect(table).toContain('<th class="corner"><span class="across">尺寸</span><span class="down">序號</span></th>');
    // A value stored under the printed corner is never printed.
    expect(html).not.toContain("看不見");
    expect(table).toContain("12.0");
    // Nine rows below two heading rows.
    expect(table.match(/<tr>/g)).toHaveLength(9 + 2);
    // The reference band: the drawing inlined, the table as text.
    const band = html.slice(html.indexOf('<div class="reference">'));
    expect(band).toContain('<div class="reference-drawing"><img src="data:image/svg+xml;base64,');
    expect(band).toContain("<th>200 ＞</th><td>±1.5</td><td>±2</td><td>±2</td><td>+1.0</td>");
    expect(band.indexOf('<div class="reference">')).toBeLessThan(band.indexOf("文件編號：F/P5-02-02"));
  });

  it("prints 特性檢驗報告單's standard under each heading, joined, beside the corner", () => {
    const tests = [{ sample: "看不見", a: "12.0", current: "35" }, { sample: "1", a: "12.1" }];
    const html = renderSheetDocumentHtml({
      definition: cutCharacteristicInspectionV1,
      values: { tests },
      state: "DRAFT",
    });
    const start = html.indexOf(GRID_START);
    const table = html.slice(start, html.indexOf("</table>", start));
    const head = table.slice(table.indexOf("<thead>"), table.indexOf("</thead>"));
    // The corner runs down beside the headings and the standard.
    expect(head).toContain('<tr class="joined"><th class="corner" rowspan="2"><span class="across">標準值</span><span class="down">測試值</span></th><th>A</th>');
    expect(head).toContain('<tr class="standard joined">');
    expect(head).toContain("12.0");
    // A unit is printed in the cell after the value.
    expect(head).toContain('<div class="withunit"><div class="value">35</div><span class="unit">mA</span></div>');
    // The corner covers the standard row's first cell: its stored value is
    // never printed.
    expect(html).not.toContain("看不見");
    // Fifteen tests below.
    const body = table.slice(table.indexOf("<tbody>"));
    expect(body.match(/<tr>/g)).toHaveLength(15);
    expect(body).toContain("12.1");
  });

  it("numbers 崧貿's tests 1 to 15 under a ruled standard row", () => {
    const html = renderSheetDocumentHtml({
      definition: cutCharacteristicInspectionSongmaoV1,
      values: {},
      state: "DRAFT",
    });
    const start = html.indexOf(GRID_START);
    const table = html.slice(start, html.indexOf("</table>", start));
    expect(table).toContain('<th class="corner" rowspan="2"><span class="across">位置</span><span class="down">標準值</span></th>');
    expect(table).toContain('<tr class="standard">');
    expect(table).not.toContain('class="joined"');
    const body = table.slice(table.indexOf("<tbody>"));
    expect(body).toContain('<th class="number">1</th>');
    expect(body).toContain('<th class="number">15</th>');
    expect(body).not.toContain('<th class="number">16</th>');
    expect(html).toContain('<span class="unit">MA</span>');
  });

  it("prints 巧力's readings side by side under its heading lines, with no identifier", () => {
    const excitation = Array.from({ length: 10 }, (_, index) => ({ excitationCurrent: String(index + 30) }));
    const html = renderSheetDocumentHtml({
      definition: cutFactoryInspectionChiaoliV1,
      values: { excitation },
      state: "DRAFT",
    });
    expect(html).toContain('<div class="header-line start">TO: 採購部');
    expect(html.indexOf("永進矽鋼(股)公司")).toBeLessThan(html.indexOf("<h1>"));
    expect(html.indexOf("客戶: 巧力工業股份有限公司")).toBeGreaterThan(html.indexOf("<h1>"));
    expect(html).not.toContain('<div class="letterhead">');
    expect(html).not.toContain("文件編號");
    const start = html.indexOf('<table class="grid fixed-rows blocks"');
    const table = html.slice(start, html.indexOf("</table>", start));
    // Five printed rows, each holding 序 n and 序 n+5 either side of the gap.
    const body = table.slice(table.indexOf("<tbody>"));
    expect(body.match(/<tr>/g)).toHaveLength(5);
    expect(body).toMatch(/<th class="number">1<\/th><td>.*30.*<\/td><td class="block-gap"><\/td><th class="number">6<\/th><td>.*35/);
    expect(table.match(/<th>激磁電流<\/th>/g)).toHaveLength(2);
  });

  it("prints 信太's ticks, prefix, red marks and paired readings", () => {
    const html = renderSheetDocumentHtml({
      definition: cutCharacteristicInspectionShintaiV1,
      values: {
        customerOrderNo: "12345",
        tests: [{ check: "不合格" }],
      },
      state: "DRAFT",
    });
    expect(html).toContain('<div class="value choices">□合格 / ■不合格</div>');
    expect(html).toContain('<div class="withunit"><span class="unit">B</span><div class="value">12345</div></div>');
    expect(html).toContain('<th style="color:#ff0000">檢驗日期</th>');
    expect(html).toContain('<th style="color:#ff0000">尺寸容許差:C±1.0mm / B±1.0mm / D±0.5mm</th>');
    expect(html).toContain('<div class="below-document"><span class="footer-note" style="color:#ff0000">VER 2.0</span><span>文件編號：F/P5-03-01</span></div>');
    // The views alone, inlined.
    expect(html).toContain('<div class="reference"><div class="reference-drawing"><img src="data:image/svg+xml;base64,');
    expect(html).toContain(".grid td{height:7.5mm}");
  });

  it("breaks 燒炖質量記錄表's headings where the paper does, one of them smaller", () => {
    const html = renderSheetDocumentHtml({
      definition: cutFiringQualityRecordV1,
      values: {},
      state: "DRAFT",
    });
    expect(html).toContain("<th>爐號/\n胆號</th>");
    expect(html).toContain('<th class="small">裝箱日/\n時間</th>');
    // Only the heading the worksheet sets smaller.
    expect(html.match(/<th class="small">/g)).toHaveLength(1);
    expect(html).toContain(".grid th{white-space:pre-line}");
    expect(html).toContain(".grid th.small{font-size:8.5pt;");
    expect(html).toContain("文件編號：F/P4-01-02");
  });

  it("prints 產品需求表's 交期 ticked, or written after 其他", () => {
    const html = renderSheetDocumentHtml({
      definition: stampingProductDemandV1,
      values: { demands: [{ delivery: "庫存" }, { delivery: "其他：2/23" }] },
      state: "DRAFT",
    });
    expect(html).toContain('<div class="value choices">■庫存□其他：</div>');
    expect(html).toContain('<div class="value choices">□庫存■其他：2/23</div>');
    expect(html).toContain('<div class="value choices">□庫存□其他：</div>');
    expect(html).toContain("文件編號：F/M1-03-01");
  });

  it("prints 沖壓's 生產日報表: two-row headings, shared cells, the back last", () => {
    const html = renderSheetDocumentHtml({
      definition: stampingDailyReportV1,
      values: {
        shift: "請假：4",
        jobs: [{ eBoxWeight: "25", eBoxCount: "3", cGradeE: "1.2", cGradeI: "0.8" }],
        labels: ["A-01", "", "", "", "", "", "B-07"],
      },
      state: "DRAFT",
    });
    // 箱重/箱數 runs down both heading rows over its two cells; 不良品 spans
    // three with C級 D級 報廢 beneath.
    expect(html).toContain('<th colspan="2" rowspan="2">箱重/箱數</th>');
    expect(html).toContain('<th colspan="3">不良品</th>');
    expect(html).toContain("<tr><th>C級</th><th>D級</th><th>報廢</th></tr>");
    // One printed cell, two values each.
    expect(html).toContain(
      '<td class="shared inline"><div class="part"><span class="unit">E:</span><div class="value">25</div><span class="unit">K*</span></div><div class="part"><div class="value">3</div><span class="unit">箱</span></div></td>',
    );
    expect(html).toContain(
      '<td class="shared stacked"><div class="part"><span class="unit">E:</span><div class="value">1.2</div><span class="unit">K</span></div><div class="part"><span class="unit">I:</span><div class="value">0.8</div><span class="unit">K</span></div></td>',
    );
    expect(html).toContain("■請假 4H");
    // The back prints after the front's footer, on a page of its own, numbered
    // down each column.
    const footer = html.indexOf("文件編號：F/P2-10-01");
    const back = html.indexOf('<section class="back-side">');
    expect(footer).toBeGreaterThan(0);
    expect(back).toBeGreaterThan(footer);
    expect(html).toContain("grid-auto-flow:column");
    expect(html).toContain("@page back{size:A4 portrait}");
  });

  it("prints 首件/巡迴檢驗單's printed matrices, the 公差 table and 鋼捲號", () => {
    const html = renderSheetDocumentHtml({
      definition: cutPatrolInspectionV1,
      values: {
        coreType: "環型",
        coilNumbers: "C-101",
        firstPiece: { a: { verdict: "✓" }, crack: { standard: "無", verdict: "✗" } },
        rounds: { checkedAt: { round1: { day: "29", hour: "08", minute: "30" } }, verdict: { round1: "OK" } },
      },
      state: "DRAFT",
    });
    // One body, so the side label runs down the headings and the rows.
    expect(html).toContain('<th class="side-label" rowspan="14">首件檢驗</th>');
    expect(html).toContain('<th colspan="3">檢測值</th>');
    // Ticked once across four columns; judged with the mark alone.
    expect(html).toContain('<td colspan="4"><div class="withunit"><div class="value choices">□有 ■無</div></div></td><td><div class="value mark">✗</div></td>');
    expect(html).toContain('<div class="value mark">✓</div>');
    expect(html).toContain("類型：□C型 ■環型");
    expect(html).toContain('<span class="entry-part"><div class="value">29</div><span class="unit">日</span></span>');
    expect(html).toContain('<th class="corner" colspan="2"><span class="across">檢驗時間</span><span class="down">品質特性</span></th>');
    expect(html).toContain('<div class="reference-entry"><div class="reference-entry-label">鋼捲號：</div><div class="value multiline">C-101</div></div>');
    expect(html).toContain('<div class="bottom-lines"><span class="start">單位：mm</span><span class="end">判定: ✓合格 ✗不合格</span></div>');
  });
});

// CUT成品檢查表 version 2 prints its particulars on the document's six
// columns (the user, 2026-10-02).
describe("CUT成品檢查表 on the document's columns", () => {
  it("prints one table, 規格's box spanning to the right edge", () => {
    const html = renderSheetDocumentHtml({ definition: cutFinishedInspectionV2, values: {}, state: "READY" });
    const start = html.indexOf('<table class="grid band fields-grid">');
    expect(start).toBeGreaterThan(-1);
    const header = html.slice(start, html.indexOf("</table>", start));
    expect(header.match(/<col /g)).toHaveLength(6);
    expect(header.match(/<tr>/g)).toHaveLength(3);
    expect(header).toContain('<th>規格</th><td colspan="3">');
    expect(header).toContain("<th>檢查工具</th><th>游標卡尺</th><th>審查員</th>");
  });
});

// 退火明細表 version 2 writes 程式編號 in three boxes under one label (the
// user, 2026-10-02): before 第, between, and after 程式.
describe("several values written in one box", () => {
  it("prints 程式編號 as ＿ 第 ＿ 程式 ＿ in one cell", () => {
    const html = renderSheetDocumentHtml({
      definition: cutAnnealingListV2,
      values: { programBefore: "A", programNo: "3", programAfter: "B" },
      state: "READY",
    });
    expect(html).toContain(
      '<th>程式編號</th><td><div class="withunit joined"><div class="value">A</div><span class="unit">第</span><div class="value">3</div><span class="unit">程式</span><div class="value">B</div></div></td>',
    );
    // The joined values print no labels of their own.
    expect(html).not.toContain("程式編號（");
    const start = html.indexOf('<table class="grid band fields-grid">');
    const header = html.slice(start, html.indexOf("</table>", start));
    expect(header.match(/<col /g)).toHaveLength(6);
  });
});

// 士電's 品名 is written on two lines (the user, 2026-10-02).
describe("a cell written on two lines", () => {
  it("prints both lines, with room for two", () => {
    const html = renderSheetDocumentHtml({
      definition: cutCustomerOrderShihlinV2,
      values: { orders: [{ productName: "(不含浸) 2.09K\n(不切) DEMO-PART(38*98) 30W" }] },
      state: "READY",
    });
    expect(html).toContain(
      '<div class="value multiline" style="min-height:9mm">(不含浸) 2.09K\n(不切) DEMO-PART(38*98) 30W</div>',
    );
  });
});

// 加工製令單 version 2 prints its header on the worksheet's ten columns (the
// user, 2026-10-02), so labels line up from row to row on paper as on screen.
describe("a header on the worksheet's columns", () => {
  it("prints one table with the ten columns and each cell's span", () => {
    const html = renderSheetDocumentHtml({ definition: cutProcessingOrderV2, values: {}, state: "READY" });
    const start = html.indexOf('<table class="grid band fields-grid">');
    const header = start < 0 ? "" : html.slice(start, html.indexOf("</table>", start) + "</table>".length);
    expect(header).not.toBe("");
    expect(header.match(/<col /g)).toHaveLength(10);
    expect(header.match(/<tr>/g)).toHaveLength(6);
    // The left labels all span A–B; 備註's box spans C–J.
    for (const label of ["客戶", "鐵芯尺寸", "材質", "鋼捲號", "備註", "退火編號"]) {
      expect(header).toContain(`<th colspan="2">${label}</th>`);
    }
    expect(header).toContain('<th colspan="2">備註</th><td colspan="8">');
    expect(header).toContain("<th>訂購數量</th>");
  });

  it("leaves version 1 printing a table per row", () => {
    const html = renderSheetDocumentHtml({ definition: cutProcessingOrderV1, values: {}, state: "READY" });
    expect(html).not.toContain('class="grid band fields-grid"');
    expect(html.match(/grid band fields-wrapped/g)).toHaveLength(6);
  });
});

// 信太's version 2 header writes each pair of readings in one box, as its
// worksheet writes `V / V` and `/ mA` in one cell (the user, 2026-10-02).
// The A–D views sit beside the fields under the register, in the room the
// short boxes leave (the user, 2026-10-02).
describe("a drawing beside a band's fields", () => {
  it("prints the A–D views beside 出貨數量, 抽樣數量 and 檢驗者", () => {
    const html = renderSheetDocumentHtml({ definition: cutCharacteristicInspectionV2, values: {}, state: "READY" });
    expect(html).toContain(
      '<th>出貨數量</th><td><div class="withunit"><div class="value"></div><span class="unit">PCS</span></div></td><td class="fieldaside" rowspan="3"><img src="data:image/svg+xml',
    );
    expect(html).not.toContain('class="reference"');
  });

  it("starts 信太's views on the second row, across three columns", () => {
    const html = renderSheetDocumentHtml({ definition: cutCharacteristicInspectionShintaiV2, values: {}, state: "READY" });
    expect(html).toMatch(/<th>檢驗者<\/th><td colspan="4">[^]*?<\/td><td class="fieldaside" colspan="3" rowspan="2"><img /);
  });
});

describe("信太's paired readings", () => {
  it("prints 電壓 and 電流(1) as two values in one box each", () => {
    const html = renderSheetDocumentHtml({
      definition: cutCharacteristicInspectionShintaiV2,
      values: { voltage1: "2", voltage2: "5", currentMax: "40", currentMin: "30" },
      state: "READY",
    });
    expect(html).toContain(
      '<th>電壓</th><td colspan="2"><div class="withunit joined"><div class="value">2</div><span class="unit">V</span><span class="unit">/</span><div class="value">5</div><span class="unit">V</span></div></td>',
    );
    expect(html).toContain(
      '<td colspan="2"><div class="withunit joined"><div class="value">40</div><span class="unit">/</span><div class="value">30</div><span class="unit">mA</span></div></td>',
    );
    const start = html.indexOf('<table class="grid band fields-grid">');
    const header = html.slice(start, html.indexOf("</table>", start));
    expect(header.match(/<col /g)).toHaveLength(8);
  });
});
