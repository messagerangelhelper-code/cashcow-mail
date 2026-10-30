# CashCow Mail

Private dashboard for CashCow email campaigns. Only the CashCow accounts listed in
MAIL_ADMIN_EMAILS on the server can get in.

- Campaigns: write, preview, scan, send yourself a test, then send now or schedule.
- Campaign scanner: must pass before anything can be sent (spam words, risky or look-alike
  links, broken links, misleading subjects, health wording, missing pieces).
- People: subscribers, who's waiting to confirm, unsubscribes and bounces. Add people who agreed to get email.
- Inbox: replies are scanned like ScamShield. Scams stay out, unsubscribe requests are handled
  automatically, and leads and replies are forwarded with a safety note.

The sending, scanning and database live on the CashCow server (mail.py and cashcow_mail.sql in CashCow-).

## Render (Static Site)
- Build command: `npm install && npm run build`
- Publish directory: `dist`
