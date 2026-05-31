import {
  LegalDocumentPage,
  legalDocuments,
  legalMetadata,
} from "../legal-docs";

export const metadata = legalMetadata(legalDocuments.privacy);

export default function PrivacyPage() {
  return <LegalDocumentPage document={legalDocuments.privacy} />;
}
