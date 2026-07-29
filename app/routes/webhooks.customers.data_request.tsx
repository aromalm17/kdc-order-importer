import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export async function action({ request }: ActionFunctionArgs) {
  const { shop, topic } = await authenticate.webhook(request);
  console.info(`Accepted ${topic} privacy request for ${shop}`);
  return new Response(null, { status: 200 });
}

