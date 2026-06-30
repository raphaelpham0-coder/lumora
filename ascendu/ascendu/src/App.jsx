import { useState, useEffect, useRef, useCallback } from "react";
import { db } from "./firebase.js";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, arrayUnion,
  collection, getDocs, query, where, increment
} from "firebase/firestore";

/* ════════════════════════════════════════════════════════════════════════
   LUMORA — a focus app where your light grows as you study.
   Built on AscendU's mechanics (timer, subjects, coins, leaderboards,
   presence, badges, targets, weekly recap, an evolving avatar, class codes
   and co-op focus rooms). Lumora gives it its own identity: an aurora
   indigo→violet palette with a warm amber glow on a cool "dusk" surface,
   rather than the forest-green look it was forked from.
   ════════════════════════════════════════════════════════════════════════ */

// ── BRAND: Lumora ─────────────────────────────────────────────────────────────
// Single source of truth for Lumora's look. Change values here to re-theme the
// whole app. (NOTE: the ascendu_* storage keys below are intentionally left
// unchanged — renaming them would sign every existing user out and lose their
// saved data. The rebrand is visual, not a data migration.)
const BRAND = {
  name:     "Lumora",
  logo:     "✦",
  tagline:  "Focus, and let your light grow.",
  // Core palette — aurora violet primary, warm amber accent
  primary:  "#6C5CEF",   // main brand violet
  primaryDk:"#5746C9",   // pressed / darker violet
  primarySoft:"#EEEBFB", // tinted fills, active backgrounds
  accent:   "#F5A623",   // warm amber glow (coins, highlights)
  ink:      "#1E1B33",   // near-black indigo text
  // Surfaces — cool light "dusk"
  bg:       "#F5F4FC",   // app background
  bgGrad:   "linear-gradient(165deg,#ECE9FB 0%,#F5F4FC 60%)",
  surface:  "#FFFFFF",
  border:   "#E7E4F4",   // soft borders
  borderHi: "#D8D2EE",   // dashed / accent borders
  track:    "#ECEAF8",   // progress-bar tracks
  muted:    "#8B88A6",   // secondary text
  mutedSoft:"#B4B1CC",   // faint text
  // Coins keep a warm amber identity
  coinText: "#B07A12",
  coinBg:   "#FFF6E5",
  coinBorder:"#F1D592",
  // Status
  live:     "#34C759",   // "focusing now" green dot
  danger:   "#E0654F",   // give up / remove
};

// ── localStorage keys ─────────────────────────────────────────────────────────
const LS_USER     = "ascendu_username";
const LS_PASSWORD = "ascendu_password";
const LS_SUBJECT  = "ascendu_subject";
const LS_SUBJECTS = "ascendu_subjects";
const LS_MODE     = "ascendu_mode";
const LS_COINS    = "ascendu_coins";
const LS_XP       = "ascendu_xp";
const LS_AVATAR   = "ascendu_avatar";       // equipped cosmetics + base look
const LS_OWNED    = "ascendu_owned_cosmetics";
const LS_THEME    = "ascendu_theme";
const LS_STAKES   = "ascendu_streak_stakes"; // optional Forest-style penalty for giving up
const LS_TARGETS  = "ascendu_targets";
const LS_BADGES   = "ascendu_badges";
const LS_RECAP    = "ascendu_recap_shown";
const LS_CLASSES  = "ascendu_classes";      // joined class codes
const LS_ACTIVE   = "ascendu_active_session";

// ── XP / level system ──────────────────────────────────────────────────────────
// 1 XP per minute focused. Levels use a gentle curve. Evolution tiers gate on level.
const XP_PER_MIN = 1;
const COINS_PER_MIN = 1;
const levelFromXp = (xp) => Math.floor(Math.sqrt(xp / 25)) + 1;       // lvl 1 at 0, lvl 2 at 25, lvl 3 at 100...
const xpForLevel  = (lvl) => 25 * (lvl - 1) * (lvl - 1);
const xpToNext    = (xp) => {
  const lvl = levelFromXp(xp);
  const cur = xpForLevel(lvl), next = xpForLevel(lvl + 1);
  return { lvl, into: xp - cur, span: next - cur, pct: (xp - cur) / (next - cur) };
};

// Evolution tiers — the avatar's silhouette changes as you climb.
const EVO_TIERS = [
  { id:"sprout",  name:"Sprout Student", minLvl:1,  desc:"Just getting started" },
  { id:"learner", name:"Learner",        minLvl:3,  desc:"Finding your rhythm" },
  { id:"scholar", name:"Scholar",        minLvl:6,  desc:"Focus is a habit now" },
  { id:"adept",   name:"Adept",          minLvl:10, desc:"Deep work comes easy" },
  { id:"sage",    name:"Sage",           minLvl:16, desc:"Mastery in motion" },
  { id:"luminary",name:"Luminary",       minLvl:24, desc:"Others look up to you" },
];
const tierForLevel = (lvl) => [...EVO_TIERS].reverse().find(t => lvl >= t.minLvl) || EVO_TIERS[0];

// ── Subjects ────────────────────────────────────────────────────────────────────
const DEFAULT_SUBJECTS = [
  { id:"math",    label:"Mathematics", emoji:"📐", color:"#5B8DEF" },
  { id:"english", label:"English",     emoji:"📖", color:"#E07B54" },
];
const EMOJI_OPTIONS = ["📐","📖","🔬","🏛️","🌏","📊","🎨","✏️","💻","🎵","🏃","🧪","📝","🌍","🔭","💡","📚","🧠","⚙️","🎯"];
const COLOR_OPTIONS = ["#5B8DEF","#E07B54","#56B68B","#C57BDB","#E8B84B","#6ECBD1","#F07B8F","#A0A0B0","#FF6B6B","#4ECDC4","#45B7D1","#96CEB4"];

// ── Cosmetics (coins) ──────────────────────────────────────────────────────────
// Equippable identity items, grouped by slot. The avatar reads as *you*, not a tree.
const COSMETICS = [
  // hats
  { id:"none_hat",  slot:"hat",  name:"No hat",        cost:0,    draw:"none" },
  { id:"cap",       slot:"hat",  name:"Study Cap",     cost:120,  draw:"cap",     color:"#E07B54" },
  { id:"beanie",    slot:"hat",  name:"Cozy Beanie",   cost:150,  draw:"beanie",  color:"#56B68B" },
  { id:"grad",      slot:"hat",  name:"Grad Cap",      cost:400,  draw:"grad",    color:"#2A2A3A" },
  { id:"crown",     slot:"hat",  name:"Focus Crown",   cost:1200, draw:"crown",   color:"#E8B84B" },
  { id:"halo",      slot:"hat",  name:"Sage Halo",     cost:1800, draw:"halo",    color:"#FFE08A" },
  // auras (the "glow" while focusing)
  { id:"none_aura", slot:"aura", name:"No aura",       cost:0,    draw:"none" },
  { id:"warm",      slot:"aura", name:"Warm Glow",     cost:200,  draw:"glow",    color:"#FFB36B" },
  { id:"cool",      slot:"aura", name:"Cool Glow",     cost:200,  draw:"glow",    color:"#6EC6FF" },
  { id:"violet",    slot:"aura", name:"Violet Glow",   cost:300,  draw:"glow",    color:"#B07BE0" },
  { id:"galaxy",    slot:"aura", name:"Galaxy Aura",   cost:900,  draw:"galaxy",  color:"#9B59B6" },
  // companions (a little buddy that orbits you)
  { id:"none_pet",  slot:"pet",  name:"No companion",  cost:0,    draw:"none" },
  { id:"cat",       slot:"pet",  name:"Study Cat",     cost:500,  draw:"cat",     color:"#E8A87C" },
  { id:"owl",       slot:"pet",  name:"Night Owl",     cost:650,  draw:"owl",     color:"#8B7355" },
  { id:"sprite",    slot:"pet",  name:"Focus Sprite",  cost:1500, draw:"sprite",  color:"#56D6A0" },
];
const SLOTS = [
  { id:"hat",  label:"Headwear",   emoji:"🎓" },
  { id:"aura", label:"Aura",       emoji:"✨" },
  { id:"pet",  label:"Companion",  emoji:"🐾" },
];
const cosmeticById = (id) => COSMETICS.find(c => c.id === id);

const DAY_LABELS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Badges ──────────────────────────────────────────────────────────────────────
const BADGE_REWARDS = { easy:25, mid:50, hard:100 };
const BADGES = [
  { id:"first_session", name:"First Focus",   emoji:"🌱", tier:"easy", desc:"Finish your first session",
    check:c=>c.totalSessions>=1 },
  { id:"first_5h_day",  name:"Deep Work",      emoji:"🔥", tier:"mid",  desc:"Focus 5h in a single day",
    check:c=>c.maxDaySecs>=5*3600 },
  { id:"streak_7",      name:"Week Warrior",   emoji:"📅", tier:"mid",  desc:"Hit a 7-day streak",
    check:c=>c.streak>=7 },
  { id:"streak_30",     name:"Unstoppable",    emoji:"🏆", tier:"hard", desc:"Hit a 30-day streak",
    check:c=>c.streak>=30 },
  { id:"all_subjects",  name:"Well Rounded",   emoji:"🎯", tier:"mid",  desc:"Study every subject in one week",
    check:c=>c.allSubjectsThisWeek },
  { id:"sessions_100",  name:"Centurion",      emoji:"💯", tier:"hard", desc:"Complete 100 sessions",
    check:c=>c.totalSessions>=100 },
  { id:"first_cosmetic",name:"Dressed Up",     emoji:"🎩", tier:"easy", desc:"Equip your first cosmetic",
    check:c=>c.cosmeticCount>=1 },
  { id:"night_owl",     name:"Night Owl",      emoji:"🦉", tier:"easy", desc:"Finish a session after midnight",
    check:c=>c.hasNightOwl },
  { id:"early_bird",    name:"Early Bird",     emoji:"🌅", tier:"easy", desc:"Finish a session before 6am",
    check:c=>c.hasEarlyBird },
  { id:"joined_class",  name:"Classmate",      emoji:"🏫", tier:"easy", desc:"Join your first class",
    check:c=>c.classCount>=1 },
  { id:"coop_session",  name:"Better Together",emoji:"🤝", tier:"mid",  desc:"Finish a co-op focus room",
    check:c=>c.hasCoop },
  { id:"evolve_scholar",name:"Scholar",        emoji:"📜", tier:"mid",  desc:"Evolve to Scholar (level 6)",
    check:c=>c.level>=6 },
];

function buildBadgeCtx({ history, streak, cosmeticCount, subjects, classCount, level }) {
  const hist = Array.isArray(history) ? history : [];
  const totalSessions = hist.length;
  const dayTotals = {};
  let hasNightOwl = false, hasEarlyBird = false, hasCoop = false;
  hist.forEach(s => {
    const d = new Date(s.ts);
    const key = startOfDay(d).getTime();
    dayTotals[key] = (dayTotals[key] || 0) + s.secs;
    const hr = d.getHours();
    if (hr >= 0 && hr < 5) hasNightOwl = true;
    if (hr >= 4 && hr < 6) hasEarlyBird = true;
    if (s.coop) hasCoop = true;
  });
  const maxDaySecs = Object.values(dayTotals).reduce((a,b)=>Math.max(a,b),0);
  const ws = startOfWeek(new Date());
  const weekSubj = new Set(hist.filter(s=>new Date(s.ts)>=ws).map(s=>s.subject));
  const allSubjectsThisWeek = subjects.length>0 && subjects.every(s=>weekSubj.has(s.id));
  return { totalSessions, maxDaySecs, streak, allSubjectsThisWeek, cosmeticCount,
           hasNightOwl, hasEarlyBird, hasCoop, classCount, level };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const getWeekKey = () => {
  const d = new Date(), jan = new Date(d.getFullYear(),0,1);
  const wk = Math.ceil(((d - jan)/86400000 + jan.getDay() + 1)/7);
  return `${d.getFullYear()}-W${wk}`;
};
const pad = n => String(n).padStart(2,"0");
const fmt = s => {
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  return h>0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
};
const fmtMins = s => { const h=Math.floor(s/3600), m=Math.floor((s%3600)/60); return h>0?`${h}h ${m}m`:`${m}m`; };
const fmtHrs = s => { const h=s/3600; return h>=1?`${h.toFixed(1)}h`:`${Math.floor(s/60)}m`; };
const lsGet  = (k,fb) => { try{const v=localStorage.getItem(k);return v?JSON.parse(v):fb;}catch{return fb;} };
const lsSet  = (k,v)  => { try{localStorage.setItem(k,JSON.stringify(v));}catch{} };
const lsRaw  = (k,fb) => { try{return localStorage.getItem(k)||fb;}catch{return fb;} };
const lsSetR = (k,v)  => { try{localStorage.setItem(k,v);}catch{} };
const startOfDay   = d => { const x=new Date(d); x.setHours(0,0,0,0); return x; };
const startOfWeek  = d => { const x=startOfDay(d); x.setDate(x.getDate()-x.getDay()); return x; };
const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
const startOfYear  = d => new Date(d.getFullYear(), 0, 1);
const genClassCode = () => { const a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s=""; for(let i=0;i<6;i++) s+=a[Math.floor(Math.random()*a.length)]; return s; };

// ── App-level CSS (motion + dark theme) ───────────────────────────────────────────
const DARK_CSS = `
[data-theme="dark"] .sg-shell { filter: invert(0.93) hue-rotate(180deg); background:#ECF1ED; transition:filter 0.25s ease; }
[data-theme="dark"] .sg-shell .sg-keepcolor { filter: invert(1) hue-rotate(180deg); }
[data-theme="dark"] .sg-shell img, [data-theme="dark"] .sg-shell svg { filter: invert(1) hue-rotate(180deg); }
`;
const APP_CSS = `
@keyframes sgpulse { 0%{box-shadow:0 0 0 0 rgba(52,199,89,0.5);} 70%{box-shadow:0 0 0 7px rgba(52,199,89,0);} 100%{box-shadow:0 0 0 0 rgba(52,199,89,0);} }
.sg-shell ::-webkit-scrollbar { height:5px; width:5px; }
.sg-shell ::-webkit-scrollbar-thumb { background:rgba(0,0,0,0.15); border-radius:8px; }
.sg-shell button { transition: transform 0.18s cubic-bezier(0.34,1.56,0.64,1), filter 0.18s ease, box-shadow 0.2s ease; -webkit-tap-highlight-color:transparent; touch-action:manipulation; }
.sg-shell button:active { transform: scale(0.94); filter: brightness(0.97); }
.sg-plant-btn:active { transform: scale(0.97) translateY(1px); }
@keyframes sgFadeIn  { from{opacity:0;} to{opacity:1;} }
@keyframes sgPopIn   { from{opacity:0;transform:scale(0.9) translateY(8px);} to{opacity:1;transform:scale(1) translateY(0);} }
@keyframes sgSlideUp { from{opacity:0;transform:translateY(10px);} to{opacity:1;transform:translateY(0);} }
@keyframes sgGrowIn  { from{opacity:0;transform:scale(0.96);} to{opacity:1;transform:scale(1);} }
.sg-overlay-anim { animation: sgFadeIn 0.22s ease both; }
.sg-pop-anim     { animation: sgPopIn 0.32s cubic-bezier(0.34,1.4,0.64,1) both; }
.sg-view-anim    { animation: sgSlideUp 0.28s cubic-bezier(0.22,1,0.36,1) both; }
.sg-card-anim    { animation: sgGrowIn 0.3s cubic-bezier(0.22,1,0.36,1) both; }
.sg-tap-card { transition: transform 0.2s cubic-bezier(0.34,1.4,0.64,1), box-shadow 0.2s ease; }
.sg-tap-card:active { transform: scale(0.97); }
@media (prefers-reduced-motion: reduce) {
  .sg-shell *, .sg-overlay-anim, .sg-pop-anim, .sg-view-anim, .sg-card-anim { animation:none !important; transition:none !important; }
}
`;


// ── Firebase: sessions + leaderboards ─────────────────────────────────────────
const weekKey = getWeekKey();

// Trusted path: call the Cloud Function so the server validates and writes the
// leaderboard. If the function isn't deployed yet (early local dev), fall back
// to a direct client write so the app still works — but ship with the function.
async function fbSaveSession(username, subjId, secs, { coop=false, classCode=null, startedAt=null } = {}) {
  try {
    const record = httpsCallable(functions, "recordSession");
    await record({ subjectId: subjId, secs, startedAt, coop, classCode });
    return;
  } catch(e) {
    // not-found / internal => function likely not deployed; use fallback below
    console.warn("recordSession unavailable, using direct write fallback:", e?.code || e);
  }
  try {
    const bump = async (ref) => {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, { [username]: { totalSecs: secs, sessions: 1, subjects: { [subjId]: secs } } });
      } else {
        const data = snap.data();
        const u = data[username] || { totalSecs:0, sessions:0, subjects:{} };
        u.totalSecs += secs; u.sessions += 1;
        u.subjects = u.subjects || {}; u.subjects[subjId] = (u.subjects[subjId]||0) + secs;
        await setDoc(ref, { ...data, [username]: u });
      }
    };
    await bump(doc(db, "leaderboard_weekly", weekKey));
    await bump(doc(db, "leaderboard_alltime", "data"));
    if (classCode) await bump(doc(db, "class_boards", `${classCode}_${weekKey}`));

    const hRef = doc(db, "history", username);
    const hSnap = await getDoc(hRef);
    const entry = { subject: subjId, secs, ts: Date.now(),
                    ...(coop?{coop:true}:{}), ...(classCode?{classCode}:{}) };
    if (!hSnap.exists()) await setDoc(hRef, { sessions:[entry] });
    else {
      const existing = hSnap.data().sessions || [];
      await setDoc(hRef, { sessions: [...existing, entry].slice(-2000) });
    }
  } catch(e) { console.error("save session:", e); }
}

