import {
  LegalDocumentPage,
  legalDocuments,
  legalMetadata,
} from "../legal-docs";

export const metadata = legalMetadata(legalDocuments.cookies);

export default function CookiesPage() {
  return <LegalDocumentPage document={legalDocuments.cookies} />;
}
