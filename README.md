# Expense Guard

Offline-first expense and subscription tracker that keeps all data on the device (IndexedDB). No backend required.

**Features**
- Log expenses with date, category, and note
- Track subscriptions with renewal dates
- Monthly budget status and reports
- CSV export
- Local backup and restore (JSON)
- Optional ad-free upgrade (ads only for free users)

**Local Data & Privacy**
- All data is stored locally in the browser (IndexedDB).
- No servers or accounts are required.
- Privacy policy page: `privacy.html`

**Backup & Restore**
- Use **Settings → Export backup** to download a JSON file.
- Use **Settings → Import backup** to restore (this replaces existing data).

**Run Locally**
- Open `index.html` in a local server for the service worker to work.
- Example:
```bash
python -m http.server 5173
```
- Then open `http://localhost:5173`.

**Deploy (Vercel)**
- From this folder:
```bash
npx vercel
```
- Framework: `Other`
- Build command: *(leave empty)*
- Output directory: `.`
- For production:
```bash
npx vercel --prod
```

**Google Play Console: Suggested Answers (for this app)**
These are practical answers based on the current app behavior (local-only storage). Always confirm the latest Play Console requirements and update if you add SDKs or collect data.

- **Ads**: If you show ads (banner/native/interstitial or any ad SDK), declare **Yes**. Google Play will show a “Contains ads” label when ads are declared.
- **App access**: If the app has no login or restricted areas, indicate that no special access is required. Play Console requires access instructions when parts of the app are restricted.
- **Data safety form**: Declare any data collected or shared, including by third-party SDKs. If the app truly collects and shares no data (local-only), you can declare **No data collected/shared**. If you add ads/analytics later, you must update this form.
- **Target audience & content**: You must declare target age groups. Before this section, Play Console requires your Ads declaration and App access info, and also asks you to add a privacy policy.
- **Permissions**: Request only permissions needed for the features you ship. Sensitive permissions must be justified and not requested for undisclosed or unimplemented features.

**Reminder**
If you add any ad SDKs, analytics, or other third-party code that collects user data, you must reflect that in the Data safety form and comply with Play policies.
