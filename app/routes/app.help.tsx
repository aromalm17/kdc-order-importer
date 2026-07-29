export default function Help() {
  return (
    <s-page heading="Help">
      <s-section heading="Safe import checklist"><s-ordered-list><s-list-item>Upload the original .xlsx workbook.</s-list-item><s-list-item>Review detected columns and order groups.</s-list-item><s-list-item>Resolve every missing variant and image mapping.</s-list-item><s-list-item>Import a small test batch first.</s-list-item><s-list-item>Review imported Shopify orders before continuing.</s-list-item></s-ordered-list></s-section>
      <s-section heading="Required Shopify access"><s-paragraph>The app requires read_products, read_customers, write_customers, read_orders, write_orders, write_order_edits, and read_all_orders. Shopify can require approval for read_all_orders and protected customer fields such as names, email, phone, and addresses.</s-paragraph></s-section>
      <s-section heading="Data protection"><s-paragraph>Workbooks and pending orders exist in server memory only and are cleared by restarts or after 24 hours. Download the pending CSV before leaving a job. Successfully imported orders are removed immediately. Never put passwords, OTPs, payment credentials, or secrets into a workbook.</s-paragraph></s-section>
    </s-page>
  );
}
