// Small fetch wrapper + session state shared by every page.
export const auth = {
  token: localStorage.getItem('shiver.token') || '',
  user: null,
  set(token, user) {
    this.token = token || '';
    this.user = user || null;
    if (token) localStorage.setItem('shiver.token', token);
    else localStorage.removeItem('shiver.token');
    dispatchEvent(new Event('auth'));
  },
};

export async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(auth.token ? { Authorization: 'Bearer ' + auth.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function guestName() {
  let n = localStorage.getItem('shiver.guest');
  if (!n) { n = 'Guest' + Math.floor(1000 + Math.random() * 9000); localStorage.setItem('shiver.guest', n); }
  return n;
}
