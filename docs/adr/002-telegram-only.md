# ADR-002: Telegram is the only notification channel (WhatsApp removed)

WhatsApp Cloud API + wa.me flows removed (step-1, branch maintenance/remove-whatsapp):
owner alerts go through Telegram (+ WebPush bell), customer tracking through
the on-device track link. Reason: Cloud API needs Meta verification, a
dedicated number, and per-message cost; the wa.me draft flow was already dead
in the UI. Contact with customers falls back to `tel:` (phone required).
