import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getEphemeralJob } from "../services/ephemeral-imports.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const job = getEphemeralJob(session.shop, params.jobId);
  if (!job) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    status: job.status,
    pending: job.pending.length,
    imported: job.importedOrders,
    message: job.currentMessage,
    updatedAt: job.updatedAt,
  });
}
