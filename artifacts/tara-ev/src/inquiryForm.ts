import { COUNTRIES } from './countries';

const BASE = import.meta.env.BASE_URL;

const FORM_STYLE = `
.tara-inquiry-wrapper { max-width: 600px; margin: 10px auto; padding: 0 15px; }
.tara-inquiry-row { display: block; margin-bottom: 20px; }
.tara-inquiry-row input,
.tara-inquiry-row select,
.tara-inquiry-row textarea {
  width: 100%; box-sizing: border-box; padding: 12px 14px;
  border: 1px solid #d5d5d5; border-radius: 4px;
  font-size: 15px; font-family: inherit; color: #333; background: #fff;
}
.tara-inquiry-row textarea { min-height: 120px; resize: vertical; }
.tara-inquiry-row input:focus,
.tara-inquiry-row select:focus,
.tara-inquiry-row textarea:focus { outline: none; border-color: #cf2e2e; }
.tara-inquiry-submit {
  display: inline-block; padding: 12px 40px; border: none; border-radius: 4px;
  background: #cf2e2e; color: #fff; font-size: 16px; font-weight: 700;
  cursor: pointer; transition: background .2s;
}
.tara-inquiry-submit:hover { background: #a32222; }
.tara-inquiry-submit[disabled] { opacity: .6; cursor: default; }
.tara-inquiry-error { margin-bottom: 10px; color: #c0392b; }
.tara-inquiry-success { margin-bottom: 10px; color: #27ae60; font-weight: 700; }
`;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/**
 * Renders the self-hosted inquiry form into `container` and wires it to the
 * project's API server (POST /api/inquiries). Replaces the discontinued
 * external Mautic embedded form, keeping the same fields.
 */
export function mountInquiryForm(container: Element): void {
  const options = COUNTRIES.map(
    (c) => `<option value="${esc(c)}">${esc(c)}</option>`,
  ).join('');

  container.innerHTML = `
  <style>${FORM_STYLE}</style>
  <div class="tara-inquiry-wrapper">
    <form class="tara-inquiry-form" novalidate>
      <div class="tara-inquiry-error" hidden></div>
      <div class="tara-inquiry-success" hidden></div>
      <!-- honeypot: hidden from real users, filled by bots -->
      <div style="display:none" aria-hidden="true">
        <input name="website" type="text" tabindex="-1" autocomplete="off" />
      </div>
      <div class="tara-inquiry-row">
        <input name="name" type="text" placeholder="Name" required maxlength="200" />
      </div>
      <div class="tara-inquiry-row">
        <input name="email" type="email" placeholder="Your E-mail Address" required maxlength="320" />
      </div>
      <div class="tara-inquiry-row">
        <select name="inquiryType">
          <option value="">Select an Option</option>
          <option value="Dealer">Dealer</option>
          <option value="Customer">Customer</option>
        </select>
      </div>
      <div class="tara-inquiry-row">
        <input name="phone" type="tel" placeholder="Phone Number" maxlength="50" />
      </div>
      <div class="tara-inquiry-row">
        <select name="country">
          <option value="">Country</option>
          ${options}
        </select>
      </div>
      <div class="tara-inquiry-row">
        <textarea name="message" placeholder="Do you have any questions for us?" maxlength="5000"></textarea>
      </div>
      <div class="tara-inquiry-row" style="text-align:center">
        <button type="submit" class="tara-inquiry-submit">SUBMIT</button>
      </div>
    </form>
  </div>`;

  const form = container.querySelector<HTMLFormElement>('.tara-inquiry-form')!;
  const errorEl = form.querySelector<HTMLElement>('.tara-inquiry-error')!;
  const successEl = form.querySelector<HTMLElement>('.tara-inquiry-success')!;
  const submitBtn = form.querySelector<HTMLButtonElement>('.tara-inquiry-submit')!;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;

    const data = Object.fromEntries(new FormData(form).entries());
    if (!String(data['name'] || '').trim() || !String(data['email'] || '').trim()) {
      errorEl.textContent = 'Please fill in your name and e-mail address.';
      errorEl.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Please wait ...';
    try {
      const res = await fetch(`${BASE}api/inquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, page: window.location.pathname }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body?.error === 'string'
            ? body.error
            : 'Something went wrong. Please try again or email us directly at sales@taragolfcart.com.',
        );
      }
      form.reset();
      successEl.textContent =
        'Thank you! Your message has been sent. We will get back to you shortly.';
      successEl.hidden = false;
    } catch (err) {
      errorEl.textContent =
        err instanceof Error
          ? err.message
          : 'Something went wrong. Please try again or email us directly at sales@taragolfcart.com.';
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'SUBMIT';
    }
  });
}
