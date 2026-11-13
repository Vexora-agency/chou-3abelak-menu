# Phase 4 — Google Login Runbook

Status: 🟨 code + UI deployed to production; **owner must create the Google OAuth client and add two secrets** before the button appears.
Date: 2026-11-13

> **بالعربي باختصار:** كود جوجل جاهز، وزرار "المتابعة باستخدام Google"
> بيظهر فقط لما `GOOGLE_CLIENT_ID` و`GOOGLE_CLIENT_SECRET` يكونوا
> متظبطين. محتاج تعمل OAuth Client في Google Cloud Console وتضيف
> الاثنين في Cloudflare، وبعدها نعمل deploy ونجرب.

---

## 1. What the code already does

- `socialProviders.google` is enabled only when **both** env values exist.
- `/api/auth/public-config` returns `{ google: true|false }`; the auth sheet
  calls it and hides the Google button until both values are present.
- Google button sits above the email form with an "or" divider.
- On success Google returns to `/?account=1`; the storefront opens the account
  sheet automatically and strips the marker from the URL.
- Minimal scopes: `openid`, `email`, `profile` (Better Auth's Google defaults).
- `account.encryptOAuthTokens: true`, OAuth state in the database.
- Google avatars are allowed by CSP (`https://lh3.googleusercontent.com`).
- Account linking keeps Better Auth's safe default (`requireLocalEmailVerified`):
  a Google email that already belongs to an **unverified password account**
  is not silently linked. The UI asks the customer to sign in with their
  password first.

No Google button is rendered while credentials are missing, so production is
safe to deploy before the Console step.

---

## 2. Google Cloud Console (owner, once)

1. Open <https://console.cloud.google.com/> and create/select a project.
2. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - App name: `Chou 3abelak`.
   - User support email + developer contact email.
   - Scopes: add `openid`, `email`, `profile` only.
   - While in **Testing**, add the Google accounts you will test with.
   - When ready, **Publish app** (otherwise only test users can sign in).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Name: `Chou 3abelak — production`.
4. **Authorized JavaScript origins** (exact, no trailing slash):
   ```
   https://chou3abelak.site
   http://localhost:3000
   ```
5. **Authorized redirect URIs** (exact, no trailing slash):
   ```
   https://chou3abelak.site/api/auth/callback/google
   http://localhost:3000/api/auth/callback/google
   ```
6. Copy the **Client ID** and **Client secret**.

> The Google flow is configured for the canonical apex
> `https://chou3abelak.site` (that is `BETTER_AUTH_URL`). If visitors can open
> `https://www.chou3abelak.site`, add a Cloudflare Redirect Rule
> `www.chou3abelak.site/* → https://chou3abelak.site/$1` (301). The OAuth state
> cookie and callback must stay on one host; a www→apex redirect avoids
> `state_invalid`. Do not add wildcard origins.

---

## 3. Add the two values

### Local (`.dev.vars`, git-ignored)

```bash
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
```

Then restart `serve-local.bat` / `wrangler pages dev`.

### Production (Cloudflare Pages)

Dashboard → Pages project → **Settings → Environment variables → Production**:

| Name | Type | Value |
|------|------|-------|
| `GOOGLE_CLIENT_ID` | Plain text (public identifier) | the client ID |
| `GOOGLE_CLIENT_SECRET` | **Secret** | the client secret |

CLI alternative (prompts for the value, never put it in shell history):

```bash
npx wrangler pages secret put GOOGLE_CLIENT_ID --project-name chou-3abelak-menu
npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name chou-3abelak-menu
```

Then **redeploy** the latest `main` build so the env values are picked up.

Never put `GOOGLE_CLIENT_SECRET` in `wrangler.toml`, git, a `VITE_*` variable,
or chat.

---

## 4. Test after deploy

1. Open `https://chou3abelak.site`.
2. Click the profile button → the auth sheet now shows **Continue with Google**
   above the email form with an "or" divider.
3. Click it, choose a Google account.
4. Expected: return to `https://chou3abelak.site/?account=1`, the account sheet
   opens, header shows the Google name/avatar, and `/api/auth/get-session`
   returns the user.
5. Sign out, sign in with Google again.
6. Open `/admin` and confirm the admin login still works.
7. Check the Google avatar renders (CSP `img-src` already allows
   `lh3.googleusercontent.com`).
8. Check the account sheet shows the Google name/email; phone/address can be
   filled in Settings.

### If the button is hidden

- Both values must be present and non-empty.
- Env changes require a **new deployment**.
- `GET /api/auth/public-config` should return `{"google":true}`.
- If it returns `false`, one of the two values is missing in the environment
  that served the request (Production vs Preview are separate).

### Common errors

| Error | Cause / fix |
|-------|-------------|
| `redirect_uri_mismatch` | The exact callback URI is missing in Google Console, or the site is on `www` while `BETTER_AUTH_URL` is apex. Add the exact URI / add the www→apex redirect. |
| `state_invalid` | OAuth started on one host and returned to another, or the state expired. Keep one canonical host; retry from the apex. |
| `access_denied` | The user cancelled, or the app is still in Testing and their Google account is not a test user. |
| Button hidden | One of the two env values is missing/blank, or the deploy predates the env change. |
| Avatar broken | CSP host missing (already added) or Google image URL invalid; the UI falls back to the initial. |
| `account_not_linked` | The Google email matches an existing **unverified** password account. Sign in with the password first; Phase 5 email verification will make linking smoother. |

---

## 5. Verification already completed (without real Google credentials)

- `isGoogleConfigured` unit tests: missing/blank/one-only = off; both = on.
- `createAuth` exposes the Google provider only when both values exist.
- `/api/auth/public-config` returns `false` then `true` with fake credentials.
- With fake credentials, `/api/auth/sign-in/social` generated:
  - `redirect_uri=http://localhost:3000/api/auth/callback/google`
  - `scope=email profile openid` (no duplicates)
  - `prompt=select_account`
- Production-safe: with credentials absent, the Google button is not rendered.

Real Google consent/login is the only step that cannot be verified until the
owner creates the client and adds the two secrets.

---

## 6. Production deployment (2026-11-13)

| Item | Value |
|------|-------|
| PR | #120 `feat/google-auth` → `main` |
| Merge commit | `52c29c9` |
| Pages deployment | `1470eaf0-fa5d-4a3e-9744-6687cc072212` (Active, Production) |
| Production probe | `GET /api/auth/public-config` → `{"google":false}` (button correctly hidden) |

The production environment does **not** have Google credentials yet. That is
the expected safe state: the code is live, the button is hidden, and no broken
OAuth flow is exposed. Once the two values are added and the project is
redeployed, the same URL will return `{"google":true}` and the button appears.

