# Bonfire Next 🔥 — Render-ready social chat

A full-stack Express + Socket.IO + PostgreSQL chat app with realtime channels, DMs, reactions, voice, search, and rich inline file sharing. This is the improved version of the supplied Bonfire Render project; no Supabase is required.

## What's new in v2

- **Upload any file type up to 30 MiB per attachment** — ZIP, APK, PDF, documents, code, images, audio, video, and other formats. This restriction is enforced on both client and server; one attachment per message.
- **Inline music playback** for MP3, M4A, WAV, OGG/OPUS, AAC, FLAC, WebA, AIFF and similar recognized formats. Each music message has a play/pause control, seek bar, elapsed/duration display, speed button (1×, 1.25×, 1.5×, 2×), track name and decorative waveform. **No download is required** for browser-supported codecs. Browser support varies, and an optional save link is offered if a preview cannot be played.
- **Seekable streaming** for audio/video via HTTP `Range` / `206 Partial Content`. Attachments are still stored in PostgreSQL up to 30 MiB; byte ranges avoid transferring the whole file to the client up front. Storage itself is not chunked, so the server still reads the DB blob per request.
- **Rich file cards** with extensions, sizes and download controls for arbitrary formats, plus inline previews for safe images and videos.
- **Drag and drop anywhere**, paste images/files from the clipboard, attachment staging, upload progress and cancel.
- **Conversation search** via the magnifying glass or Ctrl/Cmd+F. Search is server-side across retained messages in the active channel/DM; membership checks apply. Ctrl/Cmd+K still opens the quick switcher.
- **UI refresh**: calmer dark palette, more legible message layouts, better sidebar/composer styling, polished player and file previews, responsive/mobile adjustments, keyboard focus outlines, reduced-motion support.
- **Safer file handling**: unknown and potentially active file formats are delivered as `application/octet-stream` with `Content-Disposition: attachment` and `nosniff`. Uploaded filenames are sanitized. Retrieval requires login **and** access as owner/channel member/DM participant.

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

For automated file-type and byte-range tests (no database needed):

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