async function fbLoadLeaderboard() {
  try {
    const [wSnap, aSnap] = await Promise.all([
      getDoc(doc(db, "leaderboard_weekly", weekKey)),
      getDoc(doc(db, "leaderboard_alltime", "data")),
    ]);
    const toArr = snap => !snap.exists() ? [] :
      Object.entries(snap.data()).map(([username,d])=>({username,...d}))
        .sort((a,b)=>b.totalSecs-a.totalSecs).slice(0,20);
    return { weekly: toArr(wSnap), allTime: toArr(aSnap) };
  } catch(e) { console.error("LB:", e); return { weekly:[], allTime:[] }; }
}

async function fbLoadClassBoard(classCode) {
  try {
    const snap = await getDoc(doc(db, "class_boards", `${classCode}_${weekKey}`));
    if (!snap.exists()) return [];
    return Object.entries(snap.data()).map(([username,d])=>({username,...d}))
      .sort((a,b)=>b.totalSecs-a.totalSecs).slice(0,50);
  } catch(e) { console.error("class board:", e); return []; }
}

async function fbLoadHistory(username) {
  try { const snap = await getDoc(doc(db,"history",username)); return snap.exists()?(snap.data().sessions||[]):[]; }
  catch(e) { console.error("history:", e); return []; }
}

// ── Firebase: prefs (subjects, cosmetics, classes — synced) ───────────────────
async function fbLoadPrefs(username) {
  try { const snap=await getDoc(doc(db,"prefs",username)); return snap.exists()?snap.data():null; }
  catch(e) { console.error("prefs load:", e); return null; }
}
async function fbSavePrefs(username, patch) {
  try {
    const uid = auth.currentUser?.uid;
    const data = uid ? { ...patch, ownerUid: uid } : patch;
    const ref=doc(db,"prefs",username), snap=await getDoc(ref);
    if(snap.exists()) await updateDoc(ref,data); else await setDoc(ref,data);
  } catch(e) { console.error("prefs save:", e); }
}

// ── Firebase: presence ("Focusing now") with avatar snapshot ──────────────────
const PRESENCE_TTL = 120 * 1000;
async function fbHeartbeat(username, payload) {
  try { await setDoc(doc(db,"presence",username), { username, ...payload, ts:Date.now() }); } catch(e) {}
}
async function fbClearPresence(username) { try{ await deleteDoc(doc(db,"presence",username)); }catch(e){} }
async function fbLoadPresence(classCode=null) {
  try {
    const snap = await getDocs(collection(db,"presence"));
    const now = Date.now(), out=[];
    snap.forEach(d=>{ const v=d.data(); if(v && now-v.ts<PRESENCE_TTL){
      if(!classCode || (v.classes && v.classes.includes(classCode))) out.push(v);
    }});
    return out.sort((a,b)=>a.username.localeCompare(b.username));
  } catch(e) { console.error("presence:", e); return []; }
}

// ── Firebase: classes ─────────────────────────────────────────────────────────
async function fbCreateClass(name, ownerUsername) {
  try {
    let code, exists = true, tries = 0;
    while (exists && tries < 8) { code = genClassCode(); exists = (await getDoc(doc(db,"classes",code))).exists(); tries++; }
    await setDoc(doc(db,"classes",code), { name, owner: ownerUsername, members:[ownerUsername], createdAt:Date.now() });
    return { ok:true, code, name };
  } catch(e) { console.error("create class:", e); return { ok:false, error:"Couldn't create class. Try again." }; }
}
async function fbJoinClass(code, username) {
  try {
    const ref = doc(db,"classes",code.toUpperCase());
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok:false, error:"No class with that code." };
    await updateDoc(ref, { members: arrayUnion(username) });
    return { ok:true, code:code.toUpperCase(), name: snap.data().name };
  } catch(e) { console.error("join class:", e); return { ok:false, error:"Couldn't join. Check the code." }; }
}
async function fbLoadClass(code) {
  try { const snap=await getDoc(doc(db,"classes",code)); return snap.exists()?{code,...snap.data()}:null; }
  catch(e) { return null; }
}

// ── Firebase: co-op focus rooms ───────────────────────────────────────────────
// A room is a doc with participants writing heartbeats. Anyone can host.
async function fbCreateRoom(host, subjLabel, goalMin) {
  try {
    let code, exists=true, tries=0;
    while(exists && tries<8){ code=genClassCode(); exists=(await getDoc(doc(db,"rooms",code))).exists(); tries++; }
    await setDoc(doc(db,"rooms",code), {
      host, subjLabel, goalMin, createdAt:Date.now(),
      participants: { [host]: { joinedAt:Date.now(), focusing:false } }
    });
    return { ok:true, code };
  } catch(e) { return { ok:false, error:"Couldn't open room." }; }
}
async function fbJoinRoom(code, username) {
  try {
    const ref=doc(db,"rooms",code.toUpperCase()), snap=await getDoc(ref);
    if(!snap.exists()) return { ok:false, error:"No room with that code." };
    await updateDoc(ref, { [`participants.${username}`]: { joinedAt:Date.now(), focusing:false } });
    return { ok:true, code:code.toUpperCase(), room:snap.data() };
  } catch(e) { return { ok:false, error:"Couldn't join room." }; }
}
async function fbRoomHeartbeat(code, username, focusing, elapsedSecs) {
  try { await updateDoc(doc(db,"rooms",code), {
    [`participants.${username}`]: { focusing, elapsedSecs, ts:Date.now() } }); } catch(e) {}
}
async function fbLoadRoom(code) {
  try { const snap=await getDoc(doc(db,"rooms",code)); return snap.exists()?{code,...snap.data()}:null; }
  catch(e) { return null; }
}
async function fbLeaveRoom(code, username) {
  try {
    const ref=doc(db,"rooms",code), snap=await getDoc(ref);
    if(!snap.exists()) return;
    const data=snap.data(); const p={...data.participants}; delete p[username];
    if(Object.keys(p).length===0) await deleteDoc(ref);
    else await updateDoc(ref, { participants:p });
  } catch(e) {}
}

// ── Firebase Auth ─────────────────────────────────────────────────────────────
// Real auth via Firebase Authentication (email + password). The app's public
// identity is still a username; we map username -> { uid, email } in a
// `usernames` collection so leaderboards/presence stay keyed by username and
// usernames are unique. Password reset uses Firebase's built-in email flow.
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut as fbSignOut, sendPasswordResetEmail, onAuthStateChanged,
} from "firebase/auth";
import { auth } from "./firebase.js";
import { functions } from "./firebase.js";
import { httpsCallable } from "firebase/functions";

const normUser = (u) => u.trim().toLowerCase();

// Sign up: reserve username, create auth account, link them.
async function authSignUp(username, email, password) {
  const uname = username.trim();
  const key = normUser(uname);
  if (key.length < 2) return { ok:false, error:"Username needs 2+ characters." };
  if (!/^[a-z0-9_]+$/.test(key)) return { ok:false, error:"Username can use letters, numbers, and underscores only." };
  try {
    // Create the auth account FIRST so the user is signed in for all Firestore
    // operations below (security rules require an authenticated request).
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    // Now signed in: check whether the username is already reserved.
    const uref = doc(db, "usernames", key);
    const existing = await getDoc(uref);
    if (existing.exists() && existing.data().uid !== cred.user.uid) {
      // Username taken by someone else — roll back the just-created auth account.
      try { await cred.user.delete(); } catch(_) {}
      return { ok:false, error:"That username is taken. Pick another." };
    }
    // Reserve the username.
    await setDoc(uref, { uid: cred.user.uid, email: email.trim(), displayName: uname, createdAt: Date.now() });
    return { ok:true, username: uname };
  } catch(e) {
    const code = e?.code || "";
    if (code.includes("email-already-in-use")) return { ok:false, error:"That email already has an account — try signing in." };
    if (code.includes("invalid-email")) return { ok:false, error:"That email doesn't look right." };
    if (code.includes("weak-password")) return { ok:false, error:"Password needs 6+ characters." };
    // Surface the real error code so problems are diagnosable instead of generic.
    return { ok:false, error:`Couldn't create account: ${e?.code || e?.message || "unknown error"}` };
  }
}

// Sign in by email OR username (we look up the email if a username is given).
async function authSignIn(identifier, password) {
  try {
    let email = identifier.trim();
    if (!email.includes("@")) {
      const snap = await getDoc(doc(db, "usernames", normUser(identifier)));
      if (!snap.exists()) return { ok:false, error:"No account with that username." };
      email = snap.data().email;
    }
    const cred = await signInWithEmailAndPassword(auth, email, password);
    // Resolve the username for this uid
    const uname = await usernameForUid(cred.user.uid);
    return { ok:true, username: uname };
  } catch(e) {
    const code = e?.code || "";
    if (code.includes("wrong-password") || code.includes("invalid-credential")) return { ok:false, error:"Wrong email/username or password." };
    if (code.includes("user-not-found")) return { ok:false, error:"No account with that email." };
    if (code.includes("too-many-requests")) return { ok:false, error:"Too many tries — wait a moment." };
    return { ok:false, error:"Couldn't sign in. Try again." };
  }
}

// Find the username doc that belongs to a uid (one lookup; usernames are 1:1 with uid).
async function usernameForUid(uid) {
  try {
    const snap = await getDocs(query(collection(db, "usernames"), where("uid", "==", uid)));
    let found = null;
    snap.forEach(d => { if (!found) found = d.data().displayName || d.id; });
    return found;
  } catch(e) { return null; }
}

async function authResetEmail(email) {
  try { await sendPasswordResetEmail(auth, email.trim()); return { ok:true }; }
  catch(e) {
    if ((e?.code||"").includes("user-not-found")) return { ok:false, error:"No account with that email." };
    return { ok:false, error:"Couldn't send reset email. Check the address." };
  }
}

async function authLogout() { try { await fbSignOut(auth); } catch(e) {} }

// ── Avatar SVG ──────────────────────────────────────────────────────────────────
// The "you" character. `progress` (0..1) grows it during a session; `tier` sets
// the silhouette (sprout→luminary); `equipped` = {hat,aura,pet}; `color` is the
// subject accent. Pure SVG, GPU-friendly, no external assets.
// ════════════════════════════════════════════════════════════════════════════════
// LIVING WORLD  —  Phase 1
// A self-contained SVG world that grows permanently with lifetime study hours.
// Pure SVG + CSS animation (GPU-composited transforms/opacity only) so it stays
// smooth on mobile. Deterministic per-user randomness keeps each world unique
// but stable across visits. Day/night tint reads local time; star brightness
// reads streak. Nothing here ever resets — every hour is permanent.
// ════════════════════════════════════════════════════════════════════════════════

// Milestone ladder: world features unlock at lifetime-hour thresholds.
const WORLD_STAGES = [
  { h:0,    id:"barren",   reveal:["ground"] },
  { h:0.25, id:"sprout",   reveal:["grass"] },
  { h:1,    id:"firsttree",reveal:["tree1"] },
  { h:3,    id:"grove",    reveal:["tree2","tree3"] },
  { h:6,    id:"river",    reveal:["river"] },
  { h:10,   id:"forest",   reveal:["tree4","tree5","bush"] },
  { h:16,   id:"falls",    reveal:["waterfall"] },
  { h:24,   id:"hills",    reveal:["hill"] },
  { h:40,   id:"village",  reveal:["house1","house2"] },
  { h:60,   id:"island",   reveal:["floatingIsland"] },
  { h:90,   id:"ruins",    reveal:["ruins"] },
  { h:130,  id:"celestial",reveal:["constellation"] },
];
// Resolve which features are unlocked + how far into the *next* stage we are.
function worldState(lifetimeHours) {
  const unlocked = new Set();
  let stageIdx = 0;
  WORLD_STAGES.forEach((s,i)=>{ if(lifetimeHours>=s.h){ s.reveal.forEach(r=>unlocked.add(r)); stageIdx=i; } });
  const next = WORLD_STAGES[stageIdx+1];
  const cur  = WORLD_STAGES[stageIdx];
  const toNext = next ? Math.min(1,(lifetimeHours-cur.h)/(next.h-cur.h)) : 1;
  return { unlocked, stageIdx, stageId:cur.id, next, toNext, maxed:!next };
}
// Time-of-day → sky palette + ambient flags. Reads the user's local clock.
function timeOfDay(date=new Date()) {
  const h = date.getHours();
  if (h>=5  && h<8)  return { id:"dawn",      sky:["#FBD3A5","#F6A6B2","#C9B6E8"], sun:"#FFC56B", ground:"#A9C99A", glow:0.30, stars:0 };
  if (h>=8  && h<17) return { id:"day",        sky:["#AFE0FB","#CDEBFA","#EAF6FB"], sun:"#FFE08A", ground:"#9ED08C", glow:0.10, stars:0 };
  if (h>=17 && h<19) return { id:"sunset",     sky:["#FF9E6B","#FF7E8A","#A86CC4"], sun:"#FF8A4B", ground:"#7FA773", glow:0.45, stars:0.2 };
  if (h>=19 && h<22) return { id:"night",      sky:["#2B2A60","#3D2E6B","#5A3E84"], sun:"#E9D6FF", ground:"#3E5648", glow:0.55, stars:0.85 };
  return                     { id:"midnight",  sky:["#141433","#1E1B44","#2A2156"], sun:"#CFE0FF", ground:"#26382E", glow:0.65, stars:1 };
}
// Tiny deterministic PRNG so a given username always gets the same world layout.
function seedFrom(str=""){ let h=2166136261; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619);} return ()=>{ h+=0x6D2B79F5; let t=h; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }; }

