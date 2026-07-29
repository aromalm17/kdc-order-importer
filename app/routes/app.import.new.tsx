import type { ActionFunctionArgs } from "react-router";
import { useActionData, useNavigation } from "react-router";
import { NewImportSections } from "../components/NewImportSections";
import { handleNewImport } from "../services/new-import.server";

export async function action({ request }: ActionFunctionArgs) {
  return handleNewImport(request);
}

export default function NewImport() {
  const actionData = useActionData() as { error?: string } | undefined;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  return (
    <s-page heading="New import">
      <NewImportSections error={actionData?.error} busy={busy} />
    </s-page>
  );
}
