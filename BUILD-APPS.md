# Bonfire Next v4: Windows desktop and Android app builds

The Windows `.exe` and Android `.apk` are **client apps** for your already deployed Bonfire Render website. They do not bundle PostgreSQL, store server records offline, or create another server. All the same account logins, channels, ranks, voice chat, and Shift permissions are controlled by the website. Use HTTPS in production.

## Windows: actual `.exe` included

A prebuilt Windows x64 GUI launcher is provided separately as `Bonfire-Windows.exe`. It uses installed **Microsoft Edge or Google Chrome in app-window mode** (a dedicated window without the browser's normal tabs/address bar). If neither is installed, the system browser opens the Bonfire site normally. This is a lightweight website wrapper, **not a standalone Electron binary**. Windows must have a supported browser and internet access to your deployed server.

1. Put `Bonfire-Windows.exe` anywhere on Windows and double-click it.
2. First launch creates `%APPDATA%\Bonfire\server-url.txt` and opens it in Notepad. Replace `https://YOUR-BONFIRE-SERVICE.onrender.com` with your real deployed site URL. Save and close Notepad.
3. Double-click the EXE again. It now opens Bonfire as an app window. You can create a desktop shortcut normally.

Alternative one-time configuration in PowerShell: `./Bonfire-Windows.exe --url=https://your-real-site.onrender.com`.

You can also rebuild from the **Go source** in `apps/windows/main.go` using Go 1.22+:

```sh
cd apps/windows
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags='-s -w -H=windowsgui' -o Bonfire-Windows.exe main.go
```

## Android: compile an installable APK

**An APK was not generated in this environment** because the Android SDK/Gradle build dependencies were unavailable. The `apps/android/` folder contains the complete Android Studio project with an HTTPS WebView wrapper, native file picker (including arbitrary files), microphone permission handling for voice chat, and Android Downloads integration for Shift's evidence ZIPs and attachments.

1. Open `apps/android/app/src/main/res/values/strings.xml` and replace the placeholder `bonfire_url` with your real HTTPS website URL (no trailing slash is easiest).
2. **Recommended: GitHub Actions.** Put the contents of the `bonfire-render` folder at the **root** of your GitHub repository (as you do for Render). Open your GitHub repo → **Actions** → **Build Bonfire Android APK and Windows EXE** → **Run workflow**. The workflow installs Android SDK 35 and builds a debug APK. Download the `Bonfire-Android-APK` workflow artifact, extract it, and find `app-debug.apk`.
3. Or use Android Studio: open `apps/android`, wait for Gradle sync, and choose **Build → Build APK(s)**. The debug APK is created at `apps/android/app/build/outputs/apk/debug/app-debug.apk`.
4. Copy the APK to Android and install it, allowing installation from your trusted file manager/browser when Android asks.

The workflow also builds a Windows x64 EXE artifact from source. This source project is meant for your own app. To publish on Google Play you would need a proper signed release build, icon/brand assets, store listing, and compliance with store policies.

## Shift evidence archives

After upgrading your deployed site, sign in to your **verified** `shift` account, open the 👑 Control Room, select a server/channel and choose **Back up selected channel** or **Back up entire server**. The browser saves a `.zip` to your computer's Downloads folder; Android saves it via DownloadManager.

Each evidence archive includes `server.json`, `channels.json`, `members.json`, `messages.json`, `messages.csv`, `moderation-audit.json`, `rank-audit.json`, any **still-available** message attachments under `attachments/`, and a `manifest.json` / `SHA256SUMS.txt`. The manifest records timestamps and missing/expired attachments. Exports are read-only and **do not import or restore** a server.

- The export requires the authenticated **real Shift administrator** to issue a single-use link valid for 90 seconds. Downloads stream directly; no server-side ZIP copies are retained.
- Archive limits: **20,000 messages**, **12,000 attachments**, and **256 MiB** of available attachment content per export. If a whole server is too large, export individual channels.
- User passwords, login tokens, and private DMs are deliberately excluded. Files in the ZIP are sensitive: keep them in a private, encrypted location if needed for evidence.
- SHA-256 checksums can detect later file changes, but **are not a cryptographic signature** or independent forensic authentication. Audit events record exports.
- Existing data retention still applies: some media expires after 12–72 hours and old messages may be removed. **Back up before purging or before expiry; already deleted files cannot be recovered.**

## Deployment

The Render backend stays exactly as before: `server.js` + PostgreSQL + `public/`. Keep `SHIFT_ADMIN_USER_ID` and `JWT_SECRET` set on Render. Neither the desktop launcher nor the APK contains your admin secret or grants admin permissions by itself.

Use `npm test` to run the JavaScript checks. The Windows PE was cross-compiled on Linux, and the Android source was prepared without an SDK. **A real Windows/Android runtime test and a live PostgreSQL/Render deployment test are still needed.**

To verify a downloaded evidence archive's built-in checksums locally using Python 3 (no extra packages):

```sh
python tools/verify-evidence.py /path/to/bonfire-evidence-channel-xxxx.zip
```
