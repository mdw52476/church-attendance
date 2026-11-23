# Church Attendance: Setup Guide

This app is a website that runs entirely in the browser. The data lives in a Google Sheet that you own. Only people you share the sheet with (and add as test users, see step 2) can sign in and see the data. The code lives on GitHub and the site is hosted free on Vercel, which republishes it automatically on every push. There's no server to maintain.

Setup takes about 30 minutes, once.

---

## 1. Create the Google Sheet

1. Go to [sheets.new](https://sheets.new) and name the sheet something like **Church Attendance Data**.
2. Click **Share** and add everyone who will take attendance or view reports, as **Editor**.
3. Copy the sheet's link from the address bar. You'll need it in step 4.

You don't need to set up any columns. The first time someone signs in, the app creates these tabs:
`People`, `Families`, `FamilyMembers`, `EventTypes`, `Events`, `Attendance`, `AuditLog`.

> Avoid renaming tabs or header cells. You can add your own extra columns, and the app will leave them alone.

## 2. Create a Google sign-in "Client ID" (free)

This is what lets the website ask Google, "may this person use this sheet?"

1. Go to <https://console.cloud.google.com/> and sign in with the Google account that owns the sheet.
2. At the top, click the project picker, choose **New Project**, name it `Church Attendance`, then **Create**, and select the new project.
3. Open **APIs & Services → Library**, search for **Google Sheets API**, and click **Enable**.
4. Open **Google Auth Platform** (it may be listed as **OAuth consent screen**):
   - **Branding**: App name `Church Attendance`, plus your email for support and developer contact. Save.
   - **Audience**: User type **External**. Leave it in **Testing**. Under **Test users**, click **Add users** and add the Gmail address of **every person** who will use the app (up to 100).
   - **Data access**: click **Add or remove scopes**, tick `.../auth/spreadsheets`, and save.
5. Open **Clients**, then **Create client**:
   - Application type: **Web application**
   - **Authorized JavaScript origins**, add both:
     - `http://localhost:5173` (for testing on your computer)
     - `https://YOUR-PROJECT.vercel.app` (your live site, from step 3)
   - Click **Create** and copy the **Client ID** (it ends in `.apps.googleusercontent.com`).

> When people sign in, Google shows a "Google hasn't verified this app" screen. That's expected for a private app in Testing mode. Click **Continue**. Only the test users you listed can get past it.

## 3. Put the site online (GitHub + Vercel, free)

1. On GitHub, create an **empty private repository** (for example `church-attendance`), and push this folder to it.
   Don't add a README or .gitignore when creating it. `node_modules` and `dist` are already excluded.
2. On Vercel: **Add New → Project → Import** that repository. Vercel detects Vite automatically
   (build command `npm run build`, output folder `dist`).
3. Every push to `main` republishes the site in about a minute, at `https://YOUR-PROJECT.vercel.app`.
4. Add that address to the Google Client's **Authorized JavaScript origins** (step 2.5).

## 3b. Sign-in on the live site: church passcode (recommended)

On the live site, volunteers sign in with **their name + a church passcode** and stay signed in on
their phone. The app reaches the Google Sheet through its own Google **service account**, so nobody
needs a Google account and there is no Google "unverified app" screen.

1. In <https://console.cloud.google.com/> (same project), open **IAM & Admin → Service Accounts →
   + Create service account**. Name it `attendance-app`, click **Create and continue**, skip the
   optional steps, and click **Done**.
2. Click the new account, open **Keys → Add key → Create new key → JSON**. A `.json` file downloads.
   Treat it like a password.
3. **Share the data sheet** with the service account's email (it ends in `iam.gserviceaccount.com`)
   as **Editor**. Share any sheet you want to import from with it as **Viewer**.
4. In **Vercel → church-attendance → Settings → Environment Variables**, add two variables, both
   marked **Sensitive** for **Production** and **Preview**:
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: open the downloaded `.json` file in Notepad and paste the
     whole contents.
   - `APP_PASSCODE`: the passcode volunteers will type.
5. Redeploy (Deployments → ⋯ → Redeploy).

To remove someone's access, change `APP_PASSCODE` and redeploy. Everyone is signed out and needs
the new passcode. The service account is free and never expires.

When you run the app on your own computer (`npm run dev`), there's no server, so it falls back to
personal Google sign-in with the Client ID below.

## 4. Connect the app to your sheet

Edit `public/config.json`:

```json
{
  "googleClientId": "1234567890-abc.apps.googleusercontent.com",
  "spreadsheetId": "PASTE-THE-ID-FROM-THE-SHEET-LINK",
  "churchName": "Your Church Name"
}
```

The spreadsheet ID is the long part of the sheet link:
`https://docs.google.com/spreadsheets/d/`**`THIS-PART`**`/edit`

Commit and push, and the site redeploys. If you'd rather not edit the file, the sign-in screen also has fields for both values. Those are saved only on that one device.

## 5. Bring in your existing people

1. In your current sheet, use **File → Download → Comma-separated values (.csv)** on the tab with your people.
2. In the app, open **Settings → Import people from CSV**, choose the file, and match the columns.
3. Families can be grouped automatically by a "Family" column, or by matching last name and address.

## 6. Put it on your phone's home screen

Open the site on the phone, then:
- **iPhone (Safari):** Share → **Add to Home Screen**
- **Android (Chrome):** ⋮ → **Add to Home screen**

---

## How the automatic rules work

| Rule | What happens |
|---|---|
| **First visit** | Someone added during check-in starts as a *First-time guest* and is flagged for follow-up. |
| **2nd visit** (on a different day) | Becomes a *Returning guest*. |
| **6 months after first visit** | Becomes a *Regular attendee*, the next time they're checked in. |
| **Manual override** | Choosing a category by hand locks it. The person's edit screen has a link to turn automatic updates back on. |
| **Age groups** | With a birthdate entered, the group updates on its own: Infant (0–2), Kids (Pre-K–5th), Youth (6th–12th), Adult. School grades use a Sept 1 cutoff. You can also set it by hand. |
| **Youth events** | Show only Youth on the check-in list. There's a "show everyone" switch if needed. |
| **Absentees** | *Reports → Absent* lists regular attendees who missed the last N services in a row. |

Every save and edit records who made it and when, in the `AuditLog` tab and under **History → event → Change history**.

## Running it on your computer (optional)

```powershell
npm install
npm run dev
```

Then open <http://localhost:5173>. "Try it with sample data" works without any Google setup.

## Troubleshooting

- **"You don't have access to this Google Sheet"**: share the sheet with that person's Google account as Editor.
- **"Access blocked" / "not a test user"**: add their Gmail under Google Auth Platform → Audience → Test users.
- **"redirect_uri_mismatch" / "origin not allowed"**: the site's address must be listed exactly under Authorized JavaScript origins (no trailing slash, no `/church-attendance` path).
- **"Sign in again" banner**: Google sign-ins last about an hour. Tap the button and you're back. Unsaved check-ins are kept on the device.
