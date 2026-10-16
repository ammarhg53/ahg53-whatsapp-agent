# AHG53 WhatsApp Agent

WhatsApp assistant for **AHG53 Agency — Ideas to Digital Reality**: customer service, lead capture, human
handoff and consent-based marketing.

**Stack:** Kapso (WhatsApp) · Next.js on **Vercel** · code on **GitHub** · **Google Sheets** as the database,
reached through a private **Apps Script** web app.

## What it does

**Customers (WhatsApp)**
- Greeting and a main menu: Our Services · Get a Free Quote · See Our Work · Talk to Ammar · Project Support
- Guided quote: name → business → country/city → service → budget → timeline. Each answer is saved as it comes;
  if the customer drops off, they're offered "Continue / Start over" next time (plus one reminder within 24 h).
- Lead scoring (hot / warm / cold) from budget, country, urgency and service type.
- Human handoff: the bot pauses for that chat, Ammar gets a WhatsApp (and optional email) alert with a summary,
  and resumes the bot from the dashboard or by sending `#resume 1234` from his phone.
- Business hours (Mon–Sat 10:00–19:00 IST, editable) with a single after-hours note.
- Short FAQ answers (pricing, timeline, process, white-label, location, contact).
- Optional Claude replies for other questions, limited by a strict business-facts prompt and a token cap, falling back to the menu.
- English by default, Hinglish auto-detected (Roman or Devanagari) and remembered per contact.
- STOP / UNSUBSCRIBE / बंद unsubscribe instantly; START opts back in; PRIVACY shows the notice;
  DELETE MY DATA erases the contact from the Sheet and requests erasure in Kapso.

**Marketing**
- Only to contacts with recorded consent (timestamp + source). Opted-out numbers are excluded everywhere,
  and a hashed suppression list survives data deletion.
- Ready-to-submit templates (English + Hinglish) in `templates/`: welcome, offer, quote follow-up (×2),
  re-engagement, project update, plus an admin alert.
- Campaign manager: audience by tag / country / lead score / status → template → preview → schedule → quota cost → confirm.
- Follow-up sequence after a quote (day 1, 3, 7 by default). A step is skipped when the customer has replied or opted out.
- Optional automatic re-engagement after 14 quiet days.
- Tracking per campaign: delivered, read, clicked (tracked button link), replied, and became a lead.

**Monthly limit:** every message the app sends counts against the limit (2,000 by default), including bot replies,
AI replies, alerts, campaign messages and follow-ups. Campaigns stop before using the
"kept for customer replies" reserve (300 by default). Both numbers can be changed in Settings.

The WhatsApp profile photo and business profile are managed in Kapso, not by this app.

## Setup

### 1. Google Sheet + Apps Script (the database)
1. Create a new Google Sheet, e.g. **AHG53 WhatsApp DB**. Keep it private; it holds customer data.
2. **Extensions → Apps Script**. Replace `Code.gs` with `apps-script/Code.gs` from this repo.
   In Project Settings, tick "Show appsscript.json" and replace it with `apps-script/appsscript.json`.
