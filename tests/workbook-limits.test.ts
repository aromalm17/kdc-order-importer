import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  assertWorkbookResourceLimits,
  createWorkbookParsingBuffer,
  MAX_WORKBOOK_BYTES,
  WorkbookResourceLimitError,
  workbookSizeError,
} from "../app/services/workbook-limits.server";
import JSZip from "jszip";

describe("workbook resource limits", () => {
  it("accepts a normal xlsx archive", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Orders").addRow(["Name", "Customer: Email"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(assertWorkbookResourceLimits(buffer)).resolves.toBeUndefined();
  });

  it("rejects oversized uploads before trying to unzip them", async () => {
    const buffer = Buffer.alloc(MAX_WORKBOOK_BYTES + 1);

    await expect(assertWorkbookResourceLimits(buffer)).rejects.toThrow(
      "safe limit",
    );
    await expect(assertWorkbookResourceLimits(buffer)).rejects.toBeInstanceOf(
      WorkbookResourceLimitError,
    );
    expect(workbookSizeError(buffer.byteLength)).toContain("Split it");
  });

  it("rejects a file that is not a readable xlsx archive", async () => {
    await expect(
      assertWorkbookResourceLimits(Buffer.from("not an xlsx")),
    ).rejects.toThrow("not a readable .xlsx workbook");
  });

  it("removes large embedded media before parsing order data", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Orders");
    sheet.addRow(["Name", "Customer: Email"]);
    const imageId = workbook.addImage({
      base64: Buffer.alloc(40 * 1024 * 1024, 65).toString("base64"),
      extension: "png",
    });
    sheet.addImage(imageId, "A2:B8");
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(assertWorkbookResourceLimits(buffer)).resolves.toBeUndefined();
    const parsingBuffer = await createWorkbookParsingBuffer(buffer);
    const parsingArchive = await JSZip.loadAsync(parsingBuffer);

    expect(
      Object.keys(parsingArchive.files).some((path) =>
        path.startsWith("xl/media/"),
      ),
    ).toBe(false);
    expect(parsingBuffer.byteLength).toBeLessThan(buffer.byteLength);
  });
});
