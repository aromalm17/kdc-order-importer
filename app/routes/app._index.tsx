import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation } from "react-router";
import { NewImportSections } from "../components/NewImportSections";
import { authenticate } from "../shopify.server";
import { shopSummary } from "../services/ephemeral-imports.server";
import { handleNewImport } from "../services/new-import.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  return { shop: session.shop, ...shopSummary(session.shop) };
}

export async function action({ request }: ActionFunctionArgs) {
  return handleNewImport(request);
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData() as { error?: string } | undefined;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  return (
    <s-page heading="KDC Order Importer">
      <NewImportSections error={actionData?.error} busy={busy} />
      <s-section heading="Database-free import">
        <s-banner tone="info">
          Customer and error-order data is held in memory only. Successful
          orders disappear immediately. Download the pending CSV before a
          service restart.
        </s-banner>
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
          gap="base"
        >
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text>Pending</s-text>
            <s-heading>{data.pending}</s-heading>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text>Imported this run</s-text>
            <s-heading>{data.imported}</s-heading>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text>Blocked</s-text>
            <s-heading>{data.blocked}</s-heading>
          </s-box>
        </s-grid>
        {data.job ? (
          <s-button href={`/app/preview?job=${data.job.id}`}>
            Open current import
          </s-button>
        ) : null}
      </s-section>
      <s-section heading="System status">
        <s-stack direction="block" gap="small-200">
          <s-text>Store: {data.shop}</s-text>
          <s-text>Database: not used</s-text>
          <s-text>Persistent customer storage: disabled</s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}
