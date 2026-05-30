import { getLegalMetadata, LegalDocumentPage } from "../_legal-content";

export const metadata = getLegalMetadata("subprocessors");

export default function SubprocessorsPage() {
  return <LegalDocumentPage slug="subprocessors" />;
}
