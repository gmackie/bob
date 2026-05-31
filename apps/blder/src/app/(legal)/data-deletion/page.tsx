import {
  LegalDocumentPage,
  legalDocuments,
  legalMetadata,
} from "../legal-docs";

export const metadata = legalMetadata(legalDocuments["data-deletion"]);

export default function DataDeletionPage() {
  return <LegalDocumentPage document={legalDocuments["data-deletion"]} />;
}
