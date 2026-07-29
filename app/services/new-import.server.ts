import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { createEphemeralJob } from "./ephemeral-imports.server";
import { parseWorkbook } from "./workbook.server";
import { verifyOrderVariantImages } from "./variant-verification.server";

const MAX_BYTES = 25 * 1024 * 1024;

export async function handleNewImport(request: Request) {
  const { session, admin } = await authenticate.admin(request);
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
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: "The workbook exceeds the 25 MB limit." },
      { status: 400 },
    );
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
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
      { status: 400 },
    );
  }
}
