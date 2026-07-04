// OAuth login (Google + Facebook) and signed-cookie sessions — no dependencies.
//
// Sessions: a cookie `rid` holding base64url(JSON{uid,iat}).<HMAC-SHA256> signed
// with APPLICATION_SECRET. OAuth CSRF state rides in a separate short-lived
// signed cookie `oauth`. We mirror the movies app's convention of one callback
// path per provider: /auth/<provider>/callback.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './env.js';
import { upsertUserFromLogin, getUserById, setUserAdmin, setUserSetting,
  createAnonUser, mergeUserData, deleteAccount, hasUserContent } from './db.js';
import { invalidateRecommendations } from './taste.js';
import { fetchWithTimeout } from './fetch.js';
import { readBody } from './http.js';

const SESSION_COOKIE = 'rid';
const STATE_COOKIE = 'oauth';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days (seconds)
const STATE_MAX_AGE = 10 * 60 * 1000;      // 10 minutes (ms)
const EXCHANGE_MAX_AGE = 5 * 60 * 1000;    // 5 minutes (ms): one-shot code lifetime
// The native Android app can't share the browser's session cookie, so OAuth for it
// ends by bouncing back into the app through this deep link with a one-shot `code`
// the app redeems at POST /auth/exchange (mirrors the movies app's kinowo://auth-done).
const ANDROID_REDIRECT = 'filmowo://auth-done';

// ---- signing helpers ------------------------------------------------------
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => createHmac('sha256', config.appSecret).update(data).digest('base64url');

function pack(obj) {
  const body = b64url(JSON.stringify(obj));
  return `${body}.${sign(body)}`;
}
function unpack(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = sign(body);
  // constant-time compare; lengths must match for timingSafeEqual
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
}

// ---- cookies --------------------------------------------------------------
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function cookie(name, value, { maxAge, secure } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
  if (maxAge != null) c += `; Max-Age=${maxAge}`;
  if (secure) c += '; Secure';
  return c;
}

// ---- request origin -------------------------------------------------------
// Prefer an explicit BASE_URL; otherwise derive from forwarded headers so OAuth
// callback URLs match whatever host the user actually reached us on.
export function requestOrigin(req) {
  if (config.baseUrl) return config.baseUrl;
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (req.socket.encrypted ? 'https' : 'http');
  const host = (req.headers['x-forwarded-host'] || req.headers.host || `localhost:${config.port}`).split(',')[0].trim();
  return `${proto}://${host}`;
}
const isSecure = (req) => requestOrigin(req).startsWith('https');
const redirectUri = (req, provider) => `${requestOrigin(req)}/auth/${provider}/callback`;

// ---- session API ----------------------------------------------------------
export function currentUser(req) {
  const sess = unpack(parseCookies(req)[SESSION_COOKIE]);
  if (!sess?.uid) return null;
  return getUserById(sess.uid) || null;
}
// Resolve the session's user, minting a fresh anonymous account (and setting the
// session cookie on `res`) when there isn't one. This is what removes the need to
// log in: every API request is backed by a real user row, anonymous or not, so
// the rest of the server treats anon and signed-in users identically.
export function getOrCreateUser(req, res) {
  const existing = currentUser(req);
  if (existing) return existing;
  const user = createAnonUser();
  setSession(res, req, user.id);
  return user;
}
// Complete a sign-in: upsert the real account, reconcile it with any anonymous
// session the visitor built before logging in, then start a session for the real
// user. Shared by the dev-login bypass and the real OAuth callback.
//
// The account's own data wins: an account that already has content (ratings or a
// watchlist) keeps it and the anonymous session is discarded outright. Only an
// account with no content of its own adopts the anonymous data — so a brand-new
// sign-up keeps what it just rated, without ever clobbering an established
// account. Either way the anonymous user (and its cookie identity) is deleted.
// Reconcile a just-authenticated real `user` with any anonymous session the caller
// carried in, then start a session for the real user. Split out from signInAs so the
// Android exchange can run it against the *app's* cookies (see /auth/exchange): the
// browser tab that did the OAuth dance and the app that redeems the code have
// separate cookie jars, and it's the app's jar whose anon data we want to adopt.
function reconcileAndStartSession(req, res, user, extraCookies = []) {
  const anon = currentUser(req);
  if (anon?.provider === 'anon' && anon.id !== user.id) {
    if (!hasUserContent(user.id) && mergeUserData(anon.id, user.id)) invalidateRecommendations(user.id);
    deleteAccount(anon.id);
  }
  setSession(res, req, user.id, extraCookies);
  return user;
}
function signInAs(req, res, profile, extraCookies = []) {
  return reconcileAndStartSession(req, res, upsertUserFromLogin(profile), extraCookies);
}
// A one-shot, HMAC-signed code that binds a freshly-authenticated user id for the
// Android app to redeem at /auth/exchange. Short-lived; the app trades it seconds later.
const mintExchangeCode = (userId) => pack({ uid: userId, iat: Date.now(), k: 'exch' });
const androidRedirect = (params) => `${ANDROID_REDIRECT}?${new URLSearchParams(params)}`;
function setSession(res, req, userId, extraCookies = []) {
  res.setHeader('Set-Cookie', [
    cookie(SESSION_COOKIE, pack({ uid: userId, iat: Date.now() }), { maxAge: SESSION_MAX_AGE, secure: isSecure(req) }),
    ...extraCookies,
  ]);
}
function redirect(res, location, cookies = []) {
  res.writeHead(302, { Location: location, ...(cookies.length ? { 'Set-Cookie': cookies } : {}) });
  res.end();
}