const WORLD_CSS = `
@keyframes lwClouds  { from{transform:translateX(-30px);} to{transform:translateX(330px);} }
@keyframes lwClouds2 { from{transform:translateX(-60px);} to{transform:translateX(360px);} }
@keyframes lwTwinkle { 0%,100%{opacity:0.25;} 50%{opacity:1;} }
@keyframes lwFly     { 0%{transform:translate(0,0);} 25%{transform:translate(40px,-12px);} 50%{transform:translate(90px,4px);} 75%{transform:translate(140px,-8px);} 100%{transform:translate(190px,0);} }
@keyframes lwSway    { 0%,100%{transform:rotate(-1.5deg);} 50%{transform:rotate(1.5deg);} }
@keyframes lwFloat   { 0%,100%{transform:translateY(0);} 50%{transform:translateY(-5px);} }
@keyframes lwFall    { 0%{transform:translateY(-6px) translateX(0);opacity:0;} 10%{opacity:0.9;} 100%{transform:translateY(120px) translateX(22px);opacity:0;} }
@keyframes lwFlow    { from{stroke-dashoffset:0;} to{stroke-dashoffset:-14;} }
@keyframes lwFirefly { 0%{transform:translate(0,0);opacity:0;} 20%{opacity:1;} 50%{transform:translate(18px,-14px);} 80%{opacity:1;} 100%{transform:translate(36px,-4px);opacity:0;} }
@keyframes lwRevealUp{ from{opacity:0;transform:translateY(8px) scale(0.96);} to{opacity:1;transform:translateY(0) scale(1);} }
.lw-cloud  { animation: lwClouds 46s linear infinite; }
.lw-cloud2 { animation: lwClouds2 70s linear infinite; }
.lw-star   { animation: lwTwinkle 3.5s ease-in-out infinite; transform-box:fill-box; transform-origin:center; }
.lw-bird   { animation: lwFly 20s linear infinite; }
.lw-tree   { animation: lwSway 6s ease-in-out infinite; transform-box:fill-box; transform-origin:bottom center; }
.lw-float  { animation: lwFloat 7s ease-in-out infinite; }
.lw-leaf   { animation: lwFall 9s linear infinite; }
.lw-water  { stroke-dasharray:6 8; animation: lwFlow 1.1s linear infinite; }
.lw-fire   { animation: lwFirefly 6s ease-in-out infinite; }
.lw-reveal { animation: lwRevealUp 0.9s cubic-bezier(0.22,1,0.36,1) both; }
@media (prefers-reduced-motion: reduce){
  .lw-cloud,.lw-cloud2,.lw-star,.lw-bird,.lw-tree,.lw-float,.lw-leaf,.lw-water,.lw-fire,.lw-reveal{ animation:none !important; }
}
`;

function LivingWorld({ lifetimeHours=0, streak=0, seedStr="lumora", focusing=false }) {
  const W = 360, H = 200;
  const { unlocked } = worldState(lifetimeHours);
  const tod = timeOfDay();
  const rnd = seedFrom(seedStr+"|world");
  const has = id => unlocked.has(id);
  const starCount = Math.round(10 + tod.stars*30 + Math.min(streak,30));
  const stars = Array.from({length: tod.stars>0?starCount:0}, ()=>({ x:rnd()*W, y:rnd()*H*0.5, r:0.6+rnd()*1.4, d:rnd()*3.5 }));
  const fireCount = (tod.id==="night"||tod.id==="midnight"||tod.id==="sunset") ? Math.min(3+Math.floor(streak/7),9) : 0;
  const fireflies = Array.from({length:fireCount}, ()=>({ x:40+rnd()*(W-80), y:120+rnd()*60, d:rnd()*6 }));
  const leafCount = has("tree1") ? (has("forest")?6:3) : 0;
  const leaves = Array.from({length:leafCount}, ()=>({ x:40+rnd()*(W-80), d:rnd()*9, dur:7+rnd()*5 }));
  const tree = (x,by,scale,anim,hue) => (
    <g className={anim?"lw-tree lw-reveal":"lw-reveal"} style={{transform:`translate(${x}px,${by}px) scale(${scale})`}}>
      <rect x={-3} y={-2} width={6} height={18} rx={2} fill="#7A5A3C"/>
      <circle cx={0}  cy={-12} r={15} fill={hue||"#5FAE72"}/>
      <circle cx={-10} cy={-6} r={11} fill={hue||"#5FAE72"} opacity={0.92}/>
      <circle cx={10} cy={-6} r={11} fill={hue||"#6FBE82"} opacity={0.92}/>
    </g>
  );
  return (
    <div style={{position:"absolute",inset:0,borderRadius:20,overflow:"hidden"}} aria-hidden="true">
      <style>{WORLD_CSS}</style>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{display:"block"}}>
        <defs>
          <linearGradient id="lwSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor={tod.sky[0]}/>
            <stop offset="55%" stopColor={tod.sky[1]}/>
            <stop offset="100%" stopColor={tod.sky[2]}/>
          </linearGradient>
          <radialGradient id="lwSun" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={tod.sun} stopOpacity="0.95"/>
            <stop offset="100%" stopColor={tod.sun} stopOpacity="0"/>
          </radialGradient>
          <linearGradient id="lwGround" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tod.ground}/>
            <stop offset="100%" stopColor="#2F4A38"/>
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="url(#lwSky)"/>
        {tod.id==="midnight" && (
          <g opacity="0.35" className="lw-float">
            <path d="M0,40 Q90,10 180,40 T360,40" stroke="#6CF0C8" strokeWidth="14" fill="none" opacity="0.5"/>
            <path d="M0,55 Q90,28 180,55 T360,55" stroke="#8A7CF0" strokeWidth="10" fill="none" opacity="0.4"/>
          </g>
        )}
        {stars.map((s,i)=>(
          <circle key={i} className="lw-star" cx={s.x} cy={s.y} r={s.r} fill="#FFFDF5" style={{animationDelay:`${s.d}s`}}/>
        ))}
        {has("constellation") && tod.stars>0 && (
          <g stroke="#FFF6C8" strokeWidth="0.8" opacity="0.8" fill="#FFF6C8">
            <polyline points="60,30 80,46 104,38 120,54" fill="none"/>
            <circle cx="60" cy="30" r="1.6"/><circle cx="80" cy="46" r="1.6"/>
            <circle cx="104" cy="38" r="1.6"/><circle cx="120" cy="54" r="1.6"/>
          </g>
        )}
        <circle cx={W-70} cy={50} r={46} fill="url(#lwSun)"/>
        <circle cx={W-70} cy={50} r={tod.stars>0.5?13:18} fill={tod.sun} opacity={tod.stars>0.5?0.9:0.85}/>
        <g className="lw-cloud"  opacity="0.85"><ellipse cx="40" cy="44" rx="26" ry="11" fill="#FFFFFF"/><ellipse cx="62" cy="40" rx="18" ry="9" fill="#FFFFFF"/></g>
        <g className="lw-cloud2" opacity="0.6"><ellipse cx="160" cy="30" rx="22" ry="9" fill="#FFFFFF"/><ellipse cx="178" cy="27" rx="14" ry="7" fill="#FFFFFF"/></g>
        {has("floatingIsland") && (
          <g className="lw-float lw-reveal" style={{transform:"translate(70px,78px)"}}>
            <ellipse cx="0" cy="0" rx="26" ry="8" fill="#6B8E5A"/>
            <path d="M-26,0 L-14,18 L14,18 L26,0 Z" fill="#5A4632"/>
            {tree(0,-2,0.7,true,"#7CCF8C")}
          </g>
        )}
        {(tod.id==="dawn"||tod.id==="day") && (
          <g className="lw-bird" opacity="0.7">
            <path d="M0,60 q5,-5 10,0 q5,-5 10,0" stroke="#3A3A55" strokeWidth="2" fill="none"/>
          </g>
        )}
        {has("hill") && (
          <g className="lw-reveal">
            <path d={`M0,150 Q70,110 150,150 T360,150 L360,${H} L0,${H} Z`} fill="#5C7A55" opacity="0.7"/>
          </g>
        )}
        <path d={`M0,150 Q120,140 240,150 T360,150 L360,${H} L0,${H} Z`} fill="url(#lwGround)"/>
        {has("grass") && (
          <path d="M0,152 Q120,144 240,152 T360,152 L360,160 L0,160 Z" fill="#7FBE6A" opacity="0.5" className="lw-reveal"/>
        )}
        {has("river") && (
          <g className="lw-reveal">
            <path d="M250,150 C235,168 255,182 240,200" stroke="#9FD8E6" strokeWidth="10" fill="none" opacity="0.85"/>
            <path d="M250,150 C235,168 255,182 240,200" className="lw-water" stroke="#E8FBFF" strokeWidth="3" fill="none"/>
          </g>
        )}
        {has("waterfall") && has("hill") && (
          <g className="lw-reveal">
            <rect x="300" y="120" width="9" height="34" rx="3" fill="#BFEAF2" opacity="0.9"/>
            <rect x="300" y="120" width="9" height="34" rx="3" className="lw-water" stroke="#FFFFFF" strokeWidth="1.4" fill="none"/>
          </g>
        )}
        {has("tree1") && tree(70,150,1,true)}
        {has("tree2") && tree(110,152,0.8,true,"#6CB97E")}
        {has("tree3") && tree(40,153,0.7,true,"#54A56A")}
        {has("tree4") && tree(150,151,0.9,true,"#62B277")}
        {has("tree5") && tree(20,154,0.6,true,"#7CCF8C")}
        {has("bush")  && <ellipse cx={190} cy={156} rx={14} ry={9} fill="#5FAE72" className="lw-reveal"/>}
        {has("house1") && (
          <g className="lw-reveal" style={{transform:"translate(280px,128px)"}}>
            <rect x="0" y="6" width="22" height="18" fill="#C98A5E"/>
            <path d="M-2,6 L11,-4 L24,6 Z" fill="#8A4B36"/>
            <rect x="8" y="14" width="6" height="10" fill="#5A3A28"/>
            {(tod.stars>0.3) && <rect x="3" y="10" width="5" height="5" fill="#FFD86B"/>}
          </g>
        )}
        {has("house2") && (
          <g className="lw-reveal" style={{transform:"translate(315px,134px)"}}>
            <rect x="0" y="4" width="16" height="14" fill="#B8C4D0"/>
            <path d="M-2,4 L8,-3 L18,4 Z" fill="#6B7785"/>
            {(tod.stars>0.3) && <rect x="3" y="8" width="4" height="4" fill="#FFD86B"/>}
          </g>
        )}
        {has("ruins") && (
          <g className="lw-reveal" opacity="0.9" style={{transform:"translate(135px,132px)"}}>
            <rect x="0" y="0" width="5" height="20" fill="#C9C2B0"/>
            <rect x="16" y="0" width="5" height="20" fill="#C9C2B0"/>
            <rect x="-3" y="-4" width="27" height="5" rx="2" fill="#D8D2C2"/>
          </g>
        )}
        {leaves.map((l,i)=>(
          <path key={i} className="lw-leaf" d="M0,0 q4,-3 8,0 q-4,3 -8,0 Z" fill="#E0A85C"
                style={{transform:`translateX(${l.x}px)`,animationDelay:`${l.d}s`,animationDuration:`${l.dur}s`,transformBox:"fill-box"}}/>
        ))}
        {fireflies.map((f,i)=>(
          <circle key={i} className="lw-fire" cx={f.x} cy={f.y} r="2" fill="#FFE89A" style={{animationDelay:`${f.d}s`}}/>
        ))}
        <rect x="0" y="0" width={W} height={H} fill={tod.sun} opacity={(tod.glow*(focusing?0.55:0.4)).toFixed(2)} style={{mixBlendMode:"soft-light"}}/>
      </svg>
    </div>
  );
}

