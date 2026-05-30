import { getLegalMetadata, LegalDocumentPage } from "../_legal-content";

export const metadata = getLegalMetadata("privacy");

export default function PrivacyPage() {
  return <LegalDocumentPage slug="privacy" />;
}
