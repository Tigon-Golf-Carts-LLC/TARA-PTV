/**
 * Static replacement for the original site's /search.php.
 *
 * Searching runs entirely in the browser against the build-time index at
 * public/data/search-index.json — no server, no API.
 */
import { BASE, url } from './site';

type IndexEntry = { p: string; t: string; d: string; k: string };

let indexPromise: Promise<IndexEntry[]> | null = null;

function loadIndex(): Promise<IndexEntry[]> {
  indexPromise ??= fetch(`${BASE}data/search-index.json`).then((r) => r.json() as Promise<IndexEntry[]>);
  return indexPromise;
}

function score(entry: IndexEntry, terms: string[]): number {
  const title = entry.t.toLowerCase();
  const desc = entry.d.toLowerCase();
  const body = entry.k.toLowerCase();
  let total = 0;
  for (const term of terms) {
    if (title.includes(term)) total += 10;
    if (desc.includes(term)) total += 4;
    if (body.includes(term)) total += 1;
    if (entry.p.includes(term)) total += 3;
  }
  // Every term has to appear somewhere, otherwise it is not a match.
  return terms.every((t) => title.includes(t) || desc.includes(t) || body.includes(t) || entry.p.includes(t))
    ? total
    : 0;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function renderSearchPage(mount: HTMLElement, query: string) {
  mount.innerHTML = `
    <section class="tara-search">
      <h1>Search</h1>
      <form class="tara-search-form" role="search">
        <input type="search" name="q" value="${escape(query)}" placeholder="Search vehicles, accessories, support…"
               aria-label="Search this site" />
        <button type="submit">Search</button>
      </form>
      <div class="tara-search-results" aria-live="polite"><p>Loading the search index…</p></div>
    </section>`;

  const form = mount.querySelector('form') as HTMLFormElement;
  const input = mount.querySelector('input[name="q"]') as HTMLInputElement;
  const results = mount.querySelector('.tara-search-results') as HTMLDivElement;

  const run = async (q: string) => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) {
      results.innerHTML = '<p>Type something above to search the site.</p>';
      return;
    }
    const index = await loadIndex();
    const hits = index
      .map((entry) => ({ entry, s: score(entry, terms) }))
      .filter((h) => h.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50);

    if (!hits.length) {
      results.innerHTML = `<p>No pages matched &ldquo;${escape(q)}&rdquo;.</p>`;
      return;
    }
    results.innerHTML =
      `<p class="tara-search-count">${hits.length} result${hits.length === 1 ? '' : 's'} for &ldquo;${escape(q)}&rdquo;</p>` +
      `<ul class="tara-search-list">${hits
        .map(
          ({ entry }) =>
            `<li><a href="${url(entry.p)}">${escape(entry.t)}</a><p>${escape(entry.d.slice(0, 180))}</p></li>`,
        )
        .join('')}</ul>`;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const q = input.value.trim();
    // Keep the URL shareable without ever leaving the static page.
    const next = `${url('/search/')}${q ? `?q=${encodeURIComponent(q)}` : ''}`;
    window.history.replaceState({}, '', next);
    void run(q);
  });

  await run(query);
}

/**
 * The mirrored pages still carry the theme's header search box. Intercept it
 * so it routes to the static search page instead of the old PHP handler.
 */
export function wireSearchForms(root: ParentNode) {
  for (const form of Array.from(root.querySelectorAll<HTMLFormElement>('form[data-static-search]'))) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const field = form.querySelector<HTMLInputElement>('input[name="q"], input[type="search"], input[type="text"]');
      const q = field?.value.trim() ?? '';
      window.location.href = `${url('/search/')}${q ? `?q=${encodeURIComponent(q)}` : ''}`;
    });
  }
}
