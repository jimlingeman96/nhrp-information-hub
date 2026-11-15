NHRP INFORMATION HUB — CLOUDFLARE VERSION

This is a Worker application (static site + D1 shared records + R2 screenshots).
It is not a drag-and-drop static Pages site. Deploy with GitHub-connected Cloudflare Workers Builds.

REQUIRED: Turn on Worker-level Cloudflare Access before allowing anyone to use this site.
The Worker fails closed (403) until Access is on.

1) Create a NEW private GitHub repository: nhrp-information-hub.
   Upload the CONTENTS of this folder at repository root, not the enclosing folder.
   Keep your older NHRP GitHub repository/site unchanged.
2) Cloudflare dashboard > Workers & Pages > Create > Import a repository.
   Connect the new private GitHub repo. Select the Workers application.
   Project root: / ; Build command: none ; Deploy command: npx wrangler deploy.
   Wrangler auto-provisions D1 and R2 bindings as DB and IMAGES during deployment.
   If provisioning is not available on your account, create D1 database
   nhrp-information-hub-db and R2 bucket nhrp-information-hub-images in the
   Cloudflare dashboard, then set the matching DB and IMAGES bindings for the Worker.
3) Workers & Pages > nhrp-information-hub > Access > Protect this Worker.
   Set an allow policy with ONLY your approved staff email addresses.
   Test URL; without an Access session you should receive HTTP 403.
4) Open the Worker URL. The first API request initializes the D1 tables.
   CSV/Excel imports and screenshots now persist in the shared database/storage.
   The top right reads CLOUDFLARE LIVE and the sidebar reads SHARED RECORDS.
5) If you have local preview data: click Backup in the LOCAL version, then
   use Restore in the hosted Cloudflare version to migrate your records, logs,
   check history, and screenshot attachments. Otherwise import CSV/XLSX.

Data model: records, logs and checks in D1; photos in private R2, served only
through authenticated /api/images/:key endpoints.

Security: Cloudflare Access is REQUIRED and enforces authenticated access;
ctx.access is checked for every route including static assets. All authorized
staff can currently add, edit, check, import and delete records. Separate read-only
roles would require an additional permission feature.

BACKUPS: Backup exports all records, logs, check history, and embedded screenshot
bytes, even in Cloudflare mode. CSV export excludes screenshots as before.

NOTE: Cloudflare resource provisioning and GitHub UI labels can change.
No local npm installation is required.

CLOUDFLARE BUILD SETTINGS:
- Select Workers (not static-only Pages).
- Use Build command: (leave blank)
- Use Deploy command: npx wrangler deploy
- Do not upload the ZIP directly as a static-only Pages website: the D1/R2
  backend is defined in src/index.js and wrangler.jsonc.
- Existing Cloudflare sites/domains remain unchanged until you choose a domain.

AUTOMATIC STORAGE:
- The wrangler.jsonc uses automatic D1 and R2 binding provisioning. On the
  first GitHub-driven deploy, Cloudflare should create storage resources for
  bindings DB and IMAGES. If it does not, review the build log and bindings.
- The Worker initializes its tables on the first authorized API request; no
  SQL editor step is needed with this build.

VERIFY:
- Before enabling Access: visiting the Worker URL must return HTTP 403.
- After enabling Access and signing in: open /api/health. It should return
  JSON with ok:true and your authorized email.
- Then open / and confirm CLOUDFLARE LIVE appears.
- Add a test record, paste a screenshot, save it, refresh, and check history.

REMINDER: Access policy grants an identical edit role to all allowed staff.
Do not allow untrusted users until read-only/role controls are implemented.
