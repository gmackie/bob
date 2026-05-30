import { getLegalMetadata, LegalDocumentPage } from "../_legal-content";

export const metadata = getLegalMetadata("data-retention");

export default function DataRetentionPage() {
  return <LegalDocumentPage slug="data-retention" />;
}
