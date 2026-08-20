/**
 * Static replacement for the deleted Express inquiry endpoint.
 *
 * GitHub Pages cannot accept a POST, so the form submits to a third-party
 * endpoint (Formspree) configured at build time via FORMSPREE_ENDPOINT.
 * When that is not configured the form degrades gracefully to a prefilled
 * mailto: link — no JavaScript backend required either way.
 */
import { SITE } from './site';

const FIELDS = [
  { name: 'name', label: 'Your name', type: 'text', required: true, autocomplete: 'name' },
  { name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email' },
  { name: 'phone', label: 'Phone', type: 'tel', required: false, autocomplete: 'tel' },
  { name: 'model', label: 'Model you are interested in', type: 'text', required: false, autocomplete: 'off' },
];

function mailtoHref(data: Record<string, string>): string {
  const subject = `Website inquiry${data.model ? ` — ${data.model}` : ''}`;
  const body = [
    `Name: ${data.name || ''}`,
    `Email: ${data.email || ''}`,
    `Phone: ${data.phone || ''}`,
    `Model: ${data.model || ''}`,
    '',
    data.message || '',
  ].join('\n');
  return `mailto:${SITE.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function renderContactForm(mount: HTMLElement) {
  mount.innerHTML = `
    <form class="tara-form" novalidate>
      <div class="tara-form-grid">
        ${FIELDS.map(
          (f) => `
          <label class="tara-field">
            <span>${f.label}${f.required ? ' *' : ''}</span>
            <input type="${f.type}" name="${f.name}" autocomplete="${f.autocomplete}"
                   ${f.required ? 'required' : ''} />
          </label>`,
        ).join('')}
        <label class="tara-field tara-field-wide">
          <span>How can we help?</span>
          <textarea name="message" rows="5"></textarea>
        </label>
      </div>
      <!-- Honeypot: bots fill hidden fields, humans do not. -->
      <input type="text" name="_gotcha" tabindex="-1" autocomplete="off"
             style="position:absolute;left:-9999px" aria-hidden="true" />
      <div class="tara-form-actions">
        <button type="submit" class="tara-form-submit">Send inquiry</button>
        <span class="tara-form-alt">or call <a href="${SITE.phoneHref}">${SITE.phone}</a>
          &middot; <a href="mailto:${SITE.email}">${SITE.email}</a></span>
      </div>
      <p class="tara-form-status" role="status" aria-live="polite"></p>
    </form>`;

  const form = mount.querySelector('form') as HTMLFormElement;
  const status = mount.querySelector('.tara-form-status') as HTMLParagraphElement;
  const submit = mount.querySelector('.tara-form-submit') as HTMLButtonElement;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form) as unknown as Iterable<[string, string]>);
    if (data._gotcha) return; // silently drop bot submissions

    if (!data.name || !data.email) {
      status.textContent = 'Please add your name and email so we can reply.';
      status.className = 'tara-form-status is-error';
      return;
    }

    if (!SITE.formEndpoint) {
      // No third-party endpoint configured — hand off to the mail client.
      status.textContent = 'Opening your email app…';
      status.className = 'tara-form-status';
      window.location.href = mailtoHref(data);
      return;
    }

    submit.disabled = true;
    status.textContent = 'Sending…';
    status.className = 'tara-form-status';
    try {
      const res = await fetch(SITE.formEndpoint, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ ...data, _subject: `Website inquiry — ${data.name}` }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      form.reset();
      status.textContent = 'Thanks — we received your inquiry and will be in touch shortly.';
      status.className = 'tara-form-status is-ok';
    } catch {
      status.textContent = 'That did not go through. Please email us directly:';
      status.className = 'tara-form-status is-error';
      const link = document.createElement('a');
      link.href = mailtoHref(data);
      link.textContent = SITE.email;
      status.append(' ', link);
    } finally {
      submit.disabled = false;
    }
  });
}
