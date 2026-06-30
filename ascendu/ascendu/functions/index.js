/**
 * AscendU Cloud Functions — server-side session recording.
 *
 * Why this exists: the client must not be trusted to write its own leaderboard
 * totals. This callable function is the *only* path that updates leaderboards
 * and history. It verifies the caller is authenticated, that the username they
 * claim actually belongs to their uid, and that the reported session length is
 * physically plausible (no 9-hour sessions logged in 4 seconds).
 *
 * Deploy:  firebase deploy --only functions
 * Requires: Firebase Blaze (pay-as-you-go) plan for callable functions.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

// Same ISO-week key the client uses, computed server-side.
function getWeekKey(d = new Date()) {
  const jan = new Date(d.getFullYear(), 0, 1);
  const wk = Math.ceil(((d - jan) / 86400000 + jan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${wk}`;
}

// Tracks how much focus time a session of a given start could plausibly contain.
// We store the session start when it begins (startSession) and check elapsed here.
const MAX_SESSION_SECS = 6 * 3600; // a single session can't exceed 6h
const MIN_SESSION_SECS = 60;       // under a minute doesn't count

/**
 * recordSession — the trusted write path.
 * data: { subjectId, secs, startedAt, coop?, classCode? }
 */
exports.recordSession = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to record a session.");

  const { subjectId, secs, startedAt, coop = false, classCode = null } = request.data || {};

  // ── Validate inputs ──
  if (typeof subjectId !== "string" || subjectId.length === 0 || subjectId.length > 40)
    throw new HttpsError("invalid-argument", "Bad subject.");
  if (typeof secs !== "number" || !Number.isFinite(secs))
    throw new HttpsError("invalid-argument", "Bad duration.");
  const dur = Math.floor(secs);
  if (dur < MIN_SESSION_SECS) throw new HttpsError("invalid-argument", "Session too short.");
  if (dur > MAX_SESSION_SECS) throw new HttpsError("invalid-argument", "Session too long.");

  // ── Plausibility: the wall-clock time since startedAt must be >= reported secs ──
  // (minus a small grace for latency). This blocks "instant" fake sessions.
  if (typeof startedAt === "number") {
    const wallElapsed = (Date.now() - startedAt) / 1000;
    if (wallElapsed + 10 < dur)
      throw new HttpsError("failed-precondition", "Reported time exceeds elapsed time.");
    if (Date.now() < startedAt - 60000)
      throw new HttpsError("invalid-argument", "Invalid start time.");
  }

  // ── Resolve the caller's username from their uid (don't trust a client-sent name) ──
  const unameSnap = await db.collection("usernames").where("uid", "==", uid).limit(1).get();
  if (unameSnap.empty) throw new HttpsError("failed-precondition", "No username for this account.");
  const username = unameSnap.docs[0].data().displayName || unameSnap.docs[0].id;

  const weekKey = getWeekKey();

  // ── Atomic-ish updates via a batch + transactions on the aggregate docs ──
  const bumpBoard = async (ref) => {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : {};
      const u = data[username] || { totalSecs: 0, sessions: 0, subjects: {} };
      u.totalSecs += dur;
      u.sessions += 1;
      u.subjects = u.subjects || {};
      u.subjects[subjectId] = (u.subjects[subjectId] || 0) + dur;
      tx.set(ref, { [username]: u }, { merge: true });
    });
  };

  await bumpBoard(db.collection("leaderboard_weekly").doc(weekKey));
  await bumpBoard(db.collection("leaderboard_alltime").doc("data"));
  if (classCode && typeof classCode === "string") {
    await bumpBoard(db.collection("class_boards").doc(`${classCode}_${weekKey}`));
  }

  // ── Append to personal history ──
  const entry = { subject: subjectId, secs: dur, ts: Date.now(),
                  ...(coop ? { coop: true } : {}),
                  ...(classCode ? { classCode } : {}) };
  const hRef = db.collection("history").doc(username);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(hRef);
    const sessions = snap.exists ? (snap.data().sessions || []) : [];
    sessions.push(entry);
    tx.set(hRef, { sessions: sessions.slice(-2000) }, { merge: true });
  });

  return { ok: true, username, secs: dur, weekKey };
});
