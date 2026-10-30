# Bonfire — Render version (no Supabase)

This version uses an Express + Socket.IO backend and PostgreSQL. Accounts, servers, channels, chat messages, friend requests, friendships, direct messages, and image/video attachments are handled by the server. Every new account joins the shared Bonfire server. It includes basic peer-to-peer voice signaling for small groups. No Supabase project or client keys are required.

## Deploy to Render with Blueprint
1. Upload the contents of this folder to a new GitHub repository (the `package.json`, `server.js`, `render.yaml`, and `public/` folder should be at repository root).
2. In Render, choose **New → Blueprint** and connect that repository.
3. Review the `render.yaml` resources and deploy. It creates a web service and PostgreSQL database.
4. When the services are ready, open the Render web service URL.

The app initializes its database tables automatically on startup. The `render.yaml` uses Render's `free` plans where available; Render's current plan/availability and database retention rules can change, so review any cost/expiration notice shown in your dashboard before confirming.

## Local run
Requires Node.js 20+ and PostgreSQL.

```bash
npm install
# Set DATABASE_URL and JWT_SECRET in your shell/environment
npm start
```

## Important scope notes
- No Supabase required.
- Chat, username/password accounts, servers, channels, invite links, and members are backed by PostgreSQL.
- Every new account joins the shared `Bonfire` server (created on first signup).
- Friend requests and accepted friendships. You can DM friends or anyone who shares a server with you (click a member or a message author to open a DM).
- Image/video uploads are stored in PostgreSQL, limited to 20 MB per file. Supported: PNG, JPG, GIF, WebP, MP4, WebM, and MOV.
- Voice is peer-to-peer mesh intended for small groups. Some networks require TURN infrastructure; without it, voice may fail for some users.
- File/image uploads use PostgreSQL byte storage; large volumes of video can make the database grow quickly. For a public launch, use dedicated object storage (such as S3-compatible storage) and add rate limits and moderation.
- Before a large public launch, add rate limiting, email verification/password reset, moderation/reporting, upload storage, and stronger production monitoring.