function AvatarSVG({ progress=0.5, tier="sprout", equipped={}, color="#5B8DEF", paused=false, large=false, idle=false }) {
  const size = large ? 240 : 160;
  const W = large ? 240 : 160, H = large ? 260 : 190;
  const cx = W/2;
  const groundY = H - (large?30:22);
  // Growth: avatar scales from 0.45→1.0 over the session; idle shows full size.
  const g = idle ? 1 : (0.45 + progress*0.55);
  const bodyH = (large?92:64) * g;
  const headR = (large?30:21) * g;
  const headCy = groundY - bodyH - headR*0.7;
  const skin = "#F0C9A0", skinShade = "#E0B088";
  const tierIdx = EVO_TIERS.findIndex(t=>t.id===tier);
  // Robe color deepens with tier
  const robeColors = ["#9DB4C0","#7FA8C9","#6A95C7","#5B8DEF","#7B6FE0","#9B6FE0"];
  const robe = robeColors[Math.min(tierIdx, robeColors.length-1)];
  const opacity = paused ? 0.55 : 1;

  const hat = cosmeticById(equipped.hat);
  const aura = cosmeticById(equipped.aura);
  const pet = cosmeticById(equipped.pet);

  const baseProps = {
    viewBox:`0 0 ${W} ${H}`, width:size, height:large?260:190,
    style:{ overflow:"visible", filter:paused?"grayscale(55%)":"none", transition:"filter 0.4s" }
  };

  // ── Aura (behind body) ──
  let auraEl = null;
  if (aura && aura.draw === "glow" && !paused) {
    auraEl = <circle cx={cx} cy={groundY-bodyH*0.55} r={bodyH*0.9+headR} fill={aura.color} opacity={0.16}/>;
  } else if (aura && aura.draw === "galaxy" && !paused) {
    auraEl = (
      <g opacity={0.9}>
        <circle cx={cx} cy={groundY-bodyH*0.55} r={bodyH*0.95+headR} fill={aura.color} opacity={0.14}/>
        {[...Array(6)].map((_,i)=>{
          const a=(i/6)*Math.PI*2 + progress*4;
          const rr=bodyH*0.8+headR;
          return <circle key={i} cx={cx+Math.cos(a)*rr} cy={groundY-bodyH*0.55+Math.sin(a)*rr*0.7} r={2.5} fill="#fff" opacity={0.8}/>;
        })}
      </g>
    );
  }

  // ── Body silhouette varies by tier ──
  // Sprout: small rounded robe. Higher tiers: taller, with shoulder structure.
  const bodyTopW = (large?34:24) * (0.8 + tierIdx*0.04) * g;
  const bodyBotW = (large?52:36) * (0.85 + tierIdx*0.05) * g;
  const bodyTopY = headCy + headR*0.8;
  const body = (
    <path d={`M${cx-bodyTopW} ${bodyTopY}
              Q${cx-bodyTopW*1.1} ${groundY-bodyH*0.4} ${cx-bodyBotW} ${groundY}
              L${cx+bodyBotW} ${groundY}
              Q${cx+bodyTopW*1.1} ${groundY-bodyH*0.4} ${cx+bodyTopW} ${bodyTopY} Z`}
          fill={robe} opacity={opacity}/>
  );
  // Collar / trim that appears from "scholar" up
  const collar = tierIdx>=2 && (
    <path d={`M${cx-bodyTopW} ${bodyTopY} L${cx} ${bodyTopY+headR*0.5} L${cx+bodyTopW} ${bodyTopY} Z`}
          fill="#fff" opacity={opacity*0.85}/>
  );

  // ── Head ──
  const head = (
    <g opacity={opacity}>
      <circle cx={cx} cy={headCy} r={headR} fill={skin}/>
      <path d={`M${cx-headR} ${headCy} A${headR} ${headR} 0 0 1 ${cx+headR} ${headCy}`} fill={skinShade} opacity={0.25}/>
      {/* hair — fuller with tier */}
      <path d={`M${cx-headR*1.02} ${headCy-headR*0.1}
                Q${cx} ${headCy-headR*1.5} ${cx+headR*1.02} ${headCy-headR*0.1}
                Q${cx+headR*0.6} ${headCy-headR*0.6} ${cx} ${headCy-headR*0.55}
                Q${cx-headR*0.6} ${headCy-headR*0.6} ${cx-headR*1.02} ${headCy-headR*0.1} Z`}
            fill={["#3A2E25","#4A3B2E","#2E2620","#5A4A3A","#6B5B4A","#7A6A5A"][Math.min(tierIdx,5)]}/>
      {/* face — eyes + small smile, calm when focusing */}
      {!paused && <>
        <circle cx={cx-headR*0.35} cy={headCy+headR*0.05} r={headR*0.09} fill="#3A3A3A"/>
        <circle cx={cx+headR*0.35} cy={headCy+headR*0.05} r={headR*0.09} fill="#3A3A3A"/>
        <path d={`M${cx-headR*0.3} ${headCy+headR*0.45} Q${cx} ${headCy+headR*0.65} ${cx+headR*0.3} ${headCy+headR*0.45}`}
              stroke="#B07050" strokeWidth={large?2:1.5} fill="none" strokeLinecap="round"/>
      </>}
      {paused && <>
        {/* closed/resting eyes */}
        <line x1={cx-headR*0.5} y1={headCy} x2={cx-headR*0.2} y2={headCy} stroke="#3A3A3A" strokeWidth={1.5} strokeLinecap="round"/>
        <line x1={cx+headR*0.2} y1={headCy} x2={cx+headR*0.5} y2={headCy} stroke="#3A3A3A" strokeWidth={1.5} strokeLinecap="round"/>
      </>}
    </g>
  );

  // ── Hat ──
  let hatEl = null;
  if (hat && hat.draw !== "none") {
    const hy = headCy - headR*0.85;
    if (hat.draw === "cap") hatEl = (
      <g opacity={opacity}>
        <path d={`M${cx-headR*0.95} ${hy+headR*0.35} Q${cx} ${hy-headR*0.5} ${cx+headR*0.95} ${hy+headR*0.35} Z`} fill={hat.color}/>
        <ellipse cx={cx+headR*0.7} cy={hy+headR*0.4} rx={headR*0.55} ry={headR*0.14} fill={hat.color}/>
      </g>
    );
    else if (hat.draw === "beanie") hatEl = (
      <g opacity={opacity}>
        <path d={`M${cx-headR} ${hy+headR*0.5} Q${cx} ${hy-headR*0.65} ${cx+headR} ${hy+headR*0.5} Z`} fill={hat.color}/>
        <rect x={cx-headR} y={hy+headR*0.4} width={headR*2} height={headR*0.28} rx={headR*0.14} fill={hat.color} opacity={0.8}/>
        <circle cx={cx} cy={hy-headR*0.45} r={headR*0.18} fill="#fff"/>
      </g>
    );
    else if (hat.draw === "grad") hatEl = (
      <g opacity={opacity}>
        <rect x={cx-headR*0.7} y={hy} width={headR*1.4} height={headR*0.5} rx={3} fill={hat.color}/>
        <polygon points={`${cx},${hy-headR*0.35} ${cx-headR*1.25},${hy+headR*0.1} ${cx},${hy+headR*0.55} ${cx+headR*1.25},${hy+headR*0.1}`} fill={hat.color}/>
        <circle cx={cx+headR*1.1} cy={hy+headR*0.1} r={2.5} fill="#E8B84B"/>
        <line x1={cx+headR*1.1} y1={hy+headR*0.1} x2={cx+headR*1.1} y2={hy+headR*0.7} stroke="#E8B84B" strokeWidth={1.5}/>
      </g>
    );
    else if (hat.draw === "crown") hatEl = (
      <g opacity={opacity}>
        <path d={`M${cx-headR*0.85} ${hy+headR*0.5}
                  L${cx-headR*0.85} ${hy} L${cx-headR*0.4} ${hy+headR*0.3} L${cx} ${hy-headR*0.2}
                  L${cx+headR*0.4} ${hy+headR*0.3} L${cx+headR*0.85} ${hy} L${cx+headR*0.85} ${hy+headR*0.5} Z`}
              fill={hat.color} stroke="#C99A2E" strokeWidth={1}/>
        <circle cx={cx} cy={hy+headR*0.2} r={2.5} fill="#E0533A"/>
      </g>
    );
    else if (hat.draw === "halo") hatEl = (
      <ellipse cx={cx} cy={headCy-headR*1.25} rx={headR*0.85} ry={headR*0.28}
               fill="none" stroke={hat.color} strokeWidth={large?4:3} opacity={paused?0.4:0.95}/>
    );
  }

  // ── Companion pet (orbits) ──
  let petEl = null;
  if (pet && pet.draw !== "none") {
    const px = cx + (large?64:46);
    const py = groundY - bodyH*0.35 + Math.sin(progress*8)*4;
    if (pet.draw === "cat") petEl = (
      <g opacity={opacity}>
        <ellipse cx={px} cy={py} rx={11} ry={9} fill={pet.color}/>
        <circle cx={px} cy={py-9} r={7} fill={pet.color}/>
        <polygon points={`${px-6},${py-13} ${px-2},${py-9} ${px-8},${py-8}`} fill={pet.color}/>
        <polygon points={`${px+6},${py-13} ${px+2},${py-9} ${px+8},${py-8}`} fill={pet.color}/>
        <circle cx={px-2.5} cy={py-9} r={1.3} fill="#000"/><circle cx={px+2.5} cy={py-9} r={1.3} fill="#000"/>
        <path d={`M${px+10} ${py+2} q8 -2 4 -10`} stroke={pet.color} strokeWidth={3} fill="none" strokeLinecap="round"/>
      </g>
    );
    else if (pet.draw === "owl") petEl = (
      <g opacity={opacity}>
        <ellipse cx={px} cy={py} rx={10} ry={12} fill={pet.color}/>
        <circle cx={px-3.5} cy={py-3} r={3.5} fill="#fff"/><circle cx={px+3.5} cy={py-3} r={3.5} fill="#fff"/>
        <circle cx={px-3.5} cy={py-3} r={1.5} fill="#000"/><circle cx={px+3.5} cy={py-3} r={1.5} fill="#000"/>
        <polygon points={`${px},${py-1} ${px-2},${py+2} ${px+2},${py+2}`} fill="#E8A23C"/>
        <polygon points={`${px-8},${py-9} ${px-4},${py-11} ${px-4},${py-6}`} fill={pet.color}/>
        <polygon points={`${px+8},${py-9} ${px+4},${py-11} ${px+4},${py-6}`} fill={pet.color}/>
      </g>
    );
    else if (pet.draw === "sprite") petEl = (
      <g opacity={paused?0.4:0.95}>
        <circle cx={px} cy={py} r={7} fill={pet.color} opacity={0.5}/>
        <circle cx={px} cy={py} r={4} fill={pet.color}/>
        {[...Array(4)].map((_,i)=>{ const a=(i/4)*Math.PI*2+progress*6;
          return <circle key={i} cx={px+Math.cos(a)*10} cy={py+Math.sin(a)*10} r={1.5} fill="#fff"/>; })}
      </g>
    );
  }

  const shadow = <ellipse cx={cx} cy={groundY+3} rx={bodyBotW*1.05} ry={6} fill="rgba(0,0,0,0.08)"/>;
  const sparkle = progress>=1 && !paused && idle===false && (
    <>
      <text x={cx-headR*1.6} y={headCy-headR*0.5} fontSize={large?18:13}>✨</text>
      <text x={cx+headR*1.1} y={headCy-headR*0.9} fontSize={large?15:11}>⭐</text>
    </>
  );
  const pauseIcon = paused && (
    <text x={cx} y={headCy-headR*1.8} fontSize={large?26:18} textAnchor="middle" opacity={0.7}>⏸</text>
  );

  return (
    <svg {...baseProps}>
      {auraEl}
      {shadow}
      {body}
      {collar}
      {petEl}
      {head}
      {hatEl}
      {sparkle}
      {pauseIcon}
    </svg>
  );
}

// ── Toast ───────────────────────────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState(null);
  const show = useCallback((msg) => { setToast(msg); setTimeout(()=>setToast(null), 2600); }, []);
  const node = toast ? <div style={S.toast} className="sg-pop-anim">{toast}</div> : null;
  return [node, show];
}

