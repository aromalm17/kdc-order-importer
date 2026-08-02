import unzipper from "unzipper";
import JSZip from "jszip";

export const MAX_WORKBOOK_BYTES = 8 * 1024 * 1024;
export const MAX_WORKBOOK_EXPANDED_BYTES = 32 * 1024 * 1024;
export const MAX_WORKBOOK_TOTAL_EXPANDED_BYTES = 256 * 1024 * 1024;
export const MAX_WORKBOOK_ENTRIES = 500;
export const MAX_WORKBOOK_ROWS = 10_000;

const UNUSED_IMPORT_ENTRY =
  /^(?:xl\/(?:media|embeddings|printerSettings)\/|docProps\/thumbnail\.)/i;

export class WorkbookResourceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbookResourceLimitError";
  }
}

function megabytes(bytes: number) {
  return Math.ceil(bytes / (1024 * 1024));
}

export function workbookSizeError(size: number) {
  if (size <= MAX_WORKBOOK_BYTES) return null;
  return `The workbook exceeds the ${megabytes(MAX_WORKBOOK_BYTES)} MB safe limit. Split it into smaller workbooks before importing.`;
}

export async function assertWorkbookResourceLimits(buffer: Buffer) {
  const sizeError = workbookSizeError(buffer.byteLength);
  if (sizeError) throw new WorkbookResourceLimitError(sizeError);

  let directory: Awaited<ReturnType<typeof unzipper.Open.buffer>>;
  try {
    directory = await unzipper.Open.buffer(buffer);
  } catch {
    throw new Error("The uploaded file is not a readable .xlsx workbook.");
  }

  if (directory.files.length > MAX_WORKBOOK_ENTRIES) {
    throw new WorkbookResourceLimitError(
      `The workbook contains too many internal files (${directory.files.length}). Split it into smaller workbooks before importing.`,
    );
  }

  const totalExpandedBytes = directory.files.reduce(
    (total, entry) => total + Number(entry.uncompressedSize || 0),
    0,
  );
  if (totalExpandedBytes > MAX_WORKBOOK_TOTAL_EXPANDED_BYTES) {
    throw new WorkbookResourceLimitError(
      `The workbook expands to about ${megabytes(totalExpandedBytes)} MB, above the ${megabytes(MAX_WORKBOOK_TOTAL_EXPANDED_BYTES)} MB archive limit. Remove embedded media or split it into smaller workbooks.`,
    );
  }

  const parsedExpandedBytes = directory.files.reduce(
    (total, entry) =>
      UNUSED_IMPORT_ENTRY.test(entry.path)
        ? total
        : total + Number(entry.uncompressedSize || 0),
    0,
  );
  if (parsedExpandedBytes > MAX_WORKBOOK_EXPANDED_BYTES) {
    throw new WorkbookResourceLimitError(
      `The workbook's order data expands to about ${megabytes(parsedExpandedBytes)} MB, above the ${megabytes(MAX_WORKBOOK_EXPANDED_BYTES)} MB safe limit. Split it into smaller workbooks before importing.`,
    );
  }
}

export async function createWorkbookParsingBuffer(buffer: Buffer) {
  await assertWorkbookResourceLimits(buffer);
  const archive = await JSZip.loadAsync(buffer);

  for (const path of Object.keys(archive.files)) {
    if (UNUSED_IMPORT_ENTRY.test(path)) archive.remove(path);
  }

  return archive.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 1 },
  });
}
