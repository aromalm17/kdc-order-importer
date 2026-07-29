import { Form } from "react-router";

export function NewImportSections({
  error,
  busy,
}: {
  error?: string;
  busy: boolean;
}) {
  return (
    <>
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
            {error ? <s-banner tone="critical">{error}</s-banner> : null}
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
    </>
  );
}
