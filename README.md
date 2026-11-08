# Bonfire Next v4 🔥 — Shift evidence exports + desktop/mobile wrappers

A full-stack Express + Socket.IO + PostgreSQL chat app with realtime channels, DMs, reactions, voice, search, and rich inline file sharing. This is the improved version of the supplied Bonfire Render project; no Supabase is required.

## New in v4: export channel/server evidence and build apps

Shift's Control Room has two new non-destructive backup controls: **Back up selected channel** and **Back up entire server**. Each sends a ZIP download directly to the local computer, including retained messages (JSON and spreadsheet-safe CSV), server/channel/member metadata, server moderation/rank audit history, any unexpired attachments, a list of missing files, and SHA-256 hashes. Private DMs, passwords, and login tokens are not exported. Only verified Shift can create a single-use download link; exports are audited. **Back up before purging or expiry**; backups preserve available evidence but do not restore deleted data.

Archives are bounded to 20,000 messages / 12,000 attachments / 256 MiB of live attachment content. Larger servers should be exported one channel at a time. Backups are not digital signatures and should be secured privately.

A **Windows x64 `.exe`** app-window launcher is provided as a separate download; it needs Edge or Chrome (or falls back to the default browser), and your live site URL must be configured at first run. A complete **Android Studio WebView wrapper** is included in `apps/android` with an automated GitHub Actions APK build. The Android SDK was unavailable locally, so the APK itself was not built here. Read **[BUILD-APPS.md](BUILD-APPS.md)** for steps and limitations.

## What's new in v2

- **Upload any file type up to 30 MiB per attachment** — ZIP, APK, PDF, documents, code, images, audio, video, and other formats. This restriction is enforced on both client and server; one attachment per message.
- **Inline music playback** for MP3, M4A, WAV, OGG/OPUS, AAC, FLAC, WebA, AIFF and similar recognized formats. Each music message has a play/pause control, seek bar, elapsed/duration display, speed button (1×, 1.25×, 1.5×, 2×), track name and decorative waveform. **No download is required** for browser-supported codecs. Browser support varies, and an optional save link is offered if a preview cannot be played.
- **Seekable streaming** for audio/video via HTTP `Range` / `206 Partial Content`. Attachments are still stored in PostgreSQL up to 30 MiB; byte ranges avoid transferring the whole file to the client up front. Storage itself is not chunked, so the server still reads the DB blob per request.
- **Rich file cards** with extensions, sizes and download controls for arbitrary formats, plus inline previews for safe images and videos.
- **Drag and drop anywhere**, paste images/files from the clipboard, attachment staging, upload progress and cancel.
- **Conversation search** via the magnifying glass or Ctrl/Cmd+F. Search is server-side across retained messages in the active channel/DM; membership checks apply. Ctrl/Cmd+K still opens the quick switcher.
- **UI refresh**: calmer dark palette, more legible message layouts, better sidebar/composer styling, polished player and file previews, responsive/mobile adjustments, keyboard focus outlines, reduced-motion support.
- **Safer file handling**: unknown and potentially active file formats are delivered as `application/octet-stream` with `Content-Disposition: attachment` and `nosniff`. Uploaded filenames are sanitized. Retrieval requires login **and** access as owner/channel member/DM participant.

## Shift's admin panel + manually awarded profile ranks (new in v2.1)

Only the **real, pre-existing `shift` account** gets the crown (👑) control-room button after you configure its permanent account ID. Grades are **never earned or calculated automatically**: Shift personally assigns them from the admin panel, may change them at any time, and can clear them back to `None`.

| Rank | Profile effect |
|---|---|
| F — Ash | Subtle grey badge, desaturated avatar and slate border |
| D — Ember | Soft orange glow and warm badge |
| B — Blaze | Vibrant blue halo and electric-blue username |
| A — Nova | Bright violet aura, shimmer badge and glowing name |
| T — Titan | Animated, prismatic golden border, radiant aura and iridescent name |

Ranks display on everyone's profile panel, the server member list, their messages and DM list. Click another user's name/avatar to see their full profile, then **Send a message** if wanted. Shift's rank studio includes searching, paging, rank counts, and a history of recent changes. Only verified Shift can access the admin API, not just the button.

### One-time secure setup for @shift

1. **Create the username `shift` yourself if you haven't already.** Don't let an untrusted person register it. If a `shift` account already exists, confirm it belongs to you.
2. Sign into that account on Bonfire, click your name at the bottom-left to open your profile, and click **Copy my account ID**.
3. In your Render web service's **Environment** settings, add `SHIFT_ADMIN_USER_ID` with that exact UUID as its value. Save and redeploy. The `render.yaml` blueprint also declares this secret/config input.
4. Sign back in or refresh the site. The 👑 button now appears only for Shift, and the server checks the signed-in account's ID **and** stored username on every admin API request. Other users receive HTTP 403 if they try admin routes.

**Security:** Leaving `SHIFT_ADMIN_USER_ID` unset disables the panel rather than accidentally awarding privileges to the first person who claims a username. The ID itself is not a password, and you should never share the Shift account's password or JWT. User ranks are cosmetic only; they grant no extra moderation or admin permissions.

### Hidden discovery for everyone

A secret **Sparkkeeper** celebration can be found by interacting with the flame. It's a personal, device-local cosmetic discovery, *not* a sixth rank or something that changes other users' profiles. Motion effects respect reduced-motion settings.

## New in v3: profile customization + full Shift Control Room

Every user can open their own profile by clicking their avatar **or** username at the bottom-left. A profile editor now provides:

- **Profile picture** — upload JPG, PNG, WebP or GIF up to 2 MiB, or remove the picture to restore an initial avatar. Photos are stored on the server and visible to other members; the general **30 MiB attachment limit is unchanged**.
- **Display name** — change the name displayed in messages, DMs, members, and profiles.
- **@username** — change the unique sign-in/mention handle (3–24 lowercase letters, digits or underscores). The verified administrator's `shift` handle is locked to protect admin identity. Users must use the updated handle at next sign-in.
- Rank glows and borders remain cosmetic, **never suppress avatar initials**; uploaded photos appear inside the ring, without losing the rank aura. Shift still **manually** controls F/D/B/A/T ranks.

Shift's 👑 **Control Room** now has more than rank assignment:

- **Purge channel:** Select a server and channel, then type the exact channel name to confirm deleting the channel's messages and unreferenced attachments. The channel itself stays open. This is permanent; back up important conversations first.
- **Ban / unban:** Ban a user across Bonfire (immediately disconnect current sessions and block future authenticated requests and logins). Reversal is available; a ban reason is optional. Cannot ban Shift.
- **Kick:** Remove a user from the chosen server. This **does not** ban them; they may rejoin if they get an invite. Cannot kick a server owner or the verified Shift account.
- **Edit profiles:** Change a user's display name, @username, profile picture, or remove their photo. These edits update connected clients in real time and are logged.
- **Moderate messages:** When viewing a **public server channel**, hover over a message and click 🛡️✏️ to edit or 🛡️🗑️ to permanently delete it. Edited text is labeled *edited by admin*. Admins intentionally **cannot read, alter, or purge private DMs through the moderation panel**.
- **Audit history:** The Control Room displays recent admin actions and rank changes. DB tables `moderation_audit` and `rank_audit` record the changes.

For security, the server checks the **actual permanent account ID** in `SHIFT_ADMIN_USER_ID` *and* the exact `shift` username on each admin API request. UI buttons alone do not grant permission. Non-admin clients receive HTTP 403. Self-ban and self-kick are blocked. Keep `JWT_SECRET` secret, and set `SHIFT_ADMIN_USER_ID` once in Render as documented below.

**After upgrading:** Deploy the new ZIP, refresh the browser with Ctrl+Shift+R, and make sure `SHIFT_ADMIN_USER_ID` still contains the ID of your original `shift` account. New database columns and the audit table are created automatically on startup. Existing accounts, messages, ranks, and attachments are preserved; channel purges and bans only happen when Shift explicitly triggers them.

## Deploy to Render

1. Create a GitHub repository with **this folder's contents at its root**, including `package.json`, `server.js`, `file-types.js`, `render.yaml`, and `public/`.
2. Open Render → **New → Blueprint** and select the GitHub repository.
3. Check resources, costs and limits, then deploy. The blueprint creates a Node web service and a PostgreSQL database.
4. The app creates/migrates its own database tables when it starts.

Render's free PostgreSQL size/availability and retention rules can change. **30 MiB uploads stored in PostgreSQL can fill small databases quickly.** For a growing community, move attachment blobs to object storage and add upload rate limits, virus scanning, abuse reporting, and quotas before inviting the public.

## Run locally

Requires Node.js 20+ and PostgreSQL. Set `DATABASE_URL` and a securely generated `JWT_SECRET` in your environment, then:

```bash
npm install
npm start
```

For file handling, ranks, avatar validation, and moderation-rule tests (no database needed):

```bash
npm test
```

The server listens on `PORT` (default `3000`). `GET /health` can be used for a deployment health check. All environment config is in `render.yaml`.

## Upload and message retention

| Upload format | Max size | Default expiry | How it appears |
|---|---:|---:|---|
| Images (PNG, JPG, GIF, WebP) | 30 MiB | 72 h | Image preview |
| Videos (MP4, WebM, MOV, M4V) | 30 MiB | 12 h | Inline video controls |
| Music and audio | 30 MiB | 72 h | Inline music player |
| Everything else | 30 MiB | 72 h | Safe download card |

Attachments are private to their owners and people who can view the linked message. Expired attachments are wiped by a periodic cleanup job; their messages remain with placeholders until those messages expire. Messages and DMs are removed after `MESSAGE_RETENTION_DAYS` (default 90 days). Media expiration settings can be changed in `LIMITS` at the start of `server.js`.

**About file types:** any extension is uploadable, but arbitrary files (HTML, SVG, executable files, etc.) intentionally cannot run or render within Bonfire; they are treated as downloads for security. For audio/video, browsers can only play codecs they actually support, even though the upload succeeds. The player does not bypass browser codec restrictions.

## Existing features retained

- Username/password accounts; every new account joins the shared Bonfire server.
- Servers, channels, invites, server-owner controls, friends, friend requests, DMs.
- Live typing indicators, presence, notifications, mention badges and unread state.
- Replies, message editing/deleting, emoji reactions, markdown, spoilers, clickable mentions.
- Infinite-message history, saved local drafts, keyboard navigation, quick switcher.
- Peer-to-peer voice channels for small groups; TURN may be required on some networks.

## Production checklist

The current version is intended as a deployable community project, not a fully hardened public upload host. For public-scale use, add IP/user-level rate limits, storage quotas, file malware scanning, content moderation, reliable object storage, logging and alerting, and stricter origin/proxy configuration. Existing media URLs currently include a user JWT query token for browser `<audio>`/`<video>` compatibility; replace these with short-lived media access tokens or a protected cookie session before deploying to an untrusted or large audience.
