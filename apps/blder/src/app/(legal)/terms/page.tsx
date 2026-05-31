import {
  LegalDocumentPage,
  legalDocuments,
  legalMetadata,
} from "../legal-docs";

export const metadata = legalMetadata(legalDocuments.terms);

export default function TermsPage() {
  return <LegalDocumentPage document={legalDocuments.terms} />;
}
