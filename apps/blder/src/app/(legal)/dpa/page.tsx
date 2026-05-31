import {
  LegalDocumentPage,
  legalDocuments,
  legalMetadata,
} from "../legal-docs";

export const metadata = legalMetadata(legalDocuments.dpa);

export default function DpaPage() {
  return <LegalDocumentPage document={legalDocuments.dpa} />;
}
