import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getEphemeralJob,
  pendingWorkbook,
} from "../services/ephemeral-imports.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const id = new URL(request.url).searchParams.get("job");
  const job = getEphemeralJob(session.shop, id);
  if (!job) return new Response("No active import.", { status: 404 });
  const workbook = await pendingWorkbook(job);
  return new Response(workbook, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pending-orders-${job.id}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
