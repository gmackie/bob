import { legalPages } from "../content";
import { LegalPage } from "../legal-page";

export default function DataDeletionExportPage() {
  return <LegalPage page={legalPages.data} />;
}