// ── "Focusing now" presence strip ────────────────────────────────────────────────
function FocusingNow({ presence, currentUser, scopeLabel }) {
  if (!presence || presence.length === 0) {
    return (
      <div style={S.presenceEmpty}>
        <span style={{fontSize:13}}>No one's focusing right now{scopeLabel?` in ${scopeLabel}`:""}.</span>
        <span style={{fontSize:12,color:"#aaa"}}>Start a session to light up the campus.</span>
      </div>
    );
  }
  return (
    <div style={S.presenceWrap}>
      <div style={S.presenceTitle}>
        <span style={{...S.liveDot}}/> Focusing now{scopeLabel?` · ${scopeLabel}`:""} ({presence.length})
      </div>
      <div style={S.presenceRow}>
        {presence.map(p=>(
          <div key={p.username} style={{...S.presenceChip, ...(p.username===currentUser?{borderColor:BRAND.primary,background:BRAND.primarySoft}:{})}}>
            <span style={{fontSize:15}}>{p.subjEmoji||"📚"}</span>
            <div style={{display:"flex",flexDirection:"column"}}>
              <span style={{fontSize:12,fontWeight:700,color:"#333"}}>{p.username}{p.username===currentUser?" (you)":""}</span>
              <span style={{fontSize:10,color:p.subjColor||"#888"}}>{p.subjLabel||"studying"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Leaderboard panel ─────────────────────────────────────────────────────────────
function LeaderboardPanel({ data, currentUser, loading, subjects, title }) {
  const [scope, setScope] = useState("weekly"); // weekly | allTime
  const rows = scope==="weekly" ? data.weekly : data.allTime;
  const medal = i => i===0?"🥇":i===1?"🥈":i===2?"🥉":`${i+1}`;
  return (
    <div>
      {title && <div style={S.sectionTitle}>{title}</div>}
      <div style={S.toggleRow}>
        <button style={{...S.toggleBtn,...(scope==="weekly"?S.toggleBtnActive:{})}} onClick={()=>setScope("weekly")}>This week</button>
        <button style={{...S.toggleBtn,...(scope==="allTime"?S.toggleBtnActive:{})}} onClick={()=>setScope("allTime")}>All time</button>
      </div>
      {loading ? <div style={S.empty}>Loading…</div> :
       rows.length===0 ? <div style={S.empty}>No focus time logged yet. Be the first.</div> :
       rows.map((r,i)=>(
        <div key={r.username} style={{...S.boardRow,...(r.username===currentUser?S.boardRowMe:{})}} className="sg-card-anim" >
          <div style={S.boardRank}>{medal(i)}</div>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,fontSize:14,color:"#333"}}>{r.username}{r.username===currentUser?" (you)":""}</div>
            <div style={{fontSize:11,color:"#999"}}>{r.sessions||0} sessions</div>
          </div>
          <div style={{fontWeight:800,fontSize:15,color:BRAND.primary}}>{fmtMins(r.totalSecs||0)}</div>
        </div>
      ))}
    </div>
  );
}

// ── Class campus — classmates' avatars populate a shared space ────────────────────
function ClassCampus({ cls, presence, board, currentUser, onLeave, loading }) {
  // Build avatar tiles: members from board (with focus totals) + live presence overlay.
  const liveSet = new Set(presence.map(p=>p.username));
  const members = (cls?.members || []);
  const byUser = {};
  board.forEach(b => { byUser[b.username] = b; });
  return (
    <div>
      <div style={S.campusHeader}>
        <div>
          <div style={{fontSize:18,fontWeight:800,color:BRAND.primary}}>{cls.name}</div>
          <div style={{fontSize:12,color:"#888"}}>Code <b style={{letterSpacing:1}}>{cls.code}</b> · {members.length} members</div>
        </div>
        <button style={S.smallGhostBtn} onClick={onLeave}>Leave</button>
      </div>

      <div style={S.campusGrid}>
        {members.length===0 && <div style={S.empty}>No members yet. Share the code.</div>}
        {members.map(u=>{
          const live = liveSet.has(u);
          const b = byUser[u];
          const secs = b?.totalSecs || 0;
          const lvl = levelFromXp(Math.floor(secs/60)); // rough display level from class focus
          const tier = tierForLevel(lvl).id;
          return (
            <div key={u} style={{...S.campusTile,...(live?{borderColor:BRAND.primary,boxShadow:`0 0 0 3px ${BRAND.primary}26`}:{})}} className="sg-card-anim">
              {live && <div style={S.campusLive}><span style={S.liveDot}/>focusing</div>}
              <AvatarSVG progress={live?0.8:0.55} tier={tier} idle={!live} color="#5B8DEF"/>
              <div style={{fontSize:13,fontWeight:700,color:"#333",marginTop:-6}}>{u}{u===currentUser?" (you)":""}</div>
              <div style={{fontSize:11,color:"#888"}}>{fmtMins(secs)} this week</div>
            </div>
          );
        })}
      </div>

      <div style={{marginTop:18}}>
        <LeaderboardPanel data={{weekly:board, allTime:board}} currentUser={currentUser} loading={loading} title="Class leaderboard"/>
      </div>
    </div>
  );
}

// ── Analytics panel ───────────────────────────────────────────────────────────────
function AnalyticsPanel({ user, subjects, targets }) {
  const [history, setHistory] = useState(null);
  const [range, setRange] = useState("week"); // week | month | year
  useEffect(()=>{ let on=true; fbLoadHistory(user).then(h=>on&&setHistory(h)); return ()=>{on=false;}; }, [user]);
  if (history===null) return <div style={S.empty}>Loading…</div>;
  if (history.length===0) return <div style={S.empty}>No sessions yet. Your stats will grow here.</div>;

  const now = new Date();
  const start = range==="week"?startOfWeek(now):range==="month"?startOfMonth(now):startOfYear(now);
  const inRange = history.filter(s=>new Date(s.ts)>=start);
  const totalSecs = inRange.reduce((a,s)=>a+s.secs,0);

  // streak
  const days = new Set(history.map(s=>startOfDay(new Date(s.ts)).getTime()));
  let streak=0; let cur=startOfDay(now).getTime();
  while(days.has(cur)){ streak++; cur-=86400000; }
  if(streak===0){ const y=startOfDay(now).getTime()-86400000; let c=y; while(days.has(c)){streak++; c-=86400000;} }

  // per-subject totals in range
  const subjTotals = {};
  inRange.forEach(s=>{ subjTotals[s.subject]=(subjTotals[s.subject]||0)+s.secs; });
  const subjArr = Object.entries(subjTotals).map(([id,secs])=>{
    const so = subjects.find(x=>x.id===id) || { label:id, color:"#aaa", emoji:"📚" };
    return { ...so, secs };
  }).sort((a,b)=>b.secs-a.secs);
  const maxSubj = Math.max(1, ...subjArr.map(s=>s.secs));

  // last-7-days bars
  const bars = [...Array(7)].map((_,i)=>{
    const d = startOfDay(new Date(now.getTime()-(6-i)*86400000));
    const key = d.getTime();
    const secs = history.filter(s=>startOfDay(new Date(s.ts)).getTime()===key).reduce((a,s)=>a+s.secs,0);
    return { label: DAY_LABELS[d.getDay()], secs };
  });
  const maxBar = Math.max(1, ...bars.map(b=>b.secs));

  return (
    <div>
      <div style={S.statCardRow}>
        <div style={S.statCard}><div style={S.statNum}>{fmtHrs(totalSecs)}</div><div style={S.statLbl}>focused</div></div>
        <div style={S.statCard}><div style={S.statNum}>{inRange.length}</div><div style={S.statLbl}>sessions</div></div>
        <div style={S.statCard}><div style={S.statNum}>{streak}🔥</div><div style={S.statLbl}>day streak</div></div>
      </div>

      <div style={S.toggleRow}>
        {["week","month","year"].map(r=>(
          <button key={r} style={{...S.toggleBtn,...(range===r?S.toggleBtnActive:{})}} onClick={()=>setRange(r)}>
            {r==="week"?"Week":r==="month"?"Month":"Year"}
          </button>
        ))}
      </div>

      <div style={S.panel}>
        <div style={S.panelTitle}>Last 7 days</div>
        <div style={S.barRow}>
          {bars.map((b,i)=>(
            <div key={i} style={S.barCol}>
              <div style={S.barTrack}>
                <div style={{...S.barFill, height:`${(b.secs/maxBar)*100}%`, background: b.secs>0?BRAND.primary:BRAND.track}}/>
              </div>
              <div style={S.barLbl}>{b.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={S.panel}>
        <div style={S.panelTitle}>By subject</div>
        {subjArr.map(s=>(
          <div key={s.id} style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
              <span style={{fontWeight:600,color:"#555"}}>{s.emoji} {s.label}</span>
              <span style={{color:"#888"}}>{fmtMins(s.secs)}</span>
            </div>
            <div style={S.targetTrack}><div style={{...S.targetFill,width:`${(s.secs/maxSubj)*100}%`,background:s.color}}/></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Generic modal shell ───────────────────────────────────────────────────────────
function Modal({ children, onClose, title }) {
  return (
    <div style={S.overlay} className="sg-overlay-anim" onClick={onClose}>
      <div style={S.modal} className="sg-pop-anim" onClick={e=>e.stopPropagation()}>
        {title && <div style={S.modalTitle}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

// ── Login / signup ────────────────────────────────────────────────────────────────
function Login({ onAuth }) {
  const [mode, setMode] = useState("signin"); // signin | signup | reset
  const [username, setUsername] = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const signin = async () => {
    setErr("");
    if (!username.trim()) return setErr("Enter your username or email.");
    if (!password) return setErr("Enter your password.");
    setBusy(true);
    const res = await authSignIn(username, password);
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    onAuth(res.username);
  };

  const signup = async () => {
    setErr("");
    if (username.trim().length < 2) return setErr("Pick a username (2+ characters).");
    if (!email.includes("@")) return setErr("Enter a valid email.");
    if (password.length < 6) return setErr("Password needs 6+ characters.");
    setBusy(true);
    const res = await authSignUp(username, email, password);
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    onAuth(res.username);
  };

  const reset = async () => {
    setErr("");
    if (!email.includes("@")) return setErr("Enter the email on your account.");
    setBusy(true);
    const res = await authResetEmail(email);
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    setResetSent(true);
  };

  return (
    <div style={S.loginWrap}>
      <div style={S.loginCard}>
        <div style={{fontSize:42,marginBottom:4,color:BRAND.primary}}>{BRAND.logo}</div>
        <div style={S.loginTitle}>{BRAND.name}</div>
        <div style={S.loginSub}>{BRAND.tagline}</div>

        {mode==="signin" && <>
          <input style={S.input} placeholder="Username or email" value={username}
                 onChange={e=>setUsername(e.target.value)} autoCapitalize="none"/>
          <input style={S.input} type="password" placeholder="Password" value={password}
                 onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&signin()}/>
          {err && <div style={S.errText}>{err}</div>}
          <button style={S.primaryBtn} onClick={signin} disabled={busy}>{busy?"…":"Sign in"}</button>
          <button style={S.linkBtn} onClick={()=>{setMode("reset");setErr("");setResetSent(false);}}>Forgot password?</button>
          <button style={S.linkBtn} onClick={()=>{setMode("signup");setErr("");}}>New here? Create an account</button>
        </>}

        {mode==="signup" && <>
          <input style={S.input} placeholder="Username (your public name)" value={username}
                 onChange={e=>setUsername(e.target.value)} autoCapitalize="none"/>
          <input style={S.input} type="email" placeholder="Email" value={email}
                 onChange={e=>setEmail(e.target.value)} autoCapitalize="none"/>
          <input style={S.input} type="password" placeholder="Password (6+ characters)" value={password}
                 onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&signup()}/>
          {err && <div style={S.errText}>{err}</div>}
          <button style={S.primaryBtn} onClick={signup} disabled={busy}>{busy?"…":"Create account"}</button>
          <button style={S.linkBtn} onClick={()=>{setMode("signin");setErr("");}}>Already have an account? Sign in</button>
          <div style={S.loginHint}>Your email is used only for sign-in and password recovery. Your username is what classmates see.</div>
        </>}

        {mode==="reset" && <>
          {resetSent ? <>
            <div style={S.recHint}>Check your inbox — we sent a reset link to <b>{email}</b>.</div>
            <button style={S.primaryBtn} onClick={()=>{setMode("signin");setErr("");}}>Back to sign in</button>
          </> : <>
            <div style={S.recHint}>Enter your account email and we'll send a reset link.</div>
            <input style={S.input} type="email" placeholder="Email" value={email}
                   onChange={e=>setEmail(e.target.value)} autoCapitalize="none"/>
            {err && <div style={S.errText}>{err}</div>}
            <button style={S.primaryBtn} onClick={reset} disabled={busy}>{busy?"…":"Send reset link"}</button>
            <button style={S.linkBtn} onClick={()=>{setMode("signin");setErr("");}}>Back to sign in</button>
          </>}
        </>}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// Main App
// ════════════════════════════════════════════════════════════════════════════════
export default function App() {
  // ── Auth ──
  const [user, setUser] = useState(() => lsRaw(LS_USER, ""));
  // ── Core prefs ──
  const [subjects, setSubjects] = useState(() => lsGet(LS_SUBJECTS, DEFAULT_SUBJECTS));
  const [subject, setSubject]   = useState(() => lsRaw(LS_SUBJECT, "math"));
  const [mode, setMode]         = useState(() => lsRaw(LS_MODE, "timer"));
  const [coins, setCoins]       = useState(() => Number(lsRaw(LS_COINS, "0")));
  const [xp, setXp]             = useState(() => Number(lsRaw(LS_XP, "0")));
  const [avatar, setAvatar]     = useState(() => lsGet(LS_AVATAR, { hat:"none_hat", aura:"none_aura", pet:"none_pet" }));
  const [owned, setOwned]       = useState(() => lsGet(LS_OWNED, ["none_hat","none_aura","none_pet"]));
  const [targets, setTargets]   = useState(() => lsGet(LS_TARGETS, {}));
  const [badges, setBadges]     = useState(() => lsGet(LS_BADGES, []));
  const [classes, setClasses]   = useState(() => lsGet(LS_CLASSES, [])); // [{code,name}]
  const [theme, setTheme]       = useState(() => lsRaw(LS_THEME, "light"));
  const [streakStakes, setStreakStakes] = useState(() => lsRaw(LS_STAKES, "off") === "on");
  const [studyClass, setStudyClass] = useState(null); // class code this session counts toward (null = none)

  // ── UI state ──
  const [tab, setTab] = useState("focus"); // focus | classes | board | stats
  const [editMode, setEditMode] = useState(false); // subject-edit mode (shows Remove)
  const [duration, setDuration] = useState(25*60);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [lb, setLb] = useState({ weekly:[], allTime:[] });
  const [lbLoading, setLbLoading] = useState(false);
  const [presence, setPresence] = useState([]);
  const [activeClass, setActiveClass] = useState(null); // {code,name,members}
  const [classBoard, setClassBoard] = useState([]);
  const [classPresence, setClassPresence] = useState([]);
  const [room, setRoom] = useState(null); // active co-op room {code, ...}
  const [modal, setModal] = useState(null); // 'subject' | 'shop' | 'badges' | 'class' | 'room' | 'menu' | 'levelup'
  const [levelUpInfo, setLevelUpInfo] = useState(null);
  const [worldStreak, setWorldStreak] = useState(0); // lifetime day-streak, drives world ambience
  const [toastNode, toast] = useToast();

  const tickRef = useRef(null);
  const heartbeatRef = useRef(null);
  const startedAtRef = useRef(null);

  // ── Persist prefs locally + to Firebase ──
  useEffect(()=>{ lsSet(LS_SUBJECTS, subjects); }, [subjects]);
  useEffect(()=>{ lsSetR(LS_SUBJECT, subject); }, [subject]);
  useEffect(()=>{ lsSetR(LS_MODE, mode); }, [mode]);
  useEffect(()=>{ lsSetR(LS_COINS, String(coins)); }, [coins]);
  useEffect(()=>{ lsSetR(LS_XP, String(xp)); }, [xp]);
  useEffect(()=>{ lsSet(LS_AVATAR, avatar); }, [avatar]);
  useEffect(()=>{ lsSet(LS_OWNED, owned); }, [owned]);
  useEffect(()=>{ lsSet(LS_TARGETS, targets); }, [targets]);
  useEffect(()=>{ lsSet(LS_BADGES, badges); }, [badges]);
  useEffect(()=>{ lsSet(LS_CLASSES, classes); }, [classes]);
  useEffect(()=>{ lsSetR(LS_THEME, theme); document.documentElement.setAttribute("data-theme", theme); }, [theme]);
  useEffect(()=>{ lsSetR(LS_STAKES, streakStakes?"on":"off"); }, [streakStakes]);

  // ── Confirm the real auth session (survives reloads, handles sign-out elsewhere) ──
  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, async (fbUser)=>{
      if(fbUser){
        const uname = await usernameForUid(fbUser.uid);
        if(uname){ setUser(uname); lsSetR(LS_USER, uname); }
      } else {
        // Firebase says signed out — clear local session
        setUser(""); localStorage.removeItem(LS_USER);
      }
    });
    return ()=>unsub();
  }, []);

  // ── Load remote prefs on login ──
  useEffect(()=>{
    if(!user) return;
    lsSetR(LS_USER, user);
    (async()=>{
      const p = await fbLoadPrefs(user);
      if(p){
        if(p.subjects) setSubjects(p.subjects);
        if(typeof p.coins==="number") setCoins(p.coins);
        if(typeof p.xp==="number") setXp(p.xp);
        if(p.avatar) setAvatar(p.avatar);
        if(p.owned) setOwned(p.owned);
        if(p.targets) setTargets(p.targets);
        if(p.badges) setBadges(p.badges);
        if(p.classes) setClasses(p.classes);
        if(typeof p.streakStakes==="boolean") setStreakStakes(p.streakStakes);
      }
    })();
  }, [user]);

  // ── Lifetime day-streak for the Living World ambience ──
  // Loaded from history; recomputed whenever xp changes (i.e. after a session).
  useEffect(()=>{
    if(!user) return;
    let on=true;
    fbLoadHistory(user).then(h=>{
      if(!on || !Array.isArray(h)) return;
      const days = new Set(h.map(s=>startOfDay(new Date(s.ts)).getTime()));
      let st=0, cur=startOfDay(new Date()).getTime();
      while(days.has(cur)){ st++; cur-=86400000; }
      if(st===0){ let c=startOfDay(new Date()).getTime()-86400000; while(days.has(c)){st++; c-=86400000;} }
      setWorldStreak(st);
    });
    return ()=>{on=false;};
  }, [user, xp]);

  // ── Derived ──
  const subjectObj = subjects.find(s=>s.id===subject) || subjects[0] || DEFAULT_SUBJECTS[0];
  const xpInfo = xpToNext(xp);
  const level = xpInfo.lvl;
  const tier = tierForLevel(level);
  const sessionProgress = mode==="timer" ? Math.min(1, elapsed/duration) : Math.min(1, elapsed/(45*60));

  // ── Leaderboard + presence polling ──
  const refreshBoard = useCallback(async ()=>{
    setLbLoading(true);
    const [d, p] = await Promise.all([fbLoadLeaderboard(), fbLoadPresence()]);
    setLb(d); setPresence(p); setLbLoading(false);
  }, []);
  useEffect(()=>{
    if(!user) return;
    refreshBoard();
    const iv = setInterval(()=>{ fbLoadPresence().then(setPresence); }, 20000);
    return ()=>clearInterval(iv);
  }, [user, refreshBoard]);

  // ── Class data polling ──
  useEffect(()=>{
    if(!activeClass) return;
    let on=true;
    const load = async ()=>{
      const [c, b, pr] = await Promise.all([
        fbLoadClass(activeClass.code), fbLoadClassBoard(activeClass.code), fbLoadPresence(activeClass.code)
      ]);
      if(!on) return;
      if(c) setActiveClass(c);
      setClassBoard(b); setClassPresence(pr);
    };
    load();
    const iv = setInterval(load, 15000);
    return ()=>{ on=false; clearInterval(iv); };
  }, [activeClass?.code]);

  // ── Room polling ──
  useEffect(()=>{
    if(!room) return;
    let on=true;
    const iv = setInterval(async ()=>{
      const r = await fbLoadRoom(room.code);
      if(on && r) setRoom(r);
    }, 5000);
    return ()=>{ on=false; clearInterval(iv); };
  }, [room?.code]);

  // ── Timer tick ──
  useEffect(()=>{
    if(running && !paused){
      tickRef.current = setInterval(()=>{
        setElapsed(e=>{
          const ne = e+1;
          if(mode==="timer" && ne>=duration){ finishSession(duration); return duration; }
          return ne;
        });
      }, 1000);
    }
    return ()=>clearInterval(tickRef.current);
  }, [running, paused, mode, duration]);

  // ── Heartbeat while focusing ──
  useEffect(()=>{
    if(running && !paused && user){
      const beat = ()=>{
        fbHeartbeat(user, {
          subjLabel: subjectObj.label, subjEmoji: subjectObj.emoji, subjColor: subjectObj.color,
          classes: classes.map(c=>c.code),
        });
        if(room) fbRoomHeartbeat(room.code, user, true, elapsed);
      };
      beat();
      heartbeatRef.current = setInterval(beat, 30000);
    } else if(user) {
      fbClearPresence(user);
      if(room && !running) fbRoomHeartbeat(room.code, user, false, 0);
    }
    return ()=>clearInterval(heartbeatRef.current);
  }, [running, paused, user, subject, room?.code]);

  // ── Session lifecycle ──
  const startSession = ()=>{ setElapsed(0); startedAtRef.current = Date.now(); setRunning(true); setPaused(false); };
  const togglePause = ()=> setPaused(p=>!p);
  const cancelSession = ()=>{
    const wasFocusing = elapsed >= 60; // only penalize if a real session was underway
    setRunning(false); setPaused(false); setElapsed(0);
    if(user) fbClearPresence(user);
    if(room) fbRoomHeartbeat(room.code, user, false, 0);

    if(streakStakes && wasFocusing){
      // Forest-style stakes: giving up costs a little XP (never below the current
      // level floor, so you can't be demoted). Coins are never taken.
      const penalty = Math.min(15, Math.floor(elapsed/60)); // up to 15 XP
      const floor = xpForLevel(levelFromXp(xp));            // don't drop below this level
      const newXp = Math.max(floor, xp - penalty);
      setXp(newXp);
      if(user) fbSavePrefs(user, { xp:newXp });
      toast(penalty>0 ? `Gave up — −${xp-newXp} XP. Your avatar shrinks back a little.` : "Gave up — no progress counted.");
    } else {
      toast("Session ended — no progress lost, just not counted.");
    }
  };

  const finishSession = async (secs)=>{
    clearInterval(tickRef.current);
    setRunning(false); setPaused(false);
    const mins = Math.floor(secs/60);
    if(mins < 1){ setElapsed(0); toast("Too short to count — focus at least a minute."); return; }

    const gainedCoins = mins*COINS_PER_MIN;
    const gainedXp = mins*XP_PER_MIN;
    const newCoins = coins + gainedCoins;
    const newXp = xp + gainedXp;
    const prevLevel = levelFromXp(xp);
    const newLevel = levelFromXp(newXp);
    setCoins(newCoins); setXp(newXp); setElapsed(0);

    if(user){
      await fbSaveSession(user, subject, secs, { coop: !!room, classCode: studyClass || null, startedAt: startedAtRef.current });
      fbClearPresence(user);
      fbSavePrefs(user, { coins:newCoins, xp:newXp });
      refreshBoard();
    }

    // Level up?
    if(newLevel > prevLevel){
      const prevTier = tierForLevel(prevLevel), newTier = tierForLevel(newLevel);
      setLevelUpInfo({ level:newLevel, evolved: newTier.id!==prevTier.id, tierName:newTier.name });
      setModal("levelup");
    } else {
      toast(`+${gainedXp} XP · +${gainedCoins} coins 🪙`);
    }

    // Badges
    await checkBadges(newCoins, newLevel);
  };

  const checkBadges = async (curCoins, curLevel)=>{
    const history = await fbLoadHistory(user);
    const days = new Set(history.map(s=>startOfDay(new Date(s.ts)).getTime()));
    let streak=0, cur=startOfDay(new Date()).getTime();
    while(days.has(cur)){ streak++; cur-=86400000; }
    const ctx = buildBadgeCtx({
      history, streak, cosmeticCount: owned.filter(id=>!id.startsWith("none")).length,
      subjects, classCount: classes.length, level: curLevel,
    });
    const newly = BADGES.filter(b=>!badges.includes(b.id) && b.check(ctx));
    if(newly.length){
      const ids = newly.map(b=>b.id);
      const reward = newly.reduce((a,b)=>a+BADGE_REWARDS[b.tier],0);
      const nb=[...badges,...ids], nc=curCoins+reward;
      setBadges(nb); setCoins(nc);
      if(user) fbSavePrefs(user, { badges:nb, coins:nc });
      setTimeout(()=>toast(`🏅 ${newly.map(b=>b.name).join(", ")} · +${reward} coins`), 600);
    }
  };

  // ── Shop actions ──
  const buyCosmetic = (c)=>{
    if(owned.includes(c.id)) { equipCosmetic(c); return; }
    if(coins < c.cost){ toast("Not enough coins yet — keep focusing."); return; }
    const nc = coins-c.cost, no=[...owned,c.id];
    setCoins(nc); setOwned(no);
    const na = { ...avatar, [c.slot]: c.id };
    setAvatar(na);
    if(user) fbSavePrefs(user, { coins:nc, owned:no, avatar:na });
    toast(`Unlocked ${c.name} 🎉`);
  };
  const equipCosmetic = (c)=>{
    const na = { ...avatar, [c.slot]: c.id };
    setAvatar(na);
    if(user) fbSavePrefs(user, { avatar:na });
  };

  // ── Subject actions ──
  const addSubject = (label, emoji, color)=>{
    const id = label.toLowerCase().replace(/[^a-z0-9]/g,"_").slice(0,20) + "_" + Date.now().toString(36).slice(-3);
    const ns=[...subjects,{id,label,emoji,color}];
    setSubjects(ns); setSubject(id);
    if(user) fbSavePrefs(user, { subjects:ns });
  };
  const removeSubject = (id)=>{
    if(subjects.length<=1){ toast("Keep at least one subject."); return; }
    const ns=subjects.filter(s=>s.id!==id);
    setSubjects(ns);
    if(subject===id) setSubject(ns[0].id);
    if(user) fbSavePrefs(user, { subjects:ns });
  };

  // ── Class actions ──
  const createClass = async (name)=>{
    const r = await fbCreateClass(name, user);
    if(!r.ok){ toast(r.error); return; }
    const nc=[...classes,{code:r.code,name:r.name}];
    setClasses(nc); if(user) fbSavePrefs(user,{classes:nc});
    setActiveClass({code:r.code,name:r.name,members:[user]});
    setModal(null);
    toast(`Class created — code ${r.code}`);
  };
  const joinClass = async (code)=>{
    const r = await fbJoinClass(code, user);
    if(!r.ok){ toast(r.error); return; }
    if(!classes.find(c=>c.code===r.code)){
      const nc=[...classes,{code:r.code,name:r.name}];
      setClasses(nc); if(user) fbSavePrefs(user,{classes:nc});
    }
    const c = await fbLoadClass(r.code);
    setActiveClass(c); setModal(null);
    toast(`Joined ${r.name}`);
  };
  const leaveClassView = ()=> setActiveClass(null);

  // ── Room actions ──
  const createRoom = async (goalMin)=>{
    const r = await fbCreateRoom(user, subjectObj.label, goalMin);
    if(!r.ok){ toast(r.error); return; }
    const rm = await fbLoadRoom(r.code);
    setRoom(rm); setModal(null); setDuration(goalMin*60); setMode("timer");
    toast(`Room open — share code ${r.code}`);
  };
  const joinRoom = async (code)=>{
    const r = await fbJoinRoom(code, user);
    if(!r.ok){ toast(r.error); return; }
    const rm = await fbLoadRoom(r.code);
    setRoom(rm); setModal(null);
    if(rm?.goalMin){ setDuration(rm.goalMin*60); setMode("timer"); }
    toast(`Joined room ${r.code}`);
  };
  const leaveRoom = async ()=>{
    if(room && user) await fbLeaveRoom(room.code, user);
    setRoom(null);
    toast("Left the room.");
  };

  const logout = ()=>{
    if(running) cancelSession();
    if(room && user) fbLeaveRoom(room.code, user);
    if(user) fbClearPresence(user);
    authLogout();
    localStorage.removeItem(LS_USER);
    setUser(""); setTab("focus"); setActiveClass(null); setRoom(null);
  };

  // ── Targets ──
  const setTarget = (subjId, hrs)=>{
    const nt = { ...targets, [subjId]: hrs };
    setTargets(nt); if(user) fbSavePrefs(user,{targets:nt});
  };

  if(!user) return (<><style>{APP_CSS+DARK_CSS}</style><Login onAuth={setUser}/></>);

  // ── Today's focus for current subject (from leaderboard weekly subjects is coarse; use elapsed live) ──
  const initials = user.slice(0,2).toUpperCase();

  return (
    <div className="sg-shell" data-theme={theme}>
      <style>{APP_CSS+DARK_CSS}</style>
      <div style={S.app}>
        {toastNode}

        {/* ── Header ── */}
        <div style={S.header}>
          <div style={S.logo}>{BRAND.logo} {BRAND.name}</div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={S.coinChip}>🪙 {coins}</div>
            <button style={S.menuBtn} onClick={()=>setModal("menu")}>
              <div style={S.menuAvatar}>{initials}</div>
              <span style={S.menuBars}>≡</span>
            </button>
          </div>
        </div>

        {/* ── Level / XP bar ── */}
        <div style={S.xpWrap}>
          <div style={S.xpTop}>
            <span style={{fontWeight:800,fontSize:13,color:BRAND.primary}}>Lv {level} · {tier.name}</span>
            <span style={{fontSize:11,color:"#999"}}>{xpInfo.into}/{xpInfo.span} XP</span>
          </div>
          <div style={S.xpTrack}><div style={{...S.xpFill,width:`${xpInfo.pct*100}%`}}/></div>
        </div>

        {/* ── Tabs ── */}
        <div style={S.nav}>
          {[["focus","Focus"],["classes","Classes"],["board","Ranks"],["stats","Stats"]].map(([id,lbl])=>(
            <button key={id} style={{...S.navBtn,...(tab===id?S.navBtnActive:{})}} onClick={()=>setTab(id)}>{lbl}</button>
          ))}
        </div>

        {/* ════════ FOCUS TAB ════════ */}
        {tab==="focus" && (
          <div style={S.timerView} className="sg-view-anim" key="view-focus">
            {/* Co-op room banner */}
            {room && (
              <div style={S.roomBanner}>
                <div>
                  <div style={{fontSize:12,fontWeight:800,color:BRAND.primary}}>🤝 Co-op room {room.code}</div>
                  <div style={{fontSize:11,color:"#888"}}>
                    {Object.values(room.participants||{}).filter(p=>p.focusing).length} focusing · {Object.keys(room.participants||{}).length} here
                  </div>
                </div>
                <button style={S.smallGhostBtn} onClick={leaveRoom}>Leave</button>
              </div>
            )}

            {/* Mode toggle */}
            {!running && (
              <div style={S.modeRow}>
                <button style={{...S.modeBtn,...(mode==="timer"?{...S.modeBtnActive,borderColor:subjectObj.color,color:subjectObj.color}:{})}} onClick={()=>setMode("timer")}>⏱ Timer</button>
                <button style={{...S.modeBtn,...(mode==="stopwatch"?{...S.modeBtnActive,borderColor:subjectObj.color,color:subjectObj.color}:{})}} onClick={()=>setMode("stopwatch")}>⏲ Stopwatch</button>
              </div>
            )}

            {/* Subject picker */}
            {!running && (
              <>
                <div style={S.subjHeader}>
                  <span style={S.subjHeaderLabel}>Subject</span>
                  {subjects.length>1 && (
                    <button
                      style={{...S.subjEditBtn,...(editMode?S.subjEditBtnActive:{})}}
                      onClick={()=>setEditMode(e=>!e)}>
                      {editMode?"Done":"Edit"}
                    </button>
                  )}
                </div>
                <div style={S.subjScroll}>
                  {subjects.map(s=>{
                    const sel = subject===s.id;
                    return (
                      <button key={s.id}
                        style={{...S.subjPill,...(sel?{borderColor:s.color,background:s.color+"14",color:s.color,fontWeight:700}:{})}}
                        onClick={()=> editMode ? (subjects.length>1 && removeSubject(s.id)) : setSubject(s.id)}>
                        <span style={{...S.subjDot,background:s.color}}/>{s.emoji} {s.label}
                        {editMode && subjects.length>1 && <span style={S.subjRemoveInline}>Remove</span>}
                      </button>
                    );
                  })}
                  {!editMode && <button style={S.subjAddPill} onClick={()=>setModal("subject")}>＋ Subject</button>}
                </div>
              </>
            )}

            {/* Per-session class attribution — only when you belong to classes */}
            {!running && classes.length>0 && (
              <div style={S.classPickRow}>
                <span style={S.classPickLabel}>Counts toward:</span>
                <button style={{...S.classPickChip,...(studyClass===null?S.classPickChipActive:{})}} onClick={()=>setStudyClass(null)}>
                  Just me
                </button>
                {classes.map(c=>(
                  <button key={c.code} style={{...S.classPickChip,...(studyClass===c.code?S.classPickChipActive:{})}} onClick={()=>setStudyClass(c.code)}>
                    🏫 {c.name}
                  </button>
                ))}
              </div>
            )}

            {/* Living World + Avatar */}
            <div style={S.worldStage}>
              <LivingWorld lifetimeHours={xp/60} streak={worldStreak} seedStr={user} focusing={running&&!paused}/>
              <div style={S.worldAvatar}>
                <AvatarSVG large progress={running?sessionProgress:0.5} tier={tier.id}
                           equipped={avatar} color={subjectObj.color} paused={paused} idle={!running}/>
              </div>
            </div>
            {/* World growth hint */}
            {(()=> {
              const ws = worldState(xp/60);
              return (
                <div style={S.worldHint}>
                  <div style={S.worldHintTop}>
                    <span style={S.worldHintLabel}>🌍 Your world · {(xp/60).toFixed(1)}h grown</span>
                    <span style={S.worldHintNext}>
                      {ws.maxed ? "Fully grown ✦" : `Next: ${WORLD_STAGES[ws.stageIdx+1].id}`}
                    </span>
                  </div>
                  <div style={S.worldHintTrack}>
                    <div style={{...S.worldHintFill,width:`${(ws.maxed?1:ws.toNext)*100}%`}}/>
                  </div>
                </div>
              );
            })()}

            <div style={{...S.timerDisplay,color:subjectObj.color}}>
              {running ? fmt(mode==="timer"?duration-elapsed:elapsed) : (mode==="timer"?fmt(duration):"00:00")}
            </div>
            <div style={S.timerLabel}>
              {running ? (paused?"Paused — your focus is on hold":(mode==="timer"?"Stay with it — you're growing":"Counting up — focus on")) :
               (mode==="timer"?"Set a length and start focusing":"Tap start — stopwatch counts up")}
            </div>

            {!running && mode==="timer" && (
              <div style={S.durationRow}>
                {[15,25,45,60,90].map(m=>(
                  <button key={m} style={{...S.durBtn,...(duration===m*60?{...S.durBtnActive,borderColor:subjectObj.color,color:subjectObj.color}:{})}}
                          onClick={()=>{setDuration(m*60);setElapsed(0);}}>{m}m</button>
                ))}
              </div>
            )}

            {!running ? (
              <button className="sg-plant-btn" style={{...S.plantBtn,background:subjectObj.color}} onClick={startSession}>Start focusing</button>
            ) : (
              <div style={{display:"flex",gap:10}}>
                <button style={{...S.plantBtn,flex:1,background:paused?subjectObj.color:"#fff",color:paused?"#fff":"#888",border:paused?"none":"1.5px solid #E0E8DC",boxShadow:"none"}} onClick={togglePause}>
                  {paused?"Resume":"Pause"}
                </button>
                {mode==="stopwatch" ? (
                  <button style={{...S.plantBtn,flex:1,background:subjectObj.color}} onClick={()=>finishSession(elapsed)}>Finish</button>
                ) : (
                  <button style={{...S.plantBtn,flex:1,background:"#fff",color:BRAND.danger,border:"1.5px solid #F0C9BC",boxShadow:"none"}}
                    onClick={()=>{ if(streakStakes && elapsed>=60){ if(window.confirm("Give up now? With streak stakes on, you'll lose some XP and your avatar shrinks back.")) cancelSession(); } else cancelSession(); }}>
                    {streakStakes ? "Give up ⚠️" : "Give up"}
                  </button>
                )}
              </div>
            )}

            {/* Quick actions */}
            {!running && (
              <div style={S.quickRow}>
                <button style={S.quickBtn} onClick={()=>setModal("shop")}>🎨 Customize</button>
                <button style={S.quickBtn} onClick={()=>setModal("room")}>🤝 Co-op room</button>
                <button style={S.quickBtn} onClick={()=>setModal("badges")}>🏅 Badges</button>
              </div>
            )}
          </div>
        )}

        {/* ════════ CLASSES TAB ════════ */}
        {tab==="classes" && (
          <div style={S.boardView} className="sg-view-anim" key="view-classes">
            {!activeClass ? (
              <>
                <div style={S.sectionTitle}>Your classes</div>
                {classes.length===0 && <div style={S.empty}>Join a class with a code, or create one for your cohort.</div>}
                {classes.map(c=>(
                  <button key={c.code} style={S.classCard} onClick={()=>setActiveClass({code:c.code,name:c.name,members:[]})}>
                    <div>
                      <div style={{fontSize:15,fontWeight:700,color:"#333"}}>{c.name}</div>
                      <div style={{fontSize:12,color:"#999"}}>Code {c.code}</div>
                    </div>
                    <span style={{fontSize:18,color:"#ccc"}}>›</span>
                  </button>
                ))}
                <button style={{...S.plantBtn,background:BRAND.primary,marginTop:14}} onClick={()=>setModal("class")}>＋ Join or create a class</button>
              </>
            ) : (
              <ClassCampus cls={activeClass} presence={classPresence} board={classBoard}
                           currentUser={user} loading={false} onLeave={leaveClassView}/>
            )}
          </div>
        )}

        {/* ════════ RANKS TAB ════════ */}
        {tab==="board" && (
          <div style={S.boardView} className="sg-view-anim" key="view-board">
            <FocusingNow presence={presence} currentUser={user}/>
            <div style={{height:14}}/>
            <LeaderboardPanel data={lb} currentUser={user} loading={lbLoading} subjects={subjects} title="Global ranks"/>
          </div>
        )}

        {/* ════════ STATS TAB ════════ */}
        {tab==="stats" && (
          <div style={S.boardView} className="sg-view-anim" key="view-stats">
            <AnalyticsPanel user={user} subjects={subjects} targets={targets}/>
          </div>
        )}

        {/* ════════ MODALS ════════ */}
        {modal==="subject" && (
          <SubjectModal onClose={()=>setModal(null)} onAdd={(l,e,c)=>{addSubject(l,e,c);setModal(null);}}/>
        )}

        {modal==="shop" && (
          <Modal title="Customize your avatar" onClose={()=>setModal(null)}>
            <div style={{display:"flex",justifyContent:"center",marginBottom:8}}>
              <AvatarSVG progress={0.9} tier={tier.id} equipped={avatar} color={subjectObj.color} idle/>
            </div>
            <div style={{fontSize:12,color:"#888",textAlign:"center",marginBottom:14}}>Lv {level} · {tier.name} · 🪙 {coins}</div>
            {SLOTS.map(slot=>(
              <div key={slot.id} style={{marginBottom:16}}>
                <div style={S.shopSlotTitle}>{slot.emoji} {slot.label}</div>
                <div style={S.shopGrid}>
                  {COSMETICS.filter(c=>c.slot===slot.id).map(c=>{
                    const isOwned = owned.includes(c.id);
                    const isEquipped = avatar[slot.id]===c.id;
                    return (
                      <button key={c.id} className="sg-tap-card"
                        style={{...S.shopCard,...(isEquipped?{borderColor:BRAND.primary,background:BRAND.primarySoft}:{})}}
                        onClick={()=>buyCosmetic(c)}>
                        <div style={{fontSize:11,fontWeight:700,color:"#444",marginBottom:2}}>{c.name}</div>
                        {isEquipped ? <div style={S.shopTag}>Equipped</div> :
                         isOwned ? <div style={{...S.shopTag,background:"#EEF2EC",color:"#888"}}>Equip</div> :
                         <div style={{...S.shopTag,background:"#FFF8E7",color:"#B8860B"}}>🪙 {c.cost}</div>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </Modal>
        )}

        {modal==="badges" && (
          <Modal title="Badges" onClose={()=>setModal(null)}>
            <div style={S.badgeGrid}>
              {BADGES.map(b=>{
                const got = badges.includes(b.id);
                return (
                  <div key={b.id} style={{...S.badgeCard,opacity:got?1:0.5}}>
                    <div style={{fontSize:28}}>{got?b.emoji:"🔒"}</div>
                    <div style={{fontSize:12,fontWeight:700,color:"#333",textAlign:"center"}}>{b.name}</div>
                    <div style={{fontSize:10,color:"#999",textAlign:"center"}}>{b.desc}</div>
                  </div>
                );
              })}
            </div>
          </Modal>
        )}

        {modal==="class" && (
          <ClassModal onClose={()=>setModal(null)} onCreate={createClass} onJoin={joinClass}/>
        )}

        {modal==="room" && (
          <RoomModal room={room} onClose={()=>setModal(null)} onCreate={createRoom} onJoin={joinRoom} onLeave={leaveRoom}/>
        )}

        {modal==="menu" && (
          <Modal title={`Hi, ${user}`} onClose={()=>setModal(null)}>
            <div style={{display:"flex",justifyContent:"center",marginBottom:10}}>
              <AvatarSVG progress={0.9} tier={tier.id} equipped={avatar} color={subjectObj.color} idle/>
            </div>
            <div style={{textAlign:"center",fontSize:13,color:"#888",marginBottom:16}}>Level {level} · {tier.name}</div>
            <button style={S.menuRow} onClick={()=>{setTheme(theme==="light"?"dark":"light");}}>
              {theme==="light"?"🌙 Dark mode":"☀️ Light mode"}
            </button>
            <button style={S.menuRow} onClick={()=>{setModal("targets");}}>🎯 Weekly targets</button>
            <button style={S.menuRow} onClick={()=>{ const v=!streakStakes; setStreakStakes(v); if(user) fbSavePrefs(user,{streakStakes:v}); }}>
              {streakStakes ? "🔥 Streak stakes: ON — giving up costs XP" : "🛡️ Streak stakes: OFF — no penalty"}
            </button>
            <button style={{...S.menuRow,color:BRAND.danger}} onClick={logout}>↩ Sign out</button>
          </Modal>
        )}

        {modal==="targets" && (
          <Modal title="Weekly targets (hours)" onClose={()=>setModal(null)}>
            {subjects.map(s=>(
              <div key={s.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                <span style={{fontSize:14,fontWeight:600}}>{s.emoji} {s.label}</span>
                <input type="number" min="0" step="0.5" value={targets[s.id]||""} placeholder="0"
                  style={{width:70,padding:"8px",border:"1.5px solid #E0E8DC",borderRadius:10,fontSize:14,textAlign:"center"}}
                  onChange={e=>setTarget(s.id, Number(e.target.value))}/>
              </div>
            ))}
          </Modal>
        )}

        {modal==="levelup" && levelUpInfo && (
          <Modal onClose={()=>setModal(null)}>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:13,fontWeight:700,letterSpacing:2,color:BRAND.primary,textTransform:"uppercase"}}>
                {levelUpInfo.evolved?"Evolution":"Level up"}
              </div>
              <div style={{fontSize:32,fontWeight:900,color:BRAND.primary,margin:"4px 0"}}>Level {levelUpInfo.level}</div>
              <div style={{display:"flex",justifyContent:"center",margin:"8px 0"}}>
                <AvatarSVG large progress={1} tier={tier.id} equipped={avatar} color={subjectObj.color} idle/>
              </div>
              {levelUpInfo.evolved && <div style={{fontSize:15,fontWeight:700,color:"#7B6FE0",marginBottom:6}}>You're now a {levelUpInfo.tierName} ✨</div>}
              <button style={{...S.plantBtn,background:BRAND.primary,marginTop:10}} onClick={()=>setModal(null)}>Keep going</button>
            </div>
          </Modal>
        )}

      </div>
    </div>
  );
}

// ── Subject modal ─────────────────────────────────────────────────────────────────
function SubjectModal({ onClose, onAdd }) {
  const [label,setLabel]=useState(""); const [emoji,setEmoji]=useState("📐"); const [color,setColor]=useState("#5B8DEF");
  return (
    <Modal title="New subject" onClose={onClose}>
      <input style={S.input} placeholder="Subject name" value={label} onChange={e=>setLabel(e.target.value)} autoFocus/>
      <div style={{fontSize:12,fontWeight:600,color:"#888",margin:"8px 0 6px"}}>Icon</div>
      <div style={S.pickGrid}>
        {EMOJI_OPTIONS.map(e=>(
          <button key={e} style={{...S.pickEmoji,...(emoji===e?{borderColor:color,background:"#F0FBF6"}:{})}} onClick={()=>setEmoji(e)}>{e}</button>
        ))}
      </div>
      <div style={{fontSize:12,fontWeight:600,color:"#888",margin:"10px 0 6px"}}>Color</div>
      <div style={S.pickGrid}>
        {COLOR_OPTIONS.map(c=>(
          <button key={c} style={{...S.pickColor,background:c,...(color===c?{outline:`3px solid ${BRAND.primary}`,outlineOffset:2}:{})}} onClick={()=>setColor(c)}/>
        ))}
      </div>
      <button style={{...S.plantBtn,background:color,marginTop:14}} disabled={!label.trim()} onClick={()=>label.trim()&&onAdd(label.trim(),emoji,color)}>Add subject</button>
    </Modal>
  );
}

// ── Class modal ───────────────────────────────────────────────────────────────────
function ClassModal({ onClose, onCreate, onJoin }) {
  const [tab,setTab]=useState("join"); const [code,setCode]=useState(""); const [name,setName]=useState("");
  return (
    <Modal title="Classes" onClose={onClose}>
      <div style={S.toggleRow}>
        <button style={{...S.toggleBtn,...(tab==="join"?S.toggleBtnActive:{})}} onClick={()=>setTab("join")}>Join</button>
        <button style={{...S.toggleBtn,...(tab==="create"?S.toggleBtnActive:{})}} onClick={()=>setTab("create")}>Create</button>
      </div>
      {tab==="join" ? <>
        <div style={S.recHint}>Enter the 6-character code your teacher or classmate shared.</div>
        <input style={{...S.input,textTransform:"uppercase",letterSpacing:3,textAlign:"center",fontWeight:700}}
               placeholder="ABC123" maxLength={6} value={code} onChange={e=>setCode(e.target.value)}/>
        <button style={{...S.plantBtn,background:BRAND.primary,marginTop:8}} disabled={code.length<6} onClick={()=>onJoin(code)}>Join class</button>
      </> : <>
        <div style={S.recHint}>Name your class — you'll get a code to share.</div>
        <input style={S.input} placeholder="e.g. Year 12 Physics" value={name} onChange={e=>setName(e.target.value)}/>
        <button style={{...S.plantBtn,background:BRAND.primary,marginTop:8}} disabled={!name.trim()} onClick={()=>onCreate(name.trim())}>Create class</button>
      </>}
    </Modal>
  );
}

// ── Room modal ────────────────────────────────────────────────────────────────────
function RoomModal({ room, onClose, onCreate, onJoin, onLeave }) {
  const [tab,setTab]=useState("join"); const [code,setCode]=useState(""); const [goal,setGoal]=useState(25);
  if(room) return (
    <Modal title={`Co-op room ${room.code}`} onClose={onClose}>
      <div style={S.recHint}>Share this code so classmates can focus alongside you. You'll see who's live on the Focus screen.</div>
      <div style={{textAlign:"center",fontSize:28,fontWeight:900,letterSpacing:4,color:BRAND.primary,margin:"6px 0"}}>{room.code}</div>
      <div style={{fontSize:12,color:"#888",textAlign:"center",marginBottom:12}}>{Object.keys(room.participants||{}).length} people here</div>
      <button style={{...S.plantBtn,background:"#fff",color:BRAND.danger,border:"1.5px solid #F0C9BC",boxShadow:"none"}} onClick={()=>{onLeave();onClose();}}>Leave room</button>
    </Modal>
  );
  return (
    <Modal title="Co-op focus room" onClose={onClose}>
      <div style={S.toggleRow}>
        <button style={{...S.toggleBtn,...(tab==="join"?S.toggleBtnActive:{})}} onClick={()=>setTab("join")}>Join</button>
        <button style={{...S.toggleBtn,...(tab==="create"?S.toggleBtnActive:{})}} onClick={()=>setTab("create")}>Host</button>
      </div>
      {tab==="join" ? <>
        <div style={S.recHint}>Focus together in real time. Enter a room code.</div>
        <input style={{...S.input,textTransform:"uppercase",letterSpacing:3,textAlign:"center",fontWeight:700}}
               placeholder="ABC123" maxLength={6} value={code} onChange={e=>setCode(e.target.value)}/>
        <button style={{...S.plantBtn,background:BRAND.primary,marginTop:8}} disabled={code.length<6} onClick={()=>onJoin(code)}>Join room</button>
      </> : <>
        <div style={S.recHint}>Pick a session length. Everyone in the room aims for the same goal.</div>
        <div style={S.durationRow}>
          {[15,25,45,60].map(m=>(
            <button key={m} style={{...S.durBtn,...(goal===m?{...S.durBtnActive,borderColor:BRAND.primary,color:BRAND.primary}:{})}} onClick={()=>setGoal(m)}>{m}m</button>
          ))}
        </div>
        <button style={{...S.plantBtn,background:BRAND.primary,marginTop:8}} onClick={()=>onCreate(goal)}>Open room</button>
      </>}
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────────
const S = {
  app:{minHeight:"100vh",background:BRAND.bg,fontFamily:"'Inter','Segoe UI',sans-serif",maxWidth:440,margin:"0 auto",position:"relative",paddingBottom:30},
  header:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"18px 16px 0"},
  logo:{fontSize:18,fontWeight:800,color:BRAND.primary,letterSpacing:"-0.3px",display:"flex",alignItems:"center",gap:6},
  coinChip:{fontSize:12,color:BRAND.coinText,background:BRAND.coinBg,border:`1px solid ${BRAND.coinBorder}`,borderRadius:20,padding:"5px 11px",fontWeight:700},
  menuBtn:{display:"flex",alignItems:"center",gap:6,background:BRAND.surface,border:`1px solid ${BRAND.border}`,borderRadius:20,padding:"3px 9px 3px 3px",cursor:"pointer"},
  menuAvatar:{width:24,height:24,borderRadius:"50%",background:BRAND.primary,color:"#fff",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"},
  menuBars:{fontSize:14,color:BRAND.muted,lineHeight:1},

  xpWrap:{padding:"14px 16px 0"},
  xpTop:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6},
  xpTrack:{height:8,background:BRAND.track,borderRadius:8,overflow:"hidden"},
  xpFill:{height:"100%",borderRadius:8,background:`linear-gradient(90deg,${BRAND.accent},${BRAND.primary})`,transition:"width 0.6s cubic-bezier(0.22,1,0.36,1)"},

  nav:{display:"flex",gap:4,padding:"14px 12px 12px",borderBottom:`1px solid ${BRAND.border}`},
  navBtn:{flex:1,padding:"9px 0",border:"none",background:"transparent",borderRadius:11,fontSize:12,fontWeight:600,color:BRAND.muted,cursor:"pointer"},
  navBtnActive:{background:BRAND.surface,color:BRAND.primary,fontWeight:800,boxShadow:`0 2px 10px ${BRAND.primary}22`},

  timerView:{padding:"16px 16px 40px"},
  modeRow:{display:"flex",gap:8,marginBottom:14},
  modeBtn:{flex:1,padding:"10px 0",border:`1.5px solid ${BRAND.border}`,background:BRAND.surface,borderRadius:20,fontSize:13,fontWeight:600,color:BRAND.muted,cursor:"pointer"},
  modeBtnActive:{fontWeight:700},

  subjHeader:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8},
  subjHeaderLabel:{fontSize:11,fontWeight:800,color:BRAND.muted,textTransform:"uppercase",letterSpacing:"0.6px"},
  subjEditBtn:{fontSize:11,fontWeight:700,color:BRAND.muted,background:BRAND.surface,border:`1.5px solid ${BRAND.border}`,borderRadius:16,padding:"4px 12px",cursor:"pointer"},
  subjEditBtnActive:{color:BRAND.danger,borderColor:BRAND.danger,background:"#FCEEEA"},
  subjScroll:{display:"flex",gap:8,overflowX:"auto",paddingBottom:6,marginBottom:10,WebkitOverflowScrolling:"touch"},
  classPickRow:{display:"flex",alignItems:"center",gap:6,overflowX:"auto",paddingBottom:6,marginBottom:8,WebkitOverflowScrolling:"touch"},
  classPickLabel:{fontSize:11,fontWeight:700,color:BRAND.mutedSoft,whiteSpace:"nowrap",flexShrink:0,textTransform:"uppercase",letterSpacing:"0.5px"},
  classPickChip:{padding:"6px 13px",border:`1.5px solid ${BRAND.border}`,background:BRAND.surface,borderRadius:18,fontSize:12,fontWeight:600,color:BRAND.muted,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0},
  classPickChipActive:{borderColor:BRAND.primary,background:BRAND.primarySoft,color:BRAND.primary},
  subjPill:{display:"flex",alignItems:"center",gap:6,padding:"10px 15px",border:`1.5px solid ${BRAND.border}`,background:BRAND.surface,borderRadius:22,cursor:"pointer",color:BRAND.muted,fontWeight:600,whiteSpace:"nowrap",flexShrink:0,transition:"all 0.15s"},
  subjDot:{width:8,height:8,borderRadius:"50%",flexShrink:0},
  subjRemoveInline:{marginLeft:4,fontSize:11,fontWeight:800,color:BRAND.danger,letterSpacing:"0.3px"},
  subjAddPill:{display:"flex",alignItems:"center",padding:"10px 15px",border:`1.5px dashed ${BRAND.borderHi}`,background:"transparent",borderRadius:22,cursor:"pointer",color:BRAND.primary,fontWeight:700,whiteSpace:"nowrap",flexShrink:0},

  avatarWrap:{display:"flex",justifyContent:"center",alignItems:"flex-end",minHeight:260,margin:"6px 0"},
  worldStage:{position:"relative",width:"100%",height:260,borderRadius:20,overflow:"hidden",margin:"6px 0 0",boxShadow:`inset 0 -20px 40px rgba(30,27,51,0.18), 0 6px 22px ${BRAND.primary}1A`},
  worldAvatar:{position:"absolute",left:0,right:0,bottom:0,display:"flex",justifyContent:"center",alignItems:"flex-end",pointerEvents:"none"},
  worldHint:{background:BRAND.surface,borderRadius:14,padding:"10px 13px",margin:"10px 0 4px",boxShadow:"0 1px 4px rgba(30,27,51,0.05)"},
  worldHintTop:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7},
  worldHintLabel:{fontSize:12,fontWeight:800,color:BRAND.ink},
  worldHintNext:{fontSize:11,fontWeight:700,color:BRAND.muted,textTransform:"capitalize"},
  worldHintTrack:{height:6,background:BRAND.track,borderRadius:8,overflow:"hidden"},
  worldHintFill:{height:"100%",borderRadius:8,background:`linear-gradient(90deg,${BRAND.accent},${BRAND.primary})`,transition:"width 0.6s cubic-bezier(0.22,1,0.36,1)"},
  timerDisplay:{textAlign:"center",fontSize:48,fontWeight:800,letterSpacing:"-2px",margin:"0 0 4px"},
  timerLabel:{textAlign:"center",fontSize:13,color:BRAND.muted,marginBottom:14,minHeight:18},
  durationRow:{display:"flex",gap:6,justifyContent:"center",marginBottom:14,flexWrap:"wrap"},
  durBtn:{padding:"7px 13px",border:`1.5px solid ${BRAND.border}`,background:BRAND.surface,borderRadius:20,fontSize:13,fontWeight:600,cursor:"pointer",color:BRAND.muted},
  durBtnActive:{fontWeight:700},
  plantBtn:{display:"block",width:"100%",padding:"16px 0",border:"none",borderRadius:16,fontSize:16,fontWeight:800,color:"#fff",cursor:"pointer",boxShadow:`0 6px 22px ${BRAND.primary}33`,letterSpacing:"-0.3px"},
  quickRow:{display:"flex",gap:8,marginTop:16},
  quickBtn:{flex:1,padding:"12px 0",border:`1.5px solid ${BRAND.border}`,background:BRAND.surface,borderRadius:12,fontSize:12,fontWeight:700,color:BRAND.muted,cursor:"pointer"},

  roomBanner:{display:"flex",justifyContent:"space-between",alignItems:"center",background:BRAND.primarySoft,border:`1.5px solid ${BRAND.borderHi}`,borderRadius:14,padding:"11px 14px",marginBottom:12},
  smallGhostBtn:{background:BRAND.surface,border:`1px solid ${BRAND.border}`,borderRadius:16,padding:"6px 13px",fontSize:12,fontWeight:700,color:BRAND.muted,cursor:"pointer"},

  boardView:{padding:"18px 16px 40px"},
  sectionTitle:{fontSize:13,fontWeight:800,color:BRAND.muted,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:12},
  toggleRow:{display:"flex",gap:8,marginBottom:14},
  toggleBtn:{flex:1,padding:"10px 0",border:`1.5px solid ${BRAND.border}`,background:BRAND.surface,borderRadius:11,fontSize:13,fontWeight:600,color:BRAND.muted,cursor:"pointer"},
  toggleBtnActive:{background:BRAND.primary,color:"#fff",border:`1.5px solid ${BRAND.primary}`,fontWeight:700},
  boardRow:{display:"flex",alignItems:"center",gap:8,background:BRAND.surface,borderRadius:14,padding:"13px 15px",marginBottom:8,boxShadow:"0 1px 4px rgba(30,27,51,0.05)"},
  boardRowMe:{border:`2px solid ${BRAND.primary}`,background:BRAND.primarySoft},
  boardRank:{width:30,fontSize:17,textAlign:"center"},
  empty:{textAlign:"center",color:BRAND.mutedSoft,fontSize:14,marginTop:30,marginBottom:20,lineHeight:1.5},

  // presence
  presenceWrap:{background:BRAND.surface,borderRadius:16,padding:"13px 15px",boxShadow:"0 1px 4px rgba(30,27,51,0.05)"},
  presenceEmpty:{display:"flex",flexDirection:"column",gap:4,background:BRAND.surface,borderRadius:16,padding:"16px 14px",textAlign:"center",color:BRAND.muted,boxShadow:"0 1px 4px rgba(30,27,51,0.05)"},
  presenceTitle:{display:"flex",alignItems:"center",gap:6,fontSize:12,fontWeight:800,color:BRAND.primary,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.5px"},
  presenceRow:{display:"flex",gap:8,overflowX:"auto",paddingBottom:4},
  presenceChip:{display:"flex",alignItems:"center",gap:8,background:BRAND.bg,border:`1.5px solid ${BRAND.border}`,borderRadius:14,padding:"8px 12px",flexShrink:0},
  liveDot:{width:8,height:8,borderRadius:"50%",background:BRAND.live,boxShadow:"0 0 0 0 rgba(52,199,89,0.5)",animation:"sgpulse 2s infinite",display:"inline-block"},

  // class campus
  campusHeader:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16},
  campusGrid:{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10},
  campusTile:{display:"flex",flexDirection:"column",alignItems:"center",background:BRAND.surface,borderRadius:16,padding:"10px 8px 12px",border:`2px solid ${BRAND.border}`,position:"relative",boxShadow:"0 1px 4px rgba(30,27,51,0.05)"},
  campusLive:{position:"absolute",top:8,left:8,display:"flex",alignItems:"center",gap:4,fontSize:10,fontWeight:700,color:BRAND.live},
  classCard:{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%",background:BRAND.surface,border:`1.5px solid ${BRAND.border}`,borderRadius:14,padding:"14px 16px",marginBottom:8,cursor:"pointer"},

  // analytics
  statCardRow:{display:"flex",gap:8,marginBottom:14},
  statCard:{flex:1,background:BRAND.surface,borderRadius:16,padding:"14px 8px",textAlign:"center",boxShadow:"0 1px 4px rgba(30,27,51,0.05)"},
  statNum:{fontSize:20,fontWeight:900,color:BRAND.primary},
  statLbl:{fontSize:11,color:BRAND.muted,marginTop:2},
  panel:{background:BRAND.surface,borderRadius:18,padding:"15px",marginBottom:14,boxShadow:"0 1px 4px rgba(30,27,51,0.05)"},
  panelTitle:{fontSize:13,fontWeight:700,color:BRAND.ink,marginBottom:12},
  barRow:{display:"flex",justifyContent:"space-between",alignItems:"flex-end",height:110,gap:6},
  barCol:{flex:1,display:"flex",flexDirection:"column",alignItems:"center",height:"100%"},
  barTrack:{flex:1,width:"100%",display:"flex",alignItems:"flex-end",justifyContent:"center"},
  barFill:{width:"70%",borderRadius:"6px 6px 0 0",minHeight:3,transition:"height 0.5s ease"},
  barLbl:{fontSize:10,color:BRAND.mutedSoft,marginTop:6},
  targetTrack:{height:7,background:BRAND.track,borderRadius:8,overflow:"hidden"},
  targetFill:{height:"100%",borderRadius:8,transition:"width 0.5s ease"},

  // modal
  overlay:{position:"fixed",inset:0,background:"rgba(30,27,51,0.5)",display:"flex",alignItems:"center",justifyContent:"center",padding:18,zIndex:300},
  modal:{background:BRAND.surface,borderRadius:24,padding:"24px 20px",width:"100%",maxWidth:380,maxHeight:"86vh",overflowY:"auto",boxShadow:"0 16px 48px rgba(30,27,51,0.25)"},
  modalTitle:{fontSize:18,fontWeight:800,color:BRAND.primary,marginBottom:16,textAlign:"center"},
  menuRow:{display:"block",width:"100%",textAlign:"left",background:BRAND.bg,border:`1.5px solid ${BRAND.border}`,borderRadius:12,padding:"13px 16px",fontSize:14,fontWeight:600,color:BRAND.ink,cursor:"pointer",marginBottom:8},

  // shop
  shopSlotTitle:{fontSize:12,fontWeight:800,color:BRAND.muted,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8},
  shopGrid:{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8},
  shopCard:{display:"flex",flexDirection:"column",alignItems:"center",gap:4,background:BRAND.surface,border:`1.5px solid ${BRAND.border}`,borderRadius:12,padding:"10px 6px",cursor:"pointer"},
  shopTag:{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:10,background:BRAND.primarySoft,color:BRAND.primary},

  // badges
  badgeGrid:{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10},
  badgeCard:{display:"flex",flexDirection:"column",alignItems:"center",gap:4,background:BRAND.bg,borderRadius:14,padding:"12px 6px"},

  // pickers
  pickGrid:{display:"flex",flexWrap:"wrap",gap:6},
  pickEmoji:{width:40,height:40,border:`1.5px solid ${BRAND.border}`,background:BRAND.surface,borderRadius:10,fontSize:18,cursor:"pointer"},
  pickColor:{width:34,height:34,border:"none",borderRadius:"50%",cursor:"pointer"},

  // login
  loginWrap:{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:BRAND.bgGrad,padding:20},
  loginCard:{background:BRAND.surface,borderRadius:26,padding:"40px 30px",width:"100%",maxWidth:340,boxShadow:`0 10px 40px ${BRAND.primary}1F`,textAlign:"center"},
  loginTitle:{fontSize:30,fontWeight:900,color:BRAND.primary,margin:"0 0 4px",letterSpacing:"-0.5px"},
  loginSub:{fontSize:14,color:BRAND.muted,margin:"0 0 24px"},
  loginHint:{fontSize:11,color:BRAND.mutedSoft,margin:"12px 0 0",lineHeight:1.6},
  input:{display:"block",width:"100%",padding:"12px 14px",border:`1.5px solid ${BRAND.border}`,borderRadius:12,fontSize:15,outline:"none",boxSizing:"border-box",marginBottom:8},
  errText:{color:BRAND.danger,fontSize:12,margin:"0 0 8px",textAlign:"left"},
  primaryBtn:{display:"block",width:"100%",padding:"14px 0",background:BRAND.primary,color:"#fff",border:"none",borderRadius:14,fontSize:16,fontWeight:700,cursor:"pointer",marginTop:8},
  linkBtn:{display:"block",width:"100%",background:"none",border:"none",color:BRAND.primary,fontSize:13,fontWeight:600,cursor:"pointer",marginTop:12,padding:"4px 0"},
  recBox:{background:BRAND.bg,border:`1px solid ${BRAND.border}`,borderRadius:12,padding:"12px",margin:"4px 0 8px",textAlign:"left"},
  recHint:{fontSize:12,color:BRAND.muted,margin:"0 0 8px",lineHeight:1.5},
  toast:{position:"fixed",top:20,left:"50%",transform:"translateX(-50%)",background:BRAND.ink,color:"#fff",padding:"10px 20px",borderRadius:24,fontSize:13,fontWeight:600,boxShadow:"0 4px 16px rgba(30,27,51,0.3)",zIndex:400,maxWidth:"90%",textAlign:"center"},
};
