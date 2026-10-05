# Mobile reviewer sign-in

Store builds now offer Reviewer Sign In, using the existing reserved-domain demo endpoint and the standard Better Auth magic-link verification endpoint. Provide a dedicated reviewer+owner@demo.preflight.app address and a separate reviewer+delete@demo.preflight.app address in the Preflight reviewer registry; no Google/GitHub identity is needed.

The server continues rejecting ordinary email addresses unless explicitly allowed in DEMO_LOGIN_EMAILS. It does not expose password authentication for ordinary production users. The regular email sender fails clearly until configured; reviewer bypass verification does not send email.

First sign-in creates a personal workspace through the existing tenancy bootstrap. Seed reviewer projects/work items and connect an OODA gateway before live task/chat review flows. Do not fake a running gateway. OAuth and QR pairing remain available.