3. Select the `setup` function → **Run** → allow access. This creates all the tabs.
4. **Project Settings → Script properties → Add**: `API_SECRET` = a long random string
   (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
5. **Deploy → New deployment → Web app**. Execute as: **Me**. Who has access: **Anyone**. Copy the URL ending in `/exec`.
   Requests without `API_SECRET` are refused, so "Anyone" only means Vercel can reach the script.
6. After editing the script later, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.

Tabs: `contacts`, `messages`, `leads`, `handoffs`, `campaigns`, `campaign_recipients`, `sequence_enrollments`,
`templates`, `suppression`, `settings`, `quota_usage`. You can read them freely. Avoid editing the `id` columns
or renaming headers. Messages older than 60 days are trimmed automatically to keep the Sheet fast.

### 2. Environment
```bash
cp .env.example .env.local
npm install
npm run hash-password -- "a-long-password-for-the-dashboard"   # → ADMIN_PASSWORD_HASH
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # run 3× for SESSION_SECRET, PHONE_HASH_SALT, CRON_SECRET
```
Fill `.env.local`: `APPS_SCRIPT_URL` (the /exec URL), `APPS_SCRIPT_SECRET` (same as `API_SECRET`), and the rest.
`KAPSO_PHONE_NUMBER_ID` and `KAPSO_WABA_ID` are already filled in for +1 711-262-6471.

### 3. GitHub
Create an empty **private** repository on github.com, then:
```bash
git remote add origin https://github.com/<you>/ahg53-whatsapp-agent.git
git push -u origin main
```
`.env.local` and contact lists (`*.csv`, `*.xlsx`) are git-ignored and never uploaded.

### 4. Vercel
1. vercel.com → **Add New → Project** → import the GitHub repo (framework: Next.js).
2. **Settings → Environment Variables**: add every variable from `.env.local`. Set `APP_URL` to your Vercel URL.
3. Deploy. Every `git push` deploys again.
4. **Cron** (campaigns, follow-ups, reminders) should run every 5 minutes. `vercel.json` only schedules a daily backup
   run (10:00 IST), because Vercel's free Hobby plan allows nothing more frequent. The 5-minute run comes from Apps Script:
   - In the Apps Script editor, add script properties `CRON_URL` = `https://YOUR-APP.vercel.app/api/cron/tick`
     and `CRON_SECRET` = the same value as on Vercel.
   - Run the `installCron` function once. It calls the endpoint every 5 minutes.
   On Vercel Pro you can set `vercel.json` to `*/5 * * * *` and skip `installCron`.

### 5. Connect the Kapso webhook
```bash
npm run webhook:register
```
This creates the webhook pointing at `<APP_URL>/api/whatsapp/webhook` and saves its signing secret to `.env.local`
as `KAPSO_WEBHOOK_SECRET` without printing it. Copy that value into Vercel and redeploy.

### 6. Templates
```bash
npm run templates:submit -- --dry-run   # review first
npm run templates:submit
```
Meta usually approves them within minutes to a day. Then open Dashboard → Templates → **Sync from WhatsApp**.
Hinglish versions are submitted under language `hi`. If Meta rejects one for a language mismatch, change
`"language"` to `"en"` and the `name` to e.g. `ahg_welcome_hinglish` in that file, then resubmit.

### 7. Import your opted-in number list
Save the list as CSV (Excel → Save As → CSV) in the project folder. Columns are detected automatically:
phone/number/mobile, name, country, tags. Then:
```bash
npm run import:contacts -- numbers.csv --source "existing clients, agreed on WhatsApp" --default-cc 91 --dry-run
npm run import:contacts -- numbers.csv --source "existing clients, agreed on WhatsApp" --default-cc 91
```
`--default-cc` adds a country code to numbers written without one (91 = India, 971 = UAE). `--tag clients`
tags everyone in the file so a campaign can target them. People who sent STOP are never re-subscribed.

New WhatsApp numbers can message only **250 new people per 24 hours** at first. The limit rises as Meta sees
good quality. Send campaigns to a large list in batches, e.g. filtered by tag.

### 8. Test
Message +1 711-262-6471 from any phone. From Ammar's number, messages starting with `#` are admin commands; everything else goes to the bot as normal.
Try: `hi`, the menu, a full quote, `kitna lagega website ka?`, `talk to ammar`, `STOP`, `START`, `DELETE MY DATA`.

## Getting consent (opt-in)
- **Click-to-chat link:** `https://wa.me/17112626471?text=START`. Sending START proves the person owns the number. This is the safest route.
- **During the quote flow:** the bot asks "Would you like occasional updates?" (Yes/No).
- **Website form:** `POST <APP_URL>/api/optin` with JSON `{ "phone": "+971…", "name": "…", "consent": true, "source": "homepage" }`
  from an origin listed in `OPTIN_ALLOWED_ORIGINS`. Use a checkbox that's unticked by default.
- **Import:** the script above, or Dashboard → Conversations → Import, only for people who already agreed.

## Admin commands (from Ammar's WhatsApp)
`#open` (chats waiting for you) · `#resume 1234` (give a chat back to the bot) · `#stats` · `#help`

Free-form alerts reach Ammar only inside his 24-hour window (i.e. if he messaged the business number in the last day).
Otherwise the `ahg_admin_alert` template is used, so get it approved. Set `RESEND_API_KEY` for email alerts too.

Your number uses **coexistence**: replies you type in the WhatsApp Business app don't pause the bot.
Pause it from the dashboard first so it doesn't answer at the same time as you.

## Editing the copy
All customer-facing text, services, budgets, FAQ answers and the AI prompt live in `src/lib/business.ts`.
WhatsApp limits: button labels ≤ 20 characters, list rows ≤ 24, row descriptions ≤ 72. `npm test` checks these.

## Security & privacy
- Kapso signature (HMAC-SHA256) verified on the raw body before anything is parsed. Duplicate deliveries are ignored.
- The Sheet is reachable only through the Apps Script with its secret. Keep the Sheet itself unshared.
  Customer text that looks like a spreadsheet formula is stored as plain text (no formula injection).
- Rate limits: webhook per IP and per sender, admin login 5 attempts / 15 min, opt-in form 10 / hour.
- All input is cleaned and length-capped. IDs and form values are validated with zod.
- Logs never contain tokens or keys, and phone numbers are masked (`91******5352`).
- Dashboard sessions: signed httpOnly cookie, SameSite=strict, 12 h.
- Privacy notice at `/privacy`. "Delete my data" works from WhatsApp or the dashboard.

## Commands
| | |
|---|---|
| `npm run dev` | local dev server |
| `npm run build` | production build |
| `npm test` | logic, label-limit, template and Apps Script database tests |
| `npm run test:e2e` | full simulated conversation against fake Kapso + fake Sheet (run `npm run build` first) |
| `npm run typecheck` | TypeScript |
| `npm run import:contacts` | import an opted-in number list |