// ---- providers ------------------------------------------------------------
const PROVIDERS = {
  google: {
    enabled: () => !!(config.google.id && config.google.secret),
    authUrl(req, state) {
      const p = new URLSearchParams({
        client_id: config.google.id,
        redirect_uri: redirectUri(req, 'google'),
        response_type: 'code',
        scope: 'openid email profile',
        state,
        access_type: 'online',
        prompt: 'select_account',
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
    },
    async profile(req, code) {
      const tok = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.google.id,
          client_secret: config.google.secret,
          redirect_uri: redirectUri(req, 'google'),
          grant_type: 'authorization_code',
        }),
      }).then((r) => r.json());
      if (!tok.access_token) throw new Error('Google token exchange failed');
      const u = await fetchWithTimeout('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      }).then((r) => r.json());
      if (!u.email) throw new Error('Google did not return an email');
      return { email: u.email, name: u.name, picture: u.picture, provider: 'google', provider_sub: u.sub };
    },
  },
  facebook: {
    enabled: () => !!(config.facebook.id && config.facebook.secret),
    authUrl(req, state) {
      const p = new URLSearchParams({
        client_id: config.facebook.id,
        redirect_uri: redirectUri(req, 'facebook'),
        state,
        scope: 'email,public_profile',
        response_type: 'code',
      });
      return `https://www.facebook.com/v19.0/dialog/oauth?${p}`;
    },
    async profile(req, code) {
      const tok = await fetchWithTimeout('https://graph.facebook.com/v19.0/oauth/access_token?' + new URLSearchParams({
        client_id: config.facebook.id,
        client_secret: config.facebook.secret,
        redirect_uri: redirectUri(req, 'facebook'),
        code,
      })).then((r) => r.json());
      if (!tok.access_token) throw new Error('Facebook token exchange failed');
      const u = await fetchWithTimeout('https://graph.facebook.com/me?' + new URLSearchParams({
        fields: 'id,name,email,picture.width(200)',
        access_token: tok.access_token,
      })).then((r) => r.json());
      if (!u.email) throw new Error('Facebook did not return an email (is it granted?)');
      return { email: u.email, name: u.name, picture: u.picture?.data?.url, provider: 'facebook', provider_sub: u.id };
    },
  },
};

export const enabledProviders = () =>
  Object.entries(PROVIDERS).filter(([, p]) => p.enabled()).map(([name]) => name);

// A Set-Cookie value that clears the session cookie — used to log the user out
// after they delete their own account from the app.
export const sessionClearingCookie = (req) =>
  cookie(SESSION_COOKIE, '', { maxAge: 0, secure: isSecure(req) });

