import sgMail from "@sendgrid/mail";

export interface EmailConfig {
  apiKey: string;
  fromEmail: string;
  fromName?: string;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

let configured = false;

export function configureEmail(config?: EmailConfig): void {
  const apiKey = config?.apiKey ?? process.env.SENDGRID_API_KEY;
  
  if (!apiKey) {
    console.warn("SendGrid API key not configured. Emails will not be sent.");
    return;
  }

  sgMail.setApiKey(apiKey);
  configured = true;
}

export function getDefaultFromEmail(): string {
  return process.env.SENDGRID_FROM_EMAIL ?? "noreply@example.com";
}

export function getDefaultFromName(): string {
  return process.env.SENDGRID_FROM_NAME ?? "Your App";
}

export async function sendEmail(options: SendEmailOptions): Promise<EmailResult> {
  if (!configured) {
    configureEmail();
  }

  if (!configured) {
    console.warn("Email not sent - SendGrid not configured:", options.subject);
    return { success: false, error: "SendGrid not configured" };
  }

  try {
    const [response] = await sgMail.send({
      to: options.to,
      from: {
        email: getDefaultFromEmail(),
        name: getDefaultFromName(),
      },
      subject: options.subject,
      html: options.html,
      text: options.text ?? stripHtml(options.html),
      replyTo: options.replyTo,
    });

    return {
      success: true,
      messageId: response.headers["x-message-id"],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to send email:", message);
    return { success: false, error: message };
  }
}

export async function sendBatchEmails(
  emails: SendEmailOptions[]
): Promise<EmailResult[]> {
  return Promise.all(emails.map(sendEmail));
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
