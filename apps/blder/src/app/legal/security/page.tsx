import { legalPages } from "../content";
import { LegalPage } from "../legal-page";

export default function SecurityPage() {
  return <LegalPage page={legalPages.security} />;
}

