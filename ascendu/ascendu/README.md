# AscendU

A focus app where you grow an **avatar of yourself** instead of a tree. Run a
timer, your Scholar grows and evolves through tiers, you earn XP and coins, climb
weekly and all-time leaderboards, join classes with a code, and focus together in
real-time co-op rooms.

Built as a fork of the StudyGrove mechanics with a new growth metaphor and three
headline features (class codes, live campus, co-op rooms), on a Vite + React +
Firebase stack that's ready to wrap for the App Store.

---

## Quick start

```bash
npm install
cp .env.example .env.local      # then fill in your Firebase values
npm run dev                     # http://localhost:5173
```

### Firebase setup (5 minutes)

1. Create a project at <https://console.firebase.google.com>.
2. **Build → Authentication → Get started → Email/Password → Enable.**
3. **Build → Firestore Database → Create database** (start in production mode).
4. **Project settings → Your apps → Web app** → copy the config values into
   `.env.local` (matching the keys in `.env.example`).
5. Deploy security rules:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add          # pick your project
   firebase deploy --only firestore:rules
   ```

That's it — sign up with a username, email, and password and you're in.

---

## What's inside

| Feature | Notes |
|---|---|
| **Avatar growth** | Pure-SVG Scholar that scales as the timer runs. Six evolution tiers (Sprout → Luminary) gated by level. |
| **Timer & stopwatch** | Countdown with preset lengths, or open-ended stopwatch. |
| **XP & levels** | 1 XP/min, gentle curve. Level-up and evolution moments have their own celebration. |
| **Coins & cosmetics** | 1 coin/min. Three equip slots: headwear, aura, companion. |
| **Subjects** | Add/remove with custom emoji + colour. |
| **Leaderboards** | Weekly + all-time, plus per-class boards. |
| **Live presence** | "Focusing now" strip and a class campus where members' avatars light up live. |
| **Classes** | Create or join with a 6-character code. |
| **Co-op rooms** | Host/join a shared-goal focus room; see who's live in real time. |
| **Badges** | Earned automatically, each grants coins. |
| **Weekly targets** | Per-subject hour goals with progress bars. |
| **Streak stakes** | Optional Forest-style penalty: giving up mid-session costs a little XP. Off by default; toggle in the menu. |
| **Dark mode** | Hue-preserving invert across the shell. |

### Per-session class attribution
When you belong to one or more classes, the Focus screen shows a "Counts toward"
picker so a session can be credited to a specific class board (or just you).

---

## Architecture

- **`src/App.jsx`** — the whole app: components, Firebase data layer, and styles.
- **`src/firebase.js`** — initializes Firebase Auth + Firestore from env vars.
- **Auth** — real Firebase Authentication (email/password). The public identity is
  a **username**, mapped to an auth uid via the `usernames/{username}` collection,
  so leaderboards and presence stay keyed by username while passwords are handled
  by Firebase (not stored by us). Password reset uses Firebase's email flow.

### Firestore collections
- `usernames/{username}` → `{ uid, email, displayName }` (uniqueness + identity)
- `prefs/{username}` → synced settings (subjects, cosmetics, coins, xp, classes…)
- `history/{username}` → personal session log
- `leaderboard_weekly/{weekKey}`, `leaderboard_alltime/data`
- `class_boards/{code_weekKey}` → per-class weekly board
- `presence/{username}` → live heartbeat (TTL 2 min)
- `classes/{code}` → `{ name, owner, members[] }`
- `rooms/{code}` → co-op room with participant heartbeats

---

## Deploy to the web

```bash
npm run build
firebase deploy --only hosting     # serves dist/ via Firebase Hosting
```

(Or drop `dist/` on Vercel/Netlify — set the same env vars there.)

### Server-side score validation (recommended before launch)

Leaderboard totals are written by a Cloud Function (`functions/index.js`), not the
client — this is what stops users from forging scores. The client calls it
automatically; if it isn't deployed yet, the app falls back to a direct write so
local dev still works.

```bash
cd functions && npm install && cd ..
firebase deploy --only functions
```

After deploying, lock the client out of leaderboard writes: in
`firestore.rules`, change the three `leaderboard_*` / `class_boards` write rules
from `if signedIn()` to `if false`, then `firebase deploy --only firestore:rules`.
Now only the function can write totals.

> Cloud Functions require the Firebase **Blaze** (pay-as-you-go) plan. The free
> tier covers far more than a small app needs, but a card must be on file.

---

## Path to the App Store

This is a mobile-first PWA. To ship it as a native app without a rewrite, wrap the
built site with **Capacitor**:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init AscendU com.yourname.ascendu --web-dir=dist
npm run build && npx cap sync
npx cap open ios        # opens Xcode; archive & submit
npx cap open android    # opens Android Studio
```

### Before you submit — known hardening items
1. **Tighten Firestore rules** for `classes`/`rooms` membership once your data
   model is final, and switch leaderboard writes to `if false` after deploying
   the Cloud Function (see above).
2. **Account deletion + privacy policy** are App Store requirements for apps with
   accounts. Add an in-app "Delete my account" that removes the user's docs.
3. **Minors.** If you're targeting students, review Apple's Kids Category rules and
   COPPA/GDPR-K obligations around accounts and data.

---

## Scripts
- `npm run dev` — local dev server
- `npm run build` — production build to `dist/`
- `npm run preview` — preview the production build locally
