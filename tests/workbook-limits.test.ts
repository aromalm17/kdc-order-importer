import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  assertWorkbookResourceLimits,
  MAX_WORKBOOK_BYTES,
  workbookSizeError,
} from "../app/services/workbook-limits.server";

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
    expect(workbookSizeError(buffer.byteLength)).toContain("Split it");
  });

  it("rejects a file that is not a readable xlsx archive", async () => {
    await expect(
      assertWorkbookResourceLimits(Buffer.from("not an xlsx")),
    ).rejects.toThrow("not a readable .xlsx workbook");
  });
});
