import { describe, expect, it } from "vitest";
import {
  getAttachmentFilename,
  isExcelResponse,
  XLSX_CONTENT_TYPE,
} from "../app/utils/download";

describe("pending workbook downloads", () => {
  it("uses the quoted attachment filename", () => {
    expect(
      getAttachmentFilename(
        'attachment; filename="pending-orders-job-1.xlsx"',
        "fallback.xlsx",
      ),
    ).toBe("pending-orders-job-1.xlsx");
  });

  it("decodes an extended attachment filename", () => {
    expect(
      getAttachmentFilename(
        "attachment; filename*=UTF-8''pending%20orders.xlsx",
        "fallback.xlsx",
      ),
    ).toBe("pending orders.xlsx");
  });

  it("removes path separators from an attachment filename", () => {
    expect(
      getAttachmentFilename(
        'attachment; filename="../pending\\\\orders.xlsx"',
        "fallback.xlsx",
      ),
    ).toBe("..-pending-orders.xlsx");
  });

  it("accepts only an Excel workbook response", () => {
    expect(isExcelResponse(XLSX_CONTENT_TYPE)).toBe(true);
    expect(isExcelResponse(`${XLSX_CONTENT_TYPE}; charset=binary`)).toBe(true);
    expect(isExcelResponse("text/html")).toBe(false);
    expect(isExcelResponse(null)).toBe(false);
  });
});
