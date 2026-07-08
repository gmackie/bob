import { legalPages } from "../content";
import { LegalPage } from "../legal-page";

export default function PrivacyPage() {
  return <LegalPage page={legalPages.privacy} />;
}

