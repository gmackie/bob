import { legalPages } from "../content";
import { LegalPage } from "../legal-page";

export default function TermsPage() {
  return <LegalPage page={legalPages.terms} />;
}

