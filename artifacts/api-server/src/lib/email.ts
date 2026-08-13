import { ReplitConnectors } from "@replit/connectors-sdk";

export type Inquiry = {
  name: string;
  email: string;
  inquiryType: string;
  phone: string;
  country: string;
  message: string;
  page: string;
  submittedAt: string;
};

/** Where the client receives website inquiries. */
export const INQUIRY_RECIPIENT = "sales@taragolfcart.com";

/**
 * Strip characters that are illegal in RFC 2822 header values — CR, LF, NUL —
 * to prevent header injection attacks.
 */
function safeHeader(value: string): string {
  // Remove CR, LF, NUL, and any other control characters.
  return value.replace(/[\x00-\x1f\x7f]/g, " ").trim();
}

/**
 * Build a minimal RFC 2822 message and base64url-encode it for the Gmail API.
 */
function buildRaw(inquiry: Inquiry): string {
  const safeName = safeHeader(inquiry.name);
  const safeEmail = safeHeader(inquiry.email);
  const safeType = safeHeader(inquiry.inquiryType);

  const subject = safeHeader(
    `[Website Inquiry] ${safeType ? safeType + " \u2013 " : ""}${safeName}`,
  );

  const body = [
    `Name: ${inquiry.name}`,
    `Email: ${inquiry.email}`,
    `Inquiry Type: ${inquiry.inquiryType || "\u2014"}`,
    `Phone: ${inquiry.phone || "\u2014"}`,
    `Country: ${inquiry.country || "\u2014"}`,
    ``,
    `Message:`,
    inquiry.message || "(no message)",
    ``,
    `---`,
    `Submitted at: ${inquiry.submittedAt}`,
    `Page: ${inquiry.page || "\u2014"}`,
  ].join("\r\n");

  const mime = [
    `From: me`,
    `To: ${INQUIRY_RECIPIENT}`,
    `Reply-To: ${safeName} <${safeEmail}>`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body,
  ].join("\r\n");

  // base64url-encode (Gmail API requirement)
  return Buffer.from(mime).toString("base64url");
}

/**
 * Sends an inquiry notification email to the client via the Gmail connector.
 * The connected Google account must have gmail.send scope.
 */
export async function sendInquiryEmail(inquiry: Inquiry): Promise<void> {
  const connectors = new ReplitConnectors();
  const raw = buildRaw(inquiry);

  const response = await connectors.proxy(
    "google-mail",
    "/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Gmail API error ${response.status}: ${text}`);
  }
}
