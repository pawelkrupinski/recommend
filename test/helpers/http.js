// Shared in-process HTTP harness for integration tests: boot the real server on
// an ephemeral port and drive it over fetch with a cookie-tracking client. The
// per-file copies in api.test.js / i18n.test.js predate this helper and can fold
// into it in a follow-up.
import assert from 'node:assert/strict';

// Listen on an ephemeral port; returns { base, close }.
export async function serve(server) {
  await new Promise((r) => server.listen(0, r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

// Minimal cookie-tracking client bound to `base`. `extraHeaders` ride on every
// request (e.g. a Cloudflare CF-IPCountry header or an Accept-Language).
export function client(base, extraHeaders = {}) {
  let cookie = '';
  return {
    async raw(path, { method = 'GET', body } = {}) {
      const res = await fetch(base + path, {
        method,
        redirect: 'manual',
        headers: { ...extraHeaders, ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.getSetCookie?.() || [];
      if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
      return res;
    },
    async json(path, opts) {
      const res = await this.raw(path, opts);
      return { status: res.status, data: await res.json().catch(() => null) };
    },
    async login({ email = 'tester@example.com', admin = false, onboarded = true } = {}) {
      const q = new URLSearchParams({ email, ...(admin ? { admin: '1' } : {}), ...(onboarded ? {} : { onboarded: '0' }) });
      const res = await this.raw('/auth/dev-login?' + q);
      assert.equal(res.status, 302, 'dev-login redirects');
      return this;
    },
    get cookie() { return cookie; },
  };
}
