import { legalPages } from "../content";
import { LegalPage } from "../legal-page";

export default function CookiesPage() {
  return <LegalPage page={legalPages.cookies} />;
}

