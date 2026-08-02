import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import {
  clearEphemeralJobsForShop,
  createEphemeralJob,
} from "./ephemeral-imports.server";
import { parseWorkbook } from "./workbook.server";
import {
  assertWorkbookResourceLimits,
  MAX_WORKBOOK_BYTES,
  WorkbookResourceLimitError,
  workbookSizeError,
} from "./workbook-limits.server";
import { verifyOrderVariantImages } from "./variant-verification.server";

export async function handleNewImport(request: Request) {
  const { session, admin } = await authenticate.admin(request);

  const contentLength = Number(request.headers.get("content-length") || 0);
  // Multipart framing is small; reject obviously oversized bodies before
  // request.formData() duplicates the upload in the Node process.
  if (contentLength > MAX_WORKBOOK_BYTES + 1024 * 1024) {
    return Response.json(
      { error: workbookSizeError(MAX_WORKBOOK_BYTES + 1) },
      { status: 413 },
    );
  }

  const form = await request.formData();
  const file = form.get("workbook");
  if (!(file instanceof File)) {
    return Response.json(
      { error: "Choose an .xlsx workbook." },
      { status: 400 },
    );
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return Response.json(
      { error: "Only .xlsx files are supported." },
      { status: 400 },
    );
  }
  const sizeError = workbookSizeError(file.size);
  if (sizeError) {
    return Response.json({ error: sizeError }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    // Validate the archive before discarding the merchant's previous job.
    await assertWorkbookResourceLimits(buffer);
    // Starting a new valid upload replaces the previous in-memory import. This
    // releases its parsed rows before the next workbook is expanded.
    clearEphemeralJobsForShop(session.shop);
    const result = await parseWorkbook(buffer, {
      sheetName: String(form.get("sheetName") || "") || undefined,
    });
    await verifyOrderVariantImages(admin, result.orders);
    const job = createEphemeralJob(session.shop, file.name, result);
    return redirect(`/app/preview?job=${job.id}`);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Workbook parsing failed.",
      },
      { status: error instanceof WorkbookResourceLimitError ? 413 : 400 },
    );
  }
}
