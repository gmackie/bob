import {
  LegalDocumentPage,
  legalDocuments,
  legalMetadata,
} from "../legal-docs";

export const metadata = legalMetadata(legalDocuments.security);

export default function SecurityPage() {
  return <LegalDocumentPage document={legalDocuments.security} />;
}
