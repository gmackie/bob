import { getLegalMetadata, LegalDocumentPage } from "../_legal-content";

export const metadata = getLegalMetadata("security");

export default function SecurityPage() {
  return <LegalDocumentPage slug="security" />;
}
