import {
  LegalDocumentPage,
  legalDocuments,
  legalMetadata,
} from "../legal-docs";

export const metadata = legalMetadata(legalDocuments.subprocessors);

export default function SubprocessorsPage() {
  return <LegalDocumentPage document={legalDocuments.subprocessors} />;
}
