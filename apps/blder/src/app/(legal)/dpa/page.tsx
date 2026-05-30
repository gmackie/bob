import { getLegalMetadata, LegalDocumentPage } from "../_legal-content";

export const metadata = getLegalMetadata("dpa");

export default function DpaPage() {
  return <LegalDocumentPage slug="dpa" />;
}
