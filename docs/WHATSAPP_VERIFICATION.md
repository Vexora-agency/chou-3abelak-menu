# WhatsApp phone verification (automatic)

Reverse verification: the **member messages the business first**, so no outbound
template and no Authentication-template eligibility is involved. The site mints
a 6-digit code (5-minute TTL), the member sends it from their own WhatsApp, and
the Cloud API webhook approves the pending request automatically and replies.

Manual approval in **Admin → Customers → Accounts** stays as a fallback when the
webhook is not configured or a reply fails.

## Flow

1. Member enters a phone number in the cart or Account Settings.
2. The site creates a pending row (member + normalized number + the site
   language), returns the code once, and stores only a keyed hash + a short
   `Ref`.
3. Member taps **Send on WhatsApp**; the message is pre-filled with the code and
   `Ref`.
4. Meta delivers the inbound message to `POST /api/whatsapp/webhook`.
5. The webhook:
   - validates the `X-Hub-Signature-256` HMAC over the raw body;
   - finds the live pending row for the sender number;
   - checks the 6-digit code against the row hash;
   - **correct** → approves the row (`decided_by='whatsapp'`) and replies in the
     member's site language, e.g. `✅ تم تأكيد رقمك بنجاح. يمكنك العودة إلى
     الموقع الآن.` / `✅ Your phone number is verified. You can return to the
     site now.`;
   - **wrong** → keeps the row pending and replies `❌ لقد كتبت كودًا خاطئًا…` /
     `❌ The code you entered is incorrect…`.
6. The member's sheet polls and switches to the success state.

Only the Meta message id, sender number, outcome, and timestamp are stored in
`whatsapp_webhook_events`; the message body and the code are never persisted.
Approvals last **365 days**. The order route checks the exact number being
ordered; the profile API requires an approval only when the number **changes**.

For the full Arabic Meta/Cloudflare walkthrough, see
[`WHATSAPP_CLOUD_API_SETUP_AR.md`](WHATSAPP_CLOUD_API_SETUP_AR.md).

## Cloud API setup

The number must be registered on the **WhatsApp Business Platform (Cloud API)**.
If it is currently on the WhatsApp Business app, Meta's **Coexistence** flow can
connect the same number to the Cloud API; otherwise use a separate Cloud API
number for verification.

1. Create/select a Meta app (Business type) → add the **WhatsApp** product.
2. Link the WhatsApp Business Account (WABA) and register the phone number.
3. Create a **System User** with `whatsapp_business_messaging` and generate a
   permanent access token.
4. Note the **Phone Number ID** (not the phone number).
5. Add the webhook:
   - Callback URL: `https://chou3abelak.site/api/whatsapp/webhook`
   - Verify token: the same random string you put in `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to the **messages** field.
   - Cloudflare Access must **not** cover `/api/whatsapp/webhook` (Meta has no
     Access JWT). The HMAC signature is the gate. The same applies to any WAF
     rule that challenges non-browser POSTs.
6. Ensure the site's WhatsApp number is the Cloud API number. If the public
   restaurant number is different, set `WHATSAPP_VERIFICATION_NUMBER` to the
   Cloud API number; the verification button then messages that number while the
   site keeps its public contact number.

Do **not** paste tokens or the app secret into chat. Add them in
**Cloudflare Pages → Settings → Environment variables** (Production and Preview)
and mark them as secrets.

## Environment variables

| Variable | Required | What |
|---|---|---|
| `WHATSAPP_APP_SECRET` | yes (webhook) | Meta app secret used to verify `X-Hub-Signature-256`. Without it the webhook answers 503. |
| `WHATSAPP_VERIFY_TOKEN` | yes (webhook) | Random string you choose; pasted into Meta's webhook verification screen. |
| `WHATSAPP_ACCESS_TOKEN` | yes (reply) | Permanent System User token with `whatsapp_business_messaging`. |
| `WHATSAPP_PHONE_NUMBER_ID` | yes (reply) | Cloud API phone-number ID. |
| `WHATSAPP_VERIFICATION_NUMBER` | optional | Cloud API number to message when it differs from the menu WhatsApp. |
| `WHATSAPP_GRAPH_VERSION` | optional | Defaults to `v24.0`. |
| `WHATSAPP_REPLY_MONTHLY_CAP` | optional | Defaults to `900` automatic replies/month (cost guard below the 1,000 free tier). |

The manual dashboard approval works even when these are unset; only the
automatic reply is off.

## Pricing (checked 21 Nov 2026)

Official Meta pricing page:
<https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing>

- Meta charges **only for messages from the business to the user**, per delivered
  message, by category and by the recipient country. **Inbound messages from the
  customer are always free.**
- A customer message opens a **24-hour customer service window**. Inside it the
  business may send **free-form non-template messages** (service messages). Our
  success/wrong replies are exactly that.
- **Since 1 October 2026**, service messages are no longer unlimited-free:
  each business phone number gets **1,000 free service messages per month**
  (they do not roll over). From message 1,001, the service rate applies.
- **Lebanon** is in Meta's **Rest of Middle East** pricing region. Current
  provider rate tables list the service/utility rate at about **US$0.0091 per
  delivered message**. Confirm the exact figure in Meta's rate card for your
  account before relying on it.
- If the Messaging account has **no payment method**, Meta delivers service
  messages only inside the free 1,000/month and stops after that.
- No template approval and no Authentication-template fee is involved: the
  member initiates, and the reply is a service message.
- Meta's Cloud API has no platform fee. A BSP would add its own fee; this
  integration calls Meta directly.

Examples (assuming the ~$0.0091 Lebanon estimate):

| Verifications/month | Replies | Meta charge |
|---|---|---|
| 300 | 300 | $0 (inside the free 1,000) |
| 1,000 | 1,000 | $0 |
| 1,500 | 1,500 | ~$4.55 (500 × $0.0091) |
| 3,000 | 3,000 | ~$18.20 |

The code caps automatic replies at **900/month** by default, so the default
setup stays inside the free tier. Approvals are never blocked by the cap — only
the WhatsApp confirmation reply is skipped. Per sender the cap is 10 replies/hour
and 20/day, which stops someone from burning the allowance with wrong codes.
Raise `WHATSAPP_REPLY_MONTHLY_CAP` above 1,000 only if you accept the per-message
charge for the extra replies.

The old "1,000 free service conversations" model ended; the window is about
**permission** to send a free-form reply, while the free allowance is a **monthly
per-number message count**. A free entry point window from a Click-to-WhatsApp ad
or a Facebook Page CTA is a separate 72-hour billing exception; the site's
"Send on WhatsApp" button does not create one.

## Troubleshooting

- **No auto-approval**: check the Meta webhook delivery log; `GET` challenge
  should return the raw challenge, `POST` should be 200. Confirm the app secret
  and that the number in the site is the Cloud API number.
- **Approved but no WhatsApp reply**: check `WHATSAPP_ACCESS_TOKEN` /
  `WHATSAPP_PHONE_NUMBER_ID`, the 24-hour window, and the monthly reply cap. The
  site still shows success because the approval is stored.
- **Manual fallback**: the pending row is visible in the dashboard; match the
  sender number + `Ref` and approve.
- **Wrong number**: the code is bound to the exact normalized number, so a code
  sent from another number does not match.

## Tests

```bash
node scripts/test-phone-verification.mjs   # hash/TTL/route/profile/order contract
node scripts/test-whatsapp-webhook.mjs     # signature, parsing, replies, Graph send
```

The webhook accepted a signed payload locally, approved a pending row with
`decided_by='whatsapp'`, kept a wrong code pending, and skipped a duplicate
message id.