// ---- route handler --------------------------------------------------------
// Handles /auth/*; returns true if it took the request, false otherwise.
export async function handleAuth(req, res, url) {
  const path = url.pathname;

  if (path === '/auth/logout') {
    redirect(res, '/', [cookie(SESSION_COOKIE, '', { maxAge: 0, secure: isSecure(req) })]);
    return true;
  }

  // Test-only login bypass. Skips the real OAuth round-trip so automated tests
  // (and local dev) can sign in as an arbitrary account. Strictly gated behind
  // ALLOW_DEV_LOGIN=1 — never set in production, so this is inert on Render.
  //   GET /auth/dev-login?email=&name=&admin=1&onboarded=0
  if (path === '/auth/dev-login' && req.method === 'GET') {
    if (process.env.ALLOW_DEV_LOGIN !== '1') { redirect(res, '/?error=dev_login_disabled'); return true; }
    const email = (url.searchParams.get('email') || 'tester@example.com').toLowerCase();
    const name = url.searchParams.get('name') || 'Test User';
    const profile = { email, name, provider: 'dev', provider_sub: `dev-${email}` };
    // Native-app dev login: skip the browser session and hand back a one-shot code
    // via the deep link, exactly like the real Android OAuth callback below — so
    // tests and local app development can exercise /auth/exchange without real OAuth.
    if (url.searchParams.get('platform') === 'android') {
      const user = upsertUserFromLogin(profile);
      if (url.searchParams.get('admin') === '1') setUserAdmin(user.id, true);
      if (url.searchParams.get('onboarded') === '1') setUserSetting(user.id, 'onboarded', true);
      redirect(res, androidRedirect({ code: mintExchangeCode(user.id) }));
      return true;
    }
    const user = signInAs(req, res, profile);
    if (url.searchParams.get('admin') === '1') setUserAdmin(user.id, true);
    // Default brand-new dev users straight into the app; pass onboarded=0 to
    // exercise the first-run onboarding screen.
    if (url.searchParams.get('onboarded') !== '0') setUserSetting(user.id, 'onboarded', true);
    res.writeHead(302, { Location: '/' });
    res.end();
    return true;
  }

  // Android app: redeem the one-shot code from the deep link for a session cookie.
  // This request comes from the app's own cookie jar (not the OAuth browser tab), so
  // reconcileAndStartSession adopts the app's anonymous data into the real account.
  if (path === '/auth/exchange' && req.method === 'POST') {
    try {
      const { code } = JSON.parse((await readBody(req)) || '{}');
      const tok = unpack(code);
      if (!tok || tok.k !== 'exch' || !tok.uid) throw new Error('Invalid code');
      if (Date.now() - tok.iat > EXCHANGE_MAX_AGE) throw new Error('Code expired');
      const user = getUserById(tok.uid);
      if (!user) throw new Error('Unknown account');
      reconcileAndStartSession(req, res, user); // sets the session cookie on the app's response
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // Start: /auth/<provider>
  const start = path.match(/^\/auth\/(google|facebook)$/);
  if (start && req.method === 'GET') {
    const provider = PROVIDERS[start[1]];
    if (!provider.enabled()) { redirect(res, '/?error=provider_disabled'); return true; }
    // `platform=android` (set by the app's Custom Tab) rides in the signed state so
    // the callback knows to finish via the deep link rather than a browser session.
    const platform = url.searchParams.get('platform') === 'android' ? 'android' : 'web';
    const state = b64url(randomBytes(16));
    const stateCookie = cookie(STATE_COOKIE, pack({ state, provider: start[1], platform, iat: Date.now() }),
      { maxAge: 600, secure: isSecure(req) });
    redirect(res, provider.authUrl(req, state), [stateCookie]);
    return true;
  }

  // Callback: /auth/<provider>/callback
  const cb = path.match(/^\/auth\/(google|facebook)\/callback$/);
  if (cb && req.method === 'GET') {
    const name = cb[1];
    const android = unpack(parseCookies(req)[STATE_COOKIE])?.platform === 'android';
    const clearState = cookie(STATE_COOKIE, '', { maxAge: 0, secure: isSecure(req) });
    try {
      const saved = unpack(parseCookies(req)[STATE_COOKIE]);
      const returnedState = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      if (!code) throw new Error('Missing authorization code');
      if (!saved || saved.provider !== name || saved.state !== returnedState) throw new Error('Invalid OAuth state');
      if (Date.now() - saved.iat > STATE_MAX_AGE) throw new Error('OAuth state expired');
      const prof = await PROVIDERS[name].profile(req, code);
      if (android) {
        // Don't start a session in the browser tab (the app has its own cookie jar);
        // upsert the account and bounce back into the app with a one-shot code that
        // it redeems at /auth/exchange, where the anon-merge runs against its cookies.
        const user = upsertUserFromLogin(prof);
        redirect(res, androidRedirect({ code: mintExchangeCode(user.id) }), [clearState]);
      } else {
        signInAs(req, res, prof, [clearState]);
        res.writeHead(302, { Location: '/' });
        res.end();
      }
    } catch (e) {
      // Bounce the error back into the app (deep link) or the web app accordingly.
      redirect(res, android ? androidRedirect({ error: e.message }) : '/?error=' + encodeURIComponent(e.message), [clearState]);
    }
    return true;
  }

  return false;
}
