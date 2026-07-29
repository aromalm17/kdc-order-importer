import type { ActionFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { createEphemeralJob } from "../services/ephemeral-imports.server";
import { parseWorkbook } from "../services/workbook.server";
import { verifyOrderVariantImages } from "../services/variant-verification.server";

const MAX_BYTES = 25 * 1024 * 1024;

export async function action({ request }: ActionFunctionArgs) {
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

export default function NewImport() {
  const actionData = useActionData() as { error?: string } | undefined;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  return (
    <s-page heading="New import">
      <s-section heading="Step 1 — Upload workbook">
        <Form method="post" encType="multipart/form-data">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Upload an Excel workbook for analysis. Importing never starts
              automatically.
            </s-paragraph>
            <input
              aria-label="Excel workbook"
              name="workbook"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              required
              className="kdc-file-input"
            />
            {actionData?.error ? (
              <s-banner tone="critical">{actionData.error}</s-banner>
            ) : null}
            <s-button
              type="submit"
              variant="primary"
              {...(busy ? { loading: true } : {})}
            >
              {busy ? "Analyzing workbook" : "Upload and analyze"}
            </s-button>
          </s-stack>
        </Form>
      </s-section>
      <s-section heading="What happens next">
        <s-ordered-list>
          <s-list-item>Detect the workbook sheets and columns.</s-list-item>
          <s-list-item>
            Apply the KDC Order History mapping profile.
          </s-list-item>
          <s-list-item>Group multiple rows into complete orders.</s-list-item>
          <s-list-item>Keep unfinished records in memory only.</s-list-item>
          <s-list-item>Preview every order before importing it.</s-list-item>
        </s-ordered-list>
      </s-section>
    </s-page>
  );
}
