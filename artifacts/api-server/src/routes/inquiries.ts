import { Router, type IRouter } from "express";
import { sendInquiryEmail } from "../lib/email";
import { isAllowed } from "../lib/rateLimit";

const router: IRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 5 submissions per trusted IP per 15 minutes. */
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;

router.post("/inquiries", async (req, res) => {
  // --- Anti-automation: honeypot field ---
  // The hidden `website` field is left blank by real visitors but filled by
  // most bots. Reject silently (200) to avoid leaking the check.
  if (req.body?.website) {
    res.status(200).json({ ok: true });
    return;
  }

  // --- Rate limiting ---
  // req.ip is resolved by Express using the trust-proxy setting configured in
  // app.ts — it is NOT taken blindly from X-Forwarded-For headers.
  const ip = req.ip ?? "unknown";
  if (!isAllowed(ip, RATE_LIMIT, RATE_WINDOW_MS)) {
    res.status(429).json({
      error:
        "Too many submissions. Please wait a few minutes before trying again.",
    });
    return;
  }

  // --- Input validation ---
  const { name, email, inquiryType, phone, country, message, page } =
    req.body ?? {};

  const cleanName = typeof name === "string" ? name.trim().slice(0, 200) : "";
  const cleanEmail =
    typeof email === "string" ? email.trim().slice(0, 320) : "";

  if (!cleanName || !cleanEmail || !EMAIL_RE.test(cleanEmail)) {
    res
      .status(400)
      .json({ error: "Please provide a valid name and e-mail address." });
    return;
  }

  const inquiry = {
    name: cleanName,
    email: cleanEmail,
    inquiryType:
      typeof inquiryType === "string" ? inquiryType.slice(0, 50) : "",
    phone: typeof phone === "string" ? phone.slice(0, 50) : "",
    country: typeof country === "string" ? country.slice(0, 100) : "",
    message: typeof message === "string" ? message.slice(0, 5000) : "",
    page: typeof page === "string" ? page.slice(0, 500) : "",
    submittedAt: new Date().toISOString(),
  };

  try {
    await sendInquiryEmail(inquiry);
  } catch (err) {
    // Log only non-PII delivery metadata — no name, email, phone, or message.
    req.log.error(
      { err, inquiryType: inquiry.inquiryType, page: inquiry.page },
      "Failed to deliver inquiry email",
    );
    res.status(502).json({
      error:
        "We could not send your message right now. Please email us directly at sales@taragolfcart.com.",
    });
    return;
  }

  req.log.info(
    { inquiryType: inquiry.inquiryType, page: inquiry.page },
    "Inquiry delivered",
  );
  res.status(201).json({ ok: true });
});

export default router;
