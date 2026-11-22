# SMS OTP fallback via UniMTX

Members without WhatsApp can still verify their number. WhatsApp stays the
primary (free) path; the SMS fallback is offered only when the member asks for
help or after 60 seconds without completing the WhatsApp flow. This means a
member who has WhatsApp never pays for an SMS.

## Why there is no automatic WhatsApp pre-check

Neither the WhatsApp Cloud API nor UniMTX exposes an official "does this number
have WhatsApp?" lookup. Anything that claims to check a number without sending
is unofficial (scraping/guessing), against WhatsApp's terms, and unreliable.
Sending a WhatsApp template just to probe the number is paid, requires template
eligibility, and can fail for unrelated reasons.

The reliable, cost-safe design is **behaviour-based routing**:

1. Show WhatsApp first; most members have it and send the pre-filled message.
2. If they tap **Need help?** or 60 seconds pass without verification, reveal
   **Send SMS code**.
3. The SMS code is sent by UniMTX; the member types it on the site; the server
   verifies it automatically. No owner call.

## UniMTX setup

1. Create/sign in at <https://console.unimtx.com>.
2. Open **Credentials** and copy the **AccessKey ID**.
   - If the account is in **HMAC mode**, also copy the **AccessKey Secret**.
   - The default is **Simple mode** (AccessKey ID only).
3. Make sure the account has a positive balance (the API returns
   `InsufficientFunds` otherwise).
4. If **IP Restriction** is enabled, allow Cloudflare Workers (their egress IPs
   vary; the simplest is to disable IP restriction for this key).
5. The Send OTP API uses UniMTX's built-in OTP template; no per-request sender
   name is required. If the console asks for a default sender/template, use the
   OTP defaults.
6. The built-in OTP text **cannot be customised**. For a branded Arabic/English
   message, create a normal SMS template (next section) and set
   `UNIMTX_SMS_TEMPLATE_ID`.

## Custom branded SMS template (optional, recommended)

The OTP API always sends UniMTX's own wording. A normal SMS template lets the
message say **Chou 3abelak** and read naturally. In the console, open
**SMS → Templates → Create template** and use:

| Field | Value |
|---|---|
| **Scene** | Identity verification |
| **Content (Arabic)** | `كود التحقق الخاص بك في شو عبالك هو {code}. صالح لمدة 5 دقائق. لا تشاركه مع أحد.` |
| **Content (English)** | `Your Chou 3abelak verification code is {code}. Valid for 5 minutes. Never share it.` |
| **Custom code** | `chou3abelak_verify` |
| **Remarks** | `Phone verification on chou3abelak.site` |

The template may contain only simple text and `{code}`. Do **not** add symbols
such as `【】★※→●`; the console rejects them. Keep it under 460 characters.

Wait until UniMTX **approves** the template, then add the custom code as an
environment variable in Cloudflare Pages (**Production** and **Preview**):

```bash
npx wrangler pages secret put UNIMTX_SMS_TEMPLATE_ID --project-name chou-3abelak-menu
# value: chou3abelak_verify
```

Then **Retry deployment**. With the variable set:

- the server generates the 6-digit code itself;
- only a keyed hash is stored in `phone_verifications.code_hash`;
- UniMTX sends `sms.message.send` with `templateId` + `templateData: { code }`;
- the member's code is checked against our hash locally (no second provider
  call).

If the variable is unset, the old built-in `otp.send` / `otp.verify` flow stays
active, so this is safe to roll out gradually.

## Environment variables (Cloudflare Pages)

Add in **Production** and **Preview**, then **Retry deployment**:

| Variable | Required | What |
|---|---|---|
| `UNIMTX_ACCESS_KEY_ID` | yes | AccessKey ID from the console. |
| `UNIMTX_ACCESS_KEY_SECRET` | only for HMAC mode | AccessKey Secret. Without it the request uses simple mode. |
| `UNIMTX_API_BASE` | optional | Defaults to `https://api.unimtx.com`. |
| `UNIMTX_SMS_DAILY_MAX` | optional | Global SMS send cap/day, default `100` (max 1000). |
| `UNIMTX_SMS_TEMPLATE_ID` | optional | Custom template code (e.g. `chou3abelak_verify`). Enables the branded template flow. |

Do not paste the secret into chat. Add it in the Cloudflare dashboard or with:

```bash
npx wrangler pages secret put UNIMTX_ACCESS_KEY_ID --project-name chou-3abelak-menu
npx wrangler pages secret put UNIMTX_ACCESS_KEY_SECRET --project-name chou-3abelak-menu
```

## Flow

1. Member taps **Need help?** under the WhatsApp button (or the panel appears
   after 60 s).
2. **Send SMS code** → `POST /api/account/phone-verification` with
   `{ phone, method: 'sms', lang }`.
3. The server calls UniMTX. With `UNIMTX_SMS_TEMPLATE_ID` set it generates the
   code and calls `sms.message.send` (`templateId`, `templateData: { code }`);
   otherwise it calls `otp.send` (`channel: sms`, `digits: 6`,
   `intent: phone_verification`, `ttl: 300`). Either way it stores a pending row
   with `method='sms'` and the UniMTX message id.
4. The member receives the SMS, types the 6-digit code on the sheet, and taps
   **Confirm code**.
5. `POST /api/account/phone-verification` with
   `{ action: 'verify', phone, code }` checks our stored keyed hash in template
   mode, or calls UniMTX `otp.verify` in built-in OTP mode.
6. Valid → row approved (`decided_by='sms'`), sheet shows **Number verified**.
   Invalid → `code_invalid` and the row stays pending (max 5 attempts).
   If the member changed their saved phone while the code was pending, the row
   is revoked and the sheet says the code was cancelled (request a new SMS).

The **order** gate requires an approved row. The profile PATCH can save a
changed number immediately (even unverified); checkout then asks for
verification before the order. The owner does not call anyone and does not
approve SMS rows manually.

## Cost control

- WhatsApp replies are still service messages (first 1,000/month per business
  number free as of Oct 1, 2026).
- SMS is sent **only** on the explicit fallback; WhatsApp users don't generate
  SMS charges.
- Per member+number caps: 5/hour and 15/day (shared with WhatsApp).
- Global daily SMS cap: `UNIMTX_SMS_DAILY_MAX` (default 100). At ~$0.30/SMS that
  bounds a burst at ~$30/day; tune it to your budget.
- Check the Lebanon SMS rate in the UniMTX console; it varies by destination
  and route. The fallback is for the minority of members, so the monthly cost
  is usually small.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `sms_unavailable` | `UNIMTX_ACCESS_KEY_ID` missing or the deployment wasn't retried. |
| `sms_failed` | Invalid number, no balance, IP restriction, wrong credentials, or the custom template is not approved yet. Check the UniMTX console logs. |
| `code_invalid` | Wrong/expired code. The member can retry up to 5 times or request a new SMS. |
| `too_many_attempts` | 5 wrong entries; wait for expiry or request a new SMS. |
| `phone_changed` | The saved profile number changed while the code was pending; that row is revoked. Request a new SMS for the current number. |
| `sms_rate_limited` | Global daily cap reached; use WhatsApp or raise the cap. |
| HMAC signature errors | Remove `UNIMTX_ACCESS_KEY_SECRET` to use simple mode, or verify the console is in HMAC mode. |

## Tests

```bash
node scripts/test-sms-verification.mjs
```

Covers E.164 normalization, simple/HMAC query signing, `otp.send`/`otp.verify`
parsing, the SMS daily cap, the 5-attempt lock, and the UI wiring.
