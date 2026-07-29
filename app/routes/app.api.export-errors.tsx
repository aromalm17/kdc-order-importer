import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getEphemeralJob, pendingCsv } from "../services/ephemeral-imports.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const id = new URL(request.url).searchParams.get("job");
  const job = getEphemeralJob(session.shop, id);
  if (!job) return new Response("No active import.", { status: 404 });
  return new Response(`\uFEFF${pendingCsv(job)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pending-${job.id}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
