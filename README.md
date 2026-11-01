# Bookmark Manager

A fast, private bookmark manager. Sign in with Google, save and organize your favorite sites, and access them from any device.

**Live:** https://bookmark-manager-two-xi.vercel.app/

## Features

- Google sign-in, with each user's bookmarks private to their account
- Add, edit, delete, and pin bookmarks
- Categories (General, Work, Personal, Learning) with filter chips
- Instant search by name, URL, or category
- Duplicate URL detection
- Export all bookmarks to JSON
- Light and dark theme
- Real-time sync with Firebase Firestore

## Security

- **Per-user data:** bookmarks live at `users/<uid>/bookmarks`, and Firestore rules (`firestore.rules`) only let a user read and write their own documents.
- **Validated writes:** the rules check field names, types, sizes, and that URLs start with `http://` or `https://`.
- **XSS-safe rendering:** cards are built with DOM APIs and `textContent`, never `innerHTML`. Stored URLs are re-validated before they become links.
- **Link safety:** only `http(s)` links are accepted, and they open with `rel="noopener noreferrer"`.
- **Headers:** `vercel.json` sets a Content Security Policy and other security headers.

> The Firebase web config in `script.js` is public by design. Access is enforced by Firebase Auth and the Firestore rules, not by hiding the key.

## Tech stack

HTML, CSS, vanilla JavaScript (ES modules), Firebase Auth, Cloud Firestore, Vercel.

## Run locally

```bash
npx serve .
```

Open the printed `localhost` link. Google sign-in works on `localhost` by default.

## Deploy

1. Push to GitHub and import the repo on Vercel (Framework: **Other**, no build command).
2. In Firebase, enable the Google sign-in provider and publish `firestore.rules`.
3. Add your Vercel domain under Authentication → Settings → Authorized domains.
