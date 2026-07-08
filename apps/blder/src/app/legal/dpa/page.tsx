import { legalPages } from "../content";
import { LegalPage } from "../legal-page";

export default function DpaPage() {
  return <LegalPage page={legalPages.dpa} />;
}

