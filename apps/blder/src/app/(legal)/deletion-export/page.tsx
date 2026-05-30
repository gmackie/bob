import { getLegalMetadata, LegalDocumentPage } from "../_legal-content";

export const metadata = getLegalMetadata("deletion-export");

export default function DeletionExportPage() {
  return <LegalDocumentPage slug="deletion-export" />;
}
