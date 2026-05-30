import { getLegalMetadata, LegalDocumentPage } from "../_legal-content";

export const metadata = getLegalMetadata("terms");

export default function TermsPage() {
  return <LegalDocumentPage slug="terms" />;
}
