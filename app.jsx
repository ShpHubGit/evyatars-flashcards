import React, { useState, useEffect, useRef, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, query, where, getDocs, writeBatch } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";

/* ---------- firebase ---------- */
let db = null;
let auth = null;
const CONFIG_OK =
  typeof window !== "undefined" &&
  window.FIREBASE_CONFIG &&
  !String(window.FIREBASE_CONFIG.apiKey || "").includes("PASTE");
if (CONFIG_OK) {
  try {
    const fbApp = initializeApp(window.FIREBASE_CONFIG);
    db = getFirestore(fbApp);
    auth = getAuth(fbApp);
  } catch (e) {
    console.error("Firebase init failed", e);
  }
}

/* ------------------------------------------------------------------ */
/*  Otiyot — Hebrew flashcards for the classroom                       */
/*  Palette: paper #FAF8F2 · ink #1F2A44 · tekhelet #3454D1            */
/*           pomegranate #C64B4B · olive #4C8055                       */
/* ------------------------------------------------------------------ */

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const SEED = {
  classes: [
    {
      id: "c-4th",
      name: "4th Grade",
      decks: [
        {
          id: "d-colors",
          name: "Colors · צְבָעִים",
          cards: [
            { id: uid(), he: "אָדֹם", en: "red", tr: "adom" },
            { id: uid(), he: "כָּחֹל", en: "blue", tr: "kachol" },
            { id: uid(), he: "יָרֹק", en: "green", tr: "yarok" },
            { id: uid(), he: "צָהֹב", en: "yellow", tr: "tzahov" },
            { id: uid(), he: "לָבָן", en: "white", tr: "lavan" },
            { id: uid(), he: "שָׁחֹר", en: "black", tr: "shachor" },
          ],
        },
        {
          id: "d-family",
          name: "Family · מִשְׁפָּחָה",
          cards: [
            { id: uid(), he: "אִמָּא", en: "mom", tr: "ima" },
            { id: uid(), he: "אַבָּא", en: "dad", tr: "aba" },
            { id: uid(), he: "אָח", en: "brother", tr: "ach" },
            { id: uid(), he: "אָחוֹת", en: "sister", tr: "achot" },
            { id: uid(), he: "סַבָּא", en: "grandpa", tr: "saba" },
            { id: uid(), he: "סָבְתָא", en: "grandma", tr: "savta" },
          ],
        },
      ],
    },
    {
      id: "c-6th",
      name: "6th Grade · Period 3",
      decks: [
        {
          id: "d-verbs",
          name: "Unit 3 Verbs",
          cards: [
            { id: uid(), he: "לִלְמֹד", en: "to learn", tr: "lilmod" },
            { id: uid(), he: "לִכְתֹּב", en: "to write", tr: "lichtov" },
            { id: uid(), he: "לִקְרֹא", en: "to read", tr: "likro" },
            { id: uid(), he: "לְדַבֵּר", en: "to speak", tr: "ledaber" },
            { id: uid(), he: "לִשְׁמֹעַ", en: "to hear", tr: "lishmo'a" },
          ],
        },
      ],
    },
  ],
};

/* ---------- storage ---------- */

async function loadData() {
  const snap = await getDoc(doc(db, "app", "data"));
  if (snap.exists()) {
    const d = snap.data();
    if (Array.isArray(d.classes)) return { classes: d.classes };
  }
  // nothing saved yet — show the sample content; the teacher's first save creates the document
  return structuredClone(SEED);
}

async function persist(data) {
  try {
    await setDoc(doc(db, "app", "data"), { classes: data.classes, updatedAt: Date.now() });
    return true;
  } catch (e) {
    console.error("Save failed", e);
    return false;
  }
}

/* ---------- Hebrew text-to-speech ---------- */

function useHebrewVoice() {
  const [voice, setVoice] = useState(null);
  const [checked, setChecked] = useState(false);
  const supported = typeof window !== "undefined" && !!window.speechSynthesis;
  useEffect(() => {
    if (!supported) { setChecked(true); return; }
    const pick = () => {
      const vs = window.speechSynthesis.getVoices();
      if (vs.length) {
        setVoice(vs.find((v) => (v.lang || "").toLowerCase().startsWith("he")) || null);
        setChecked(true);
      }
    };
    pick();
    window.speechSynthesis.addEventListener("voiceschanged", pick);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", pick);
  }, [supported]);
  return { voice, supported, checked };
}

function speakHebrew(text, voice) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "he-IL";
  if (voice) u.voice = voice;
  u.rate = 0.85;
  window.speechSynthesis.speak(u);
}

function SpeakerBtn({ text, voice, size = 34, onDark }) {
  return (
    <button
      aria-label="Read the Hebrew out loud"
      title="Read out loud"
      onClick={(e) => { e.stopPropagation(); speakHebrew(text, voice); }}
      style={{
        width: size, height: size, borderRadius: "50%",
        border: `1.5px solid ${onDark ? "#C6D1F2" : T.line}`,
        background: T.blueSoft, color: T.blue,
        fontSize: size * 0.45, cursor: "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}
    >
      🔊
    </button>
  );
}

function shuffleArr(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- lookups: translation + pictures (both free, no API key) ---------- */

// niqqud confuses machine translation, so send the bare letters
const stripNiqqud = (s) => (s || "").replace(/[\u0591-\u05C7]/g, "");

async function translateHeToEn(text) {
  const q = stripNiqqud(text).trim();
  if (!q) throw new Error("empty");
  const res = await fetch(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=he|en`
  );
  if (!res.ok) throw new Error("http");
  const j = await res.json();
  const t = (j?.responseData?.translatedText || "").trim();
  if (!t || t === q || /mymemory warning|invalid|query length/i.test(t)) throw new Error("no result");
  // MyMemory sometimes SHOUTS; make it look like the rest of the deck
  return t === t.toUpperCase() && t.length > 3 ? t.toLowerCase() : t;
}

async function searchPictures(term) {
  const q = (term || "").trim();
  if (!q) return [];
  const url =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*" +
    "&generator=search&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url&iiurlwidth=500" +
    `&gsrsearch=${encodeURIComponent(q + " filetype:bitmap")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("http");
  const j = await res.json();
  const pages = j?.query?.pages ? Object.values(j.query.pages) : [];
  return pages
    .map((p) => ({
      title: (p.title || "").replace(/^File:/, ""),
      thumb: p.imageinfo?.[0]?.thumburl || "",
    }))
    .filter((x) => x.thumb && /\.(jpe?g|png|gif|webp)$/i.test(x.thumb))
    .slice(0, 8);
}

/* ---------- Blooket export ---------- */

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const BLOOKET_HEADER = [
  "Question #",
  "Question Text",
  "Answer 1",
  "Answer 2",
  "Answer 3 (Optional)",
  "Answer 4 (Optional)",
  "Time Limit (sec)",
  "Correct Answer(s)",
];

// Blooket only takes multiple choice, so each word becomes a question with
// wrong answers borrowed from the same deck — same idea as the reading quiz.
function buildBlooketRows(deck, dir, seconds) {
  const cards = deck.cards.filter((c) => (c.he || "").trim() && (c.en || "").trim());
  const ask = (c) => (dir === "en2he" ? c.en : c.he);
  const ans = (c) => (dir === "en2he" ? c.he : c.en);
  return cards.map((card, i) => {
    const seen = new Set([ans(card).trim().toLowerCase()]);
    const wrong = [];
    for (const other of shuffleArr(cards)) {
      if (other.id === card.id) continue;
      const k = ans(other).trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      wrong.push(ans(other));
      if (wrong.length === 3) break;
    }
    const options = shuffleArr([ans(card), ...wrong]);
    return [
      i + 1,
      ask(card),
      options[0] || "",
      options[1] || "",
      options[2] || "",
      options[3] || "",
      seconds,
      options.indexOf(ans(card)) + 1,
    ];
  });
}

const toCSV = (rows) => [BLOOKET_HEADER, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
const toTSV = (rows) => rows.map((r) => r.join("\t")).join("\n");

function downloadText(text, filename, mime) {
  try {
    const blob = new Blob([text], { type: `${mime};charset=utf-8;` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch (e) {
    return false;
  }
}

function buildQuestions(deck) {
  return shuffleArr(deck.cards).map((card) => {
    const seen = new Set([card.en.trim().toLowerCase()]);
    const distractors = [];
    for (const other of shuffleArr(deck.cards)) {
      if (other.id === card.id) continue;
      const key = other.en.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      distractors.push(other.en);
      if (distractors.length === 3) break;
    }
    return { card, options: shuffleArr([card.en, ...distractors]) };
  });
}

/* ---------- anonymous results (aggregate stats, no identities) ---------- */

async function logResult(deckId, record) {
  try {
    await addDoc(collection(db, "results"), { ...record, deckId, ts: Date.now() });
  } catch (e) {
    console.error("Could not log result", e);
  }
}

async function loadResults(deckId) {
  try {
    const snap = await getDocs(query(collection(db, "results"), where("deckId", "==", deckId)));
    return snap.docs.map((d) => d.data());
  } catch (e) {
    return [];
  }
}

async function clearResults(deckId) {
  try {
    const snap = await getDocs(query(collection(db, "results"), where("deckId", "==", deckId)));
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = writeBatch(db);
      docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (e) {
    console.error("Could not clear results", e);
  }
}

/* ---------- backup: export / import ---------- */

async function buildBackup(data) {
  const results = {};
  for (const c of data.classes) {
    for (const dk of c.decks) {
      results[dk.id] = await loadResults(dk.id);
    }
  }
  // deliberately excludes credentials — a backup file shouldn't unlock teacher mode
  return { app: "otiyot", version: 1, exportedAt: Date.now(), data: { classes: data.classes }, results };
}

function downloadJSON(obj, filename) {
  try {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch (e) {
    return false;
  }
}

const recordSig = (r) => `${r.ts}|${r.type}|${r.mode || ""}|${r.score ?? ""}|${r.total ?? ""}`;

async function restoreResults(results) {
  let written = 0, skipped = 0;
  for (const [deckId, records] of Object.entries(results || {})) {
    let existingSigs;
    try {
      existingSigs = new Set((await loadResults(deckId)).map(recordSig));
    } catch (e) {
      existingSigs = new Set();
    }
    for (const r of records || []) {
      if (!r || typeof r !== "object") continue;
      if (existingSigs.has(recordSig(r))) { skipped++; continue; }
      try {
        await addDoc(collection(db, "results"), { ...r, deckId });
        existingSigs.add(recordSig(r));
        written++;
      } catch (e) { /* skip failed writes */ }
    }
  }
  return { written, skipped };
}

/* ---------- tiny UI atoms ---------- */

const T = {
  paper: "#FAF8F2",
  ink: "#1F2A44",
  inkSoft: "#5B6478",
  line: "#E4DFD3",
  blue: "#3454D1",
  blueSoft: "#EBEFFB",
  pom: "#C64B4B",
  pomSoft: "#F9ECEC",
  olive: "#4C8055",
  oliveSoft: "#ECF3ED",
  card: "#FFFFFF",
};

const heFont = "'Frank Ruhl Libre', 'David Libre', 'SBL Hebrew', 'Arial Hebrew', 'Times New Roman', serif";
const uiFont = "'Rubik', -apple-system, 'Segoe UI', 'Arial Hebrew', sans-serif";

/* shuk palette — one color identity per class, decks inherit it */
const SHUK = [
  { main: "#3454D1", dark: "#22378C", soft: "#EBEFFB" }, // tekhelet
  { main: "#C43D2F", dark: "#7A2318", soft: "#F9E9E6" }, // pomegranate
  { main: "#1D8A7A", dark: "#0E5248", soft: "#E4F2F0" }, // teal
  { main: "#E08A1E", dark: "#8A5208", soft: "#FBF0DD" }, // jaffa orange
  { main: "#6B8F3D", dark: "#3F5822", soft: "#EEF3E5" }, // olive
  { main: "#B0821F", dark: "#6B4E0F", soft: "#F8F0DA" }, // mustard
];
const shukFor = (i) => SHUK[((i % SHUK.length) + SHUK.length) % SHUK.length];

const HEB_ORDER = "אבגדהוזחטיכלמנסעפצקרשת";
const firstHebrewChar = (str) => {
  for (const ch of str || "") if (ch >= "\u05D0" && ch <= "\u05EA") return ch;
  return null;
};
const deckLetter = (dk) => firstHebrewChar(dk.name) || firstHebrewChar(dk.cards?.[0]?.he) || "א";

function Btn({ children, kind = "ghost", onClick, disabled, style = {}, title }) {
  const kinds = {
    primary: { background: T.blue, color: "#fff", border: `1.5px solid ${T.blue}` },
    ghost: { background: "transparent", color: T.ink, border: `1.5px solid ${T.line}` },
    danger: { background: "transparent", color: T.pom, border: `1.5px solid ${T.pomSoft}` },
    pom: { background: T.pomSoft, color: T.pom, border: `1.5px solid #EAC9C9` },
    olive: { background: T.oliveSoft, color: T.olive, border: `1.5px solid #C9DCCB` },
  };
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: uiFont,
        fontSize: 14,
        fontWeight: 500,
        padding: "9px 16px",
        borderRadius: 10,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transition: "transform 0.12s ease, box-shadow 0.12s ease",
        ...kinds[kind],
        ...style,
      }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = "scale(0.97)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
    >
      {children}
    </button>
  );
}

function Field({ label, value, onChange, rtl, placeholder, autoFocus }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: T.inkSoft, marginBottom: 5, letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {label}
      </span>
      <input
        autoFocus={autoFocus}
        dir={rtl ? "rtl" : "ltr"}
        lang={rtl ? "he" : "en"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          boxSizing: "border-box",
          fontFamily: rtl ? heFont : uiFont,
          fontSize: rtl ? 20 : 15,
          padding: "10px 12px",
          border: `1.5px solid ${T.line}`,
          borderRadius: 10,
          background: "#fff",
          color: T.ink,
          outline: "none",
        }}
        onFocus={(e) => (e.target.style.borderColor = T.blue)}
        onBlur={(e) => (e.target.style.borderColor = T.line)}
      />
    </label>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(31,42,68,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.paper, borderRadius: 16, padding: 24, width: "100%", maxWidth: 420,
          boxShadow: "0 24px 60px rgba(31,42,68,0.25)", border: `1px solid ${T.line}`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: T.ink }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: T.inkSoft }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- thread accent (signature) ---------- */

function Thread({ width = 64, colors }) {
  const cols = colors && colors.length ? colors : [T.blue];
  const segs = Math.floor(width / 8);
  return (
    <svg width={width} height="8" viewBox={`0 0 ${width} 8`} aria-hidden="true" style={{ display: "block" }}>
      {Array.from({ length: segs }, (_, i) => (
        <path
          key={i}
          d={`M${i * 8} 4 Q ${i * 8 + 4} ${i % 2 ? 0 : 8} ${i * 8 + 8} 4`}
          fill="none"
          stroke={cols[i % cols.length]}
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.85"
        />
      ))}
    </svg>
  );
}

/* falling aleph-bet celebration — skipped entirely under reduced motion */
function LetterConfetti({ count = 26 }) {
  const reduce =
    typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        ch: HEB_ORDER[Math.floor(Math.random() * HEB_ORDER.length)],
        left: Math.random() * 100,
        delay: Math.random() * 0.9,
        dur: 2.4 + Math.random() * 1.8,
        size: 16 + Math.random() * 20,
        color: SHUK[Math.floor(Math.random() * SHUK.length)].main,
      })),
    []
  );
  if (reduce) return null;
  return (
    <div aria-hidden="true" style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 40 }}>
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            top: "-6vh",
            left: `${p.left}%`,
            fontFamily: heFont,
            fontSize: p.size,
            color: p.color,
            opacity: 0,
            animation: `otiyot-fall ${p.dur}s ease-in ${p.delay}s forwards`,
          }}
        >
          {p.ch}
        </span>
      ))}
    </div>
  );
}

/* ---------- main app ---------- */

export default function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState({ page: "classes" }); // {page, classId?, deckId?}
  const [teacher, setTeacher] = useState(false);
  const [modal, setModal] = useState(null); // {type, ...}
  const [session, setSession] = useState(null);
  const [saving, setSaving] = useState(false);
  const [shuffle, setShuffle] = useState(true);
  const speech = useHebrewVoice();
  const reduceMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  useEffect(() => {
    loadData().then(setData).catch(() => setLoadError(true));
  }, []);

  // teacher mode = signed in to Firebase Auth (survives page reloads)
  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (u) => setTeacher(!!u));
  }, []);

  const update = async (fn) => {
    const next = fn(structuredClone(data));
    setData(next);
    setSaving(true);
    const ok = await persist(next);
    setSaving(false);
    if (!ok) window.alert("Saving failed — check that you're signed in as the teacher and online, then redo that edit.");
  };

  const cls = data && view.classId ? data.classes.find((c) => c.id === view.classId) : null;
  const deck = cls && view.deckId ? cls.decks.find((d) => d.id === view.deckId) : null;
  const clsColor = data && cls ? shukFor(data.classes.findIndex((c) => c.id === cls.id)) : SHUK[0];

  /* ---------- teacher sign-in ---------- */

  const openTeacher = () => setModal({ type: "login" });

  /* ---------- study session ---------- */

  const startSession = (deckObj, shuffle, mode = "study") => {
    let queue = deckObj.cards.map((c) => c.id);
    if (shuffle) {
      queue = [...queue];
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
    }
    setSession({
      id: uid(),
      mode,
      deckId: deckObj.id,
      classId: view.classId,
      queue,
      flipped: false,
      showTr: false,
      known: 0,
      total: deckObj.cards.length,
      stillLearningIds: new Set(),
      everStruggledIds: new Set(),
      reviews: 0,
    });
    setView({ page: "study", classId: view.classId, deckId: deckObj.id, mode });
  };

  const answer = (knowsIt) => {
    setSession((s) => {
      const [current, ...rest] = s.queue;
      let queue;
      const still = new Set(s.stillLearningIds);
      const ever = new Set(s.everStruggledIds);
      if (knowsIt) {
        queue = rest;
        still.delete(current);
      } else {
        still.add(current);
        ever.add(current);
        const insertAt = Math.min(rest.length, 2 + Math.floor(Math.random() * 2)); // resurface 2–3 cards later
        queue = [...rest.slice(0, insertAt), current, ...rest.slice(insertAt)];
      }
      return {
        ...s,
        queue,
        flipped: false,
        known: knowsIt ? s.known + 1 : s.known,
        stillLearningIds: still,
        everStruggledIds: ever,
        reviews: s.reviews + 1,
      };
    });
  };

  /* ---------- render ---------- */

  if (loadError)
    return (
      <Shell>
        <p style={{ color: T.ink }}>Couldn't load saved cards. Refresh the page to try again.</p>
      </Shell>
    );
  if (!data)
    return (
      <Shell>
        <p style={{ color: T.inkSoft, fontFamily: uiFont }}>Loading cards…</p>
      </Shell>
    );

  return (
    <Shell
      header={
        <Header
          view={view}
          cls={cls}
          deck={deck}
          teacher={teacher}
          saving={saving}
          onHome={() => { setSession(null); setView({ page: "classes" }); }}
          onClass={() => { setSession(null); setView({ page: "decks", classId: view.classId }); }}
          onDeck={() => { setSession(null); setView({ page: "deck", classId: view.classId, deckId: view.deckId }); }}
          onTeacherToggle={() => {
            if (teacher) {
              signOut(auth);
              if (view.page === "report") setView({ page: "deck", classId: view.classId, deckId: view.deckId });
            } else openTeacher();
          }}
        />
      }
    >
      {view.page === "classes" && (
        <ClassesPage data={data} teacher={teacher} setView={setView} setModal={setModal} />
      )}
      {view.page === "decks" && cls && (
        <DecksPage cls={cls} color={clsColor} teacher={teacher} setView={setView} setModal={setModal} />
      )}
      {view.page === "deck" && deck && (
        <DeckPage deck={deck} color={clsColor} teacher={teacher} setModal={setModal} startSession={startSession} speech={speech} />
      )}
      {view.page === "study" && session && deck && (
        <StudyPage
          deck={deck}
          accent={clsColor}
          speech={speech}
          session={session}
          setSession={setSession}
          answer={answer}
          reduceMotion={reduceMotion}
          onExit={() => { setSession(null); setView({ page: "deck", classId: view.classId, deckId: view.deckId }); }}
          onRestart={(shuffle) => startSession(deck, shuffle, session.mode)}
        />
      )}
      {view.page === "quiz" && deck && (
        <QuizPage
          key={`${deck.id}-${view.mode}`}
          deck={deck}
          accent={clsColor}
          mode={view.mode}
          speech={speech}
          onExit={() => setView({ page: "deck", classId: view.classId, deckId: view.deckId })}
        />
      )}
      {view.page === "report" && deck && teacher && (
        <ReportPage
          key={deck.id}
          deck={deck}
          onExit={() => setView({ page: "deck", classId: view.classId, deckId: view.deckId })}
        />
      )}
      {view.page === "chat" && deck && (
        <ChatPage
          key={deck.id}
          deck={deck}
          accent={clsColor}
          speech={speech}
          onExit={() => setView({ page: "deck", classId: view.classId, deckId: view.deckId })}
        />
      )}

      {/* -------- modals -------- */}
      {modal?.type === "login" && (
        <LoginModal onClose={() => setModal(null)} onSuccess={() => setModal(null)} />
      )}
      {modal?.type === "editClass" && (
        <NameModal
          title={modal.cls ? "Rename class" : "New class"}
          initial={modal.cls?.name || ""}
          placeholder="e.g. 5th Grade Period 2"
          onClose={() => setModal(null)}
          onSave={(name) => {
            update((d) => {
              if (modal.cls) d.classes.find((c) => c.id === modal.cls.id).name = name;
              else d.classes.push({ id: uid(), name, decks: [] });
              return d;
            });
            setModal(null);
          }}
        />
      )}
      {modal?.type === "editDeck" && (
        <NameModal
          title={modal.deck ? "Rename deck" : "New deck"}
          initial={modal.deck?.name || ""}
          placeholder="e.g. Unit 4 Food Words"
          onClose={() => setModal(null)}
          onSave={(name) => {
            update((d) => {
              const c = d.classes.find((c) => c.id === view.classId);
              if (modal.deck) c.decks.find((x) => x.id === modal.deck.id).name = name;
              else c.decks.push({ id: uid(), name, cards: [] });
              return d;
            });
            setModal(null);
          }}
        />
      )}
      {modal?.type === "editCard" && (
        <CardModal
          card={modal.card}
          onClose={() => setModal(null)}
          onSave={(vals) => {
            update((d) => {
              const dk = d.classes.find((c) => c.id === view.classId).decks.find((x) => x.id === view.deckId);
              if (modal.card) Object.assign(dk.cards.find((c) => c.id === modal.card.id), vals);
              else dk.cards.push({ id: uid(), ...vals });
              return d;
            });
            setModal(null);
          }}
        />
      )}
      {modal?.type === "bulkAdd" && (
        <BulkAddModal
          onClose={() => setModal(null)}
          onSave={(cards) => {
            update((d) => {
              const dk = d.classes.find((c) => c.id === view.classId).decks.find((x) => x.id === view.deckId);
              dk.cards.push(...cards.map((c) => ({ id: uid(), ...c })));
              return d;
            });
            setModal(null);
          }}
        />
      )}
      {modal?.type === "blooket" && deck && (
        <BlooketModal deck={deck} onClose={() => setModal(null)} />
      )}
      {modal?.type === "deckAction" && (
        <DeckActionModal
          mode={modal.mode}
          deck={modal.deck}
          classes={data.classes}
          currentClassId={view.classId}
          onClose={() => setModal(null)}
          onConfirm={(targetClassId, newName) => {
            update((d) => {
              const from = d.classes.find((c) => c.id === view.classId);
              const to = d.classes.find((c) => c.id === targetClassId);
              if (!from || !to) return d;
              if (modal.mode === "move") {
                const i = from.decks.findIndex((x) => x.id === modal.deck.id);
                if (i === -1) return d;
                const [moved] = from.decks.splice(i, 1);
                to.decks.push(moved);
              } else {
                const src = from.decks.find((x) => x.id === modal.deck.id);
                if (!src) return d;
                to.decks.push({
                  id: uid(),
                  name: newName,
                  cards: src.cards.map((c) => ({ ...c, id: uid() })),
                });
              }
              return d;
            });
            setModal(null);
          }}
        />
      )}
      {modal?.type === "confirm" && (
        <Modal title={modal.title} onClose={() => setModal(null)}>
          <p style={{ color: T.inkSoft, fontSize: 14, marginTop: 0 }}>{modal.body}</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn onClick={() => setModal(null)}>Cancel</Btn>
            <Btn kind="pom" onClick={() => { modal.onConfirm(); setModal(null); }}>Delete</Btn>
          </div>
        </Modal>
      )}
      {modal?.type === "backup" && (
        <BackupModal
          mode={modal.mode}
          data={data}
          onApplyClasses={(classes) => update((d) => { d.classes = classes; return d; })}
          onClose={() => setModal(null)}
        />
      )}
    </Shell>
  );

  /* -------- pages that need `update` in scope -------- */

  function ClassesPage({ data, teacher, setView, setModal }) {
    return (
      <div>
        <PageIntro
          eyebrow="Classes"
          title="Pick your class"
          sub={teacher ? "You're in teacher mode — tap ✎ to rename, or add a new class below." : "Tap your class to find your flashcards."}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
          {data.classes.map((c, i) => (
            <FolderCard
              key={c.id}
              title={c.name}
              meta={`${c.decks.length} deck${c.decks.length === 1 ? "" : "s"}`}
              color={shukFor(i)}
              badge={HEB_ORDER[i % HEB_ORDER.length]}
              onOpen={() => setView({ page: "decks", classId: c.id })}
              teacher={teacher}
              onEdit={() => setModal({ type: "editClass", cls: c })}
              onDelete={() =>
                setModal({
                  type: "confirm",
                  title: `Delete "${c.name}"?`,
                  body: "This removes the class and every deck inside it. There's no undo.",
                  onConfirm: () => update((d) => { d.classes = d.classes.filter((x) => x.id !== c.id); return d; }),
                })
              }
            />
          ))}
          {teacher && <AddTile label="Add a class" onClick={() => setModal({ type: "editClass" })} />}
        </div>
        {data.classes.length === 0 && !teacher && (
          <p style={{ color: T.inkSoft, fontFamily: uiFont }}>No classes yet — ask your teacher to add some.</p>
        )}
        {teacher && (
          <div style={{ marginTop: 32, paddingTop: 18, borderTop: `1.5px solid ${T.line}`, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontFamily: uiFont }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: T.inkSoft }}>Backup</span>
            <Btn onClick={() => setModal({ type: "backup", mode: "export" })}>⬇️ Export backup</Btn>
            <Btn onClick={() => setModal({ type: "backup", mode: "import" })}>⬆️ Import backup</Btn>
            <span style={{ fontSize: 12.5, color: T.inkSoft }}>Everything — decks, cards, and reports — in one file. Export after big edits.</span>
          </div>
        )}
      </div>
    );
  }

  function DecksPage({ cls, color, teacher, setView, setModal }) {
    return (
      <div>
        <PageIntro eyebrow={cls.name} color={color.main} title="Choose a deck" sub={teacher ? "Tap ✎ to rename a deck, or add a new one." : "Each deck is one set of words to practice."} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
          {cls.decks.map((dk) => (
            <FolderCard
              key={dk.id}
              title={dk.name}
              meta={`${dk.cards.length} card${dk.cards.length === 1 ? "" : "s"}`}
              color={color}
              letter={deckLetter(dk)}
              onOpen={() => setView({ page: "deck", classId: cls.id, deckId: dk.id })}
              teacher={teacher}
              onEdit={() => setModal({ type: "editDeck", deck: dk })}
              onDuplicate={() => setModal({ type: "deckAction", mode: "copy", deck: dk })}
              onMove={() => setModal({ type: "deckAction", mode: "move", deck: dk })}
              onDelete={() =>
                setModal({
                  type: "confirm",
                  title: `Delete "${dk.name}"?`,
                  body: "This removes the deck and all of its cards. There's no undo.",
                  onConfirm: () =>
                    update((d) => {
                      const c = d.classes.find((x) => x.id === cls.id);
                      c.decks = c.decks.filter((x) => x.id !== dk.id);
                      return d;
                    }),
                })
              }
            />
          ))}
          {teacher && <AddTile label="Add a deck" onClick={() => setModal({ type: "editDeck" })} />}
        </div>
      </div>
    );
  }

  function DeckPage({ deck, color, teacher, setModal, startSession, speech }) {
    return (
      <div>
        <PageIntro eyebrow="Deck" color={color.main} title={deck.name} sub={`${deck.cards.length} card${deck.cards.length === 1 ? "" : "s"}`} />
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 28 }}>
          <Btn
            kind="primary"
            disabled={deck.cards.length === 0}
            onClick={() => startSession(deck, shuffle)}
            style={{ fontSize: 15, padding: "11px 22px", background: color.main, borderColor: color.main }}
          >
            Start studying
          </Btn>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: uiFont, fontSize: 14, color: T.ink, cursor: "pointer", userSelect: "none" }}>
            <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} style={{ width: 16, height: 16, accentColor: T.blue }} />
            Shuffle cards
          </label>
          {teacher && (
            <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <Btn onClick={() => setView({ page: "report", classId: view.classId, deckId: deck.id })}>📊 Report</Btn>
              <Btn onClick={() => setModal({ type: "blooket" })} disabled={deck.cards.length < 2} title={deck.cards.length < 2 ? "Needs at least 2 cards" : "Export this deck for Blooket"}>⬇️ Blooket</Btn>
              <Btn onClick={() => setModal({ type: "bulkAdd" })}>📋 Bulk add</Btn>
              <Btn onClick={() => setModal({ type: "editCard" })}>+ Add card</Btn>
            </span>
          )}
        </div>

        {/* exercises */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontFamily: uiFont, fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: T.inkSoft, marginBottom: 8 }}>
            Exercises
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Btn
              disabled={deck.cards.length < 2}
              onClick={() => setView({ page: "quiz", classId: view.classId, deckId: deck.id, mode: "read" })}
            >
              📖 Reading quiz
            </Btn>
            <Btn
              disabled={deck.cards.length < 2 || !speech.supported || !speech.voice}
              onClick={() => setView({ page: "quiz", classId: view.classId, deckId: deck.id, mode: "listen" })}
              title={!speech.voice ? "This device has no Hebrew voice installed" : undefined}
            >
              🎧 Listening quiz
            </Btn>
            <Btn
              disabled={deck.cards.length === 0}
              onClick={() => startSession(deck, shuffle, "speak")}
            >
              🗣️ Speaking practice
            </Btn>
            <Btn
              disabled={deck.cards.length === 0}
              onClick={() => setView({ page: "chat", classId: view.classId, deckId: deck.id })}
            >
              💬 Chat practice
            </Btn>
            {deck.cards.length < 2 && (
              <span style={{ fontFamily: uiFont, fontSize: 12.5, color: T.inkSoft }}>Quizzes need at least 2 cards.</span>
            )}
            {deck.cards.length >= 2 && speech.checked && speech.supported && !speech.voice && (
              <span style={{ fontFamily: uiFont, fontSize: 12.5, color: T.inkSoft }}>Listening quiz is off — no Hebrew voice on this device.</span>
            )}
          </div>
        </div>

        {deck.cards.length === 0 ? (
          <p style={{ color: T.inkSoft, fontFamily: uiFont }}>
            {teacher ? "This deck is empty. Add your first card to get started." : "This deck is empty — check back soon."}
          </p>
        ) : (
          <div style={{ border: `1.5px solid ${T.line}`, borderRadius: 14, overflow: "hidden", background: T.card }}>
            {deck.cards.map((c, i) => (
              <div
                key={c.id}
                style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
                  borderTop: i === 0 ? "none" : `1px solid ${T.line}`,
                }}
              >
                {speech.supported && speech.voice && <SpeakerBtn text={c.he} voice={speech.voice} size={30} />}
                <span dir="rtl" lang="he" style={{ fontFamily: heFont, fontSize: 24, color: T.ink, minWidth: 110, textAlign: "right" }}>
                  {c.he}
                </span>
                <span style={{ fontFamily: uiFont, fontSize: 13, color: T.inkSoft, fontStyle: "italic", minWidth: 90 }}>{c.tr}</span>
                <span style={{ fontFamily: uiFont, fontSize: 15, color: T.ink, flex: 1 }}>{c.en}</span>
                {c.img && (
                  <img
                    src={c.img}
                    alt=""
                    style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 8, border: `1px solid ${T.line}` }}
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                )}
                {teacher && (
                  <span style={{ display: "flex", gap: 6 }}>
                    <IconBtn label="Edit card" onClick={() => setModal({ type: "editCard", card: c })}>✎</IconBtn>
                    <IconBtn
                      label="Delete card"
                      danger
                      onClick={() =>
                        setModal({
                          type: "confirm",
                          title: "Delete this card?",
                          body: `"${c.he} — ${c.en}" will be removed. There's no undo.`,
                          onConfirm: () =>
                            update((d) => {
                              const dk = d.classes.find((x) => x.id === view.classId).decks.find((x) => x.id === deck.id);
                              dk.cards = dk.cards.filter((x) => x.id !== c.id);
                              return d;
                            }),
                        })
                      }
                    >
                      🗑
                    </IconBtn>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
}

/* ---------- study page ---------- */

function StudyPage({ deck, accent = SHUK[0], speech, session, setSession, answer, reduceMotion, onExit, onRestart }) {
  const done = session.queue.length === 0;
  const current = done ? null : deck.cards.find((c) => c.id === session.queue[0]);
  const progress = session.total === 0 ? 1 : session.known / session.total;
  const speak = session.mode === "speak";
  const loggedSessionRef = useRef(null);

  // in speaking practice, say the word when the card is flipped to reveal the Hebrew
  useEffect(() => {
    if (speak && session.flipped && current && speech.voice) speakHebrew(current.he, speech.voice);
  }, [speak, session.flipped, current?.id]);

  // log the completed session (anonymous — just which words were tricky)
  useEffect(() => {
    if (done && session.total > 0 && loggedSessionRef.current !== session.id) {
      loggedSessionRef.current = session.id;
      logResult(deck.id, {
        type: speak ? "speak" : "study",
        total: session.total,
        reviews: session.reviews,
        words: deck.cards.map((c) => ({ cardId: c.id, struggled: session.everStruggledIds.has(c.id) })),
      });
    }
  }, [done, session.id]);

  // keyboard: space = flip, 1 = still learning, 2 = got it
  useEffect(() => {
    const h = (e) => {
      if (done) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); setSession((s) => ({ ...s, flipped: !s.flipped })); }
      if (e.key === "1" && session.flipped) answer(false);
      if (e.key === "2" && session.flipped) answer(true);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [done, session.flipped]);

  if (done) {
    return (
      <div style={{ maxWidth: 460, margin: "40px auto", textAlign: "center", fontFamily: uiFont }}>
        <LetterConfetti />
        <div style={{ fontSize: 44, marginBottom: 8, animation: "otiyot-pop 0.5s ease" }}>🎉</div>
        <h2 style={{ color: T.ink, fontSize: 24, margin: "0 0 6px" }}>
          <span dir="rtl" lang="he" style={{ fontFamily: heFont }}>כָּל הַכָּבוֹד!</span>{" "}
          <span style={{ fontWeight: 400, color: T.inkSoft, fontSize: 16 }}>(Kol hakavod — well done!)</span>
        </h2>
        <p style={{ color: T.inkSoft, fontSize: 15 }}>
          You got through all {session.total} cards in {session.reviews} looks
          {session.reviews > session.total ? " — the tricky ones came back until you knew them." : "."}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
          <Btn kind="primary" onClick={() => onRestart(true)}>Study again (shuffled)</Btn>
          <Btn onClick={onExit}>Back to deck</Btn>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      {/* progress */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, fontFamily: uiFont }}>
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: T.line, overflow: "hidden" }}>
          <div style={{ width: `${progress * 100}%`, height: "100%", background: T.olive, transition: reduceMotion ? "none" : "width 0.4s ease" }} />
        </div>
        <span style={{ fontSize: 13, color: T.inkSoft, whiteSpace: "nowrap" }}>
          {session.known} / {session.total} known
        </span>
      </div>

      {/* card */}
      <div
        onClick={() => setSession((s) => ({ ...s, flipped: !s.flipped }))}
        role="button"
        aria-label={session.flipped ? "Card back — tap to see Hebrew" : "Card front — tap to see English"}
        style={{ perspective: 1400, cursor: "pointer", outline: "none" }}
        tabIndex={0}
      >
        <div
          style={{
            position: "relative",
            height: 300,
            transformStyle: "preserve-3d",
            transition: reduceMotion ? "none" : "transform 0.6s cubic-bezier(0.34, 1.45, 0.5, 1)",
            transform: session.flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          }}
        >
          {/* front — Hebrew (study) or English prompt (speaking practice) */}
          <CardFace color={accent.main}>
            {speak ? (
              <>
                {current.img && (
                  <img
                    src={current.img}
                    alt=""
                    style={{ maxHeight: 90, maxWidth: "60%", objectFit: "contain", borderRadius: 12, marginBottom: 10 }}
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                )}
                <span style={{ fontFamily: uiFont, fontSize: "clamp(26px, 7vw, 38px)", fontWeight: 500, color: T.ink }}>
                  {current.en}
                </span>
                <span style={{ fontFamily: uiFont, fontSize: 14, color: T.inkSoft, marginTop: 10 }}>
                  Say it in Hebrew out loud 🗣️ — then flip to check.
                </span>
              </>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 14, maxWidth: "100%" }}>
                  <span dir="rtl" lang="he" style={{ fontFamily: heFont, fontSize: "clamp(34px, 9vw, 56px)", color: T.ink, lineHeight: 1.4, overflowWrap: "break-word", minWidth: 0 }}>
                    {current.he}
                  </span>
                  {speech.supported && speech.voice && <SpeakerBtn text={current.he} voice={speech.voice} />}
                </div>
                {session.showTr && current.tr && (
                  <span style={{ fontFamily: uiFont, fontSize: 17, fontStyle: "italic", color: T.inkSoft, marginTop: 10 }}>
                    {current.tr}
                  </span>
                )}
              </>
            )}
            <span style={{ position: "absolute", bottom: 16, fontFamily: uiFont, fontSize: 12, color: "#B9B2A2", letterSpacing: "0.05em" }}>
              TAP TO FLIP
            </span>
          </CardFace>
          {/* back — English (study) or Hebrew reveal (speaking practice) */}
          <CardFace back color={accent.main}>
            {speak ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 14, maxWidth: "100%" }}>
                  <span dir="rtl" lang="he" style={{ fontFamily: heFont, fontSize: "clamp(34px, 9vw, 52px)", color: T.ink, lineHeight: 1.4, overflowWrap: "break-word", minWidth: 0 }}>
                    {current.he}
                  </span>
                  {speech.supported && speech.voice && <SpeakerBtn text={current.he} voice={speech.voice} />}
                </div>
                {session.showTr && current.tr && (
                  <span style={{ fontFamily: uiFont, fontSize: 17, fontStyle: "italic", color: T.inkSoft, marginTop: 8 }}>
                    {current.tr}
                  </span>
                )}
                <span style={{ fontFamily: uiFont, fontSize: 16, color: T.inkSoft, marginTop: 8 }}>{current.en}</span>
              </>
            ) : (
              <>
                {current.img && (
                  <img
                    src={current.img}
                    alt={current.en}
                    style={{ maxHeight: 110, maxWidth: "70%", objectFit: "contain", borderRadius: 12, marginBottom: 12 }}
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                )}
                <span style={{ fontFamily: uiFont, fontSize: current.img ? 26 : 34, fontWeight: 500, color: T.ink }}>{current.en}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                  <span dir="rtl" lang="he" style={{ fontFamily: heFont, fontSize: 22, color: T.inkSoft }}>
                    {current.he}
                  </span>
                  {speech.supported && speech.voice && <SpeakerBtn text={current.he} voice={speech.voice} size={28} />}
                </div>
              </>
            )}
          </CardFace>
        </div>
      </div>

      {/* transliteration toggle */}
      <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
        <button
          onClick={() => setSession((s) => ({ ...s, showTr: !s.showTr }))}
          style={{
            fontFamily: uiFont, fontSize: 13, color: session.showTr ? T.blue : T.inkSoft,
            background: session.showTr ? T.blueSoft : "transparent",
            border: `1.5px solid ${session.showTr ? "#C6D1F2" : T.line}`,
            borderRadius: 999, padding: "6px 14px", cursor: "pointer",
          }}
        >
          {session.showTr ? "Hide transliteration" : "Show transliteration"}
        </button>
      </div>
      {speech.supported && speech.checked && !speech.voice && (
        <p style={{ textAlign: "center", fontFamily: uiFont, fontSize: 12, color: T.inkSoft, marginTop: 8 }}>
          This device has no Hebrew voice installed, so read-aloud is turned off here.
        </p>
      )}

      {/* answer buttons */}
      <div style={{ display: "flex", gap: 12, marginTop: 22 }}>
        <Btn kind="pom" disabled={!session.flipped} onClick={() => answer(false)} style={{ flex: 1, padding: "14px 0", fontSize: 15 }}>
          {speak ? "Need practice ↻" : "Still learning ↻"}
        </Btn>
        <Btn kind="olive" disabled={!session.flipped} onClick={() => answer(true)} style={{ flex: 1, padding: "14px 0", fontSize: 15 }}>
          {speak ? "Said it right ✓" : "Know it ✓"}
        </Btn>
      </div>
      {!session.flipped && (
        <p style={{ textAlign: "center", fontFamily: uiFont, fontSize: 12.5, color: T.inkSoft, marginTop: 10 }}>
          {speak
            ? "Say the word out loud first, then flip to see and hear it. Words that need practice will come back around."
            : "Flip the card first, then say how it went. Cards you're still learning will come back around."}
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "center", marginTop: 22 }}>
        <button onClick={onExit} style={{ border: "none", background: "none", fontFamily: uiFont, fontSize: 13, color: T.inkSoft, cursor: "pointer", textDecoration: "underline" }}>
          End session
        </button>
      </div>
    </div>
  );
}

/* ---------- quiz page (reading + listening exercises) ---------- */

function QuizPage({ deck, accent = SHUK[0], mode, speech, onExit }) {
  const [questions, setQuestions] = useState(() => buildQuestions(deck));
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null); // chosen option string
  const [score, setScore] = useState(0);
  const [missed, setMissed] = useState([]);
  const [streak, setStreak] = useState(0);
  const [wordResults, setWordResults] = useState([]);
  const loggedRef = useRef(false);

  const done = index >= questions.length;
  const q = done ? null : questions[index];
  const answered = selected !== null;

  // log completed quiz once (anonymous)
  useEffect(() => {
    if (done && !loggedRef.current && wordResults.length > 0) {
      loggedRef.current = true;
      logResult(deck.id, { type: "quiz", mode, total: questions.length, score, words: wordResults });
    }
  }, [done]);

  // auto-play the word in listening mode
  useEffect(() => {
    if (mode === "listen" && q) speakHebrew(q.card.he, speech.voice);
  }, [index]); // eslint-disable-line

  // keyboard: 1–4 to answer, Enter for next
  useEffect(() => {
    const h = (e) => {
      if (done || !q) return;
      const n = parseInt(e.key, 10);
      if (!answered && n >= 1 && n <= q.options.length) pick(q.options[n - 1]);
      if (answered && e.key === "Enter") next();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [done, answered, index]);

  const pick = (opt) => {
    if (answered) return;
    setSelected(opt);
    const right = opt === q.card.en;
    setWordResults((w) => [...w, { cardId: q.card.id, right }]);
    setStreak((s) => (right ? s + 1 : 0));
    if (right) setScore((s) => s + 1);
    else setMissed((m) => [...m, q.card]);
  };

  const next = () => { setSelected(null); setIndex((i) => i + 1); };

  if (done) {
    const perfect = missed.length === 0;
    const ratio = questions.length ? score / questions.length : 0;
    const stars = ratio === 1 ? 3 : ratio >= 0.8 ? 2 : 1;
    const tier =
      ratio === 1
        ? { emoji: "🌟", head: "Metzuyan — excellent!", sub: "A perfect round." }
        : ratio >= 0.8
        ? { emoji: "🎉", head: "Kol hakavod!", sub: "Almost perfect. Here's what slipped:" }
        : ratio >= 0.6
        ? { emoji: "💪", head: "Getting there!", sub: "Here are the words to look at again:" }
        : { emoji: "🌱", head: "Good practice.", sub: "These words just need more time:" };
    return (
      <div style={{ maxWidth: 480, margin: "40px auto", textAlign: "center", fontFamily: uiFont }}>
        {perfect && <LetterConfetti />}
        <div style={{ fontSize: 44, marginBottom: 4, animation: "otiyot-pop 0.5s ease" }}>{tier.emoji}</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 8 }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                fontSize: 26,
                color: i < stars ? "#D4A519" : T.line,
                animation: i < stars ? `otiyot-pop 0.45s ${0.15 + i * 0.15}s ease backwards` : "none",
              }}
            >
              ★
            </span>
          ))}
        </div>
        <h2 style={{ color: T.ink, fontSize: 24, margin: "0 0 6px" }}>
          {score} / {questions.length} · {tier.head}
        </h2>
        <p style={{ color: T.inkSoft, fontSize: 15 }}>{tier.sub}</p>
        {!perfect && (
          <div style={{ border: `1.5px solid ${T.line}`, borderRadius: 14, background: T.card, textAlign: "left", margin: "16px 0" }}>
            {missed.map((c, i) => (
              <div key={c.id + i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: i === 0 ? "none" : `1px solid ${T.line}` }}>
                {speech.supported && speech.voice && <SpeakerBtn text={c.he} voice={speech.voice} size={28} />}
                <span dir="rtl" lang="he" style={{ fontFamily: heFont, fontSize: 22, color: T.ink }}>{c.he}</span>
                <span style={{ fontSize: 14, color: T.inkSoft, flex: 1, textAlign: "right" }}>{c.en}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
          <Btn kind="primary" style={{ background: accent.main, borderColor: accent.main }} onClick={() => { setQuestions(buildQuestions(deck)); setIndex(0); setScore(0); setMissed([]); setSelected(null); setWordResults([]); setStreak(0); loggedRef.current = false; }}>
            Try again
          </Btn>
          <Btn onClick={onExit}>Back to deck</Btn>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", fontFamily: uiFont }}>
      {/* progress */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: T.line, overflow: "hidden" }}>
          <div style={{ width: `${(index / questions.length) * 100}%`, height: "100%", background: accent.main, transition: "width 0.3s ease" }} />
        </div>
        {streak >= 3 && (
          <span style={{ fontSize: 12, fontWeight: 600, color: "#C64B4B", background: T.pomSoft, borderRadius: 999, padding: "4px 10px", whiteSpace: "nowrap", animation: "otiyot-pop 0.35s ease" }}>
            🔥 {streak} in a row
          </span>
        )}
        <span style={{ fontSize: 13, color: T.inkSoft, whiteSpace: "nowrap" }}>
          {index + 1} of {questions.length} · {score} right
        </span>
      </div>

      {/* prompt */}
      <div style={{ background: T.card, border: `1.5px solid ${T.line}`, borderRadius: 20, padding: "36px 24px", textAlign: "center", boxShadow: "0 10px 30px rgba(31,42,68,0.06)", position: "relative" }}>
        <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)" }}>
          <Thread width={56} colors={[accent.main]} />
        </div>
        {mode === "read" ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
            <span dir="rtl" lang="he" style={{ fontFamily: heFont, fontSize: "clamp(32px, 8vw, 48px)", color: T.ink, lineHeight: 1.4, overflowWrap: "break-word", minWidth: 0 }}>
              {q.card.he}
            </span>
            {speech.supported && speech.voice && <SpeakerBtn text={q.card.he} voice={speech.voice} />}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <button
              onClick={() => speakHebrew(q.card.he, speech.voice)}
              aria-label="Play the word again"
              style={{
                width: 76, height: 76, borderRadius: "50%", border: `2px solid ${T.blue}`,
                background: T.blueSoft, color: T.blue, fontSize: 30, cursor: "pointer",
              }}
            >
              🔊
            </button>
            <span style={{ fontSize: 13, color: T.inkSoft }}>Listen, then choose the meaning. Tap to hear it again.</span>
            {answered && (
              <span dir="rtl" lang="he" style={{ fontFamily: heFont, fontSize: 30, color: T.ink, marginTop: 4 }}>
                {q.card.he}
              </span>
            )}
          </div>
        )}
      </div>

      {/* options */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginTop: 18 }}>
        {q.options.map((opt, i) => {
          const isCorrect = opt === q.card.en;
          let bg = "#fff", border = T.line, color = T.ink;
          if (answered && isCorrect) { bg = T.oliveSoft; border = T.olive; color = T.olive; }
          else if (answered && opt === selected && !isCorrect) { bg = T.pomSoft; border = T.pom; color = T.pom; }
          else if (answered) { color = T.inkSoft; }
          return (
            <button
              key={opt + i}
              onClick={() => pick(opt)}
              disabled={answered}
              style={{
                fontFamily: uiFont, fontSize: 16, fontWeight: 500, padding: "16px 14px",
                borderRadius: 14, border: `2px solid ${border}`, background: bg, color,
                cursor: answered ? "default" : "pointer", textAlign: "center",
                transition: "border-color 0.15s ease, background 0.15s ease",
              }}
            >
              <span style={{ fontSize: 12, color: T.inkSoft, marginRight: 8 }}>{i + 1}</span>
              {opt}
            </button>
          );
        })}
      </div>

      {/* feedback + next */}
      <div style={{ minHeight: 70, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", marginTop: 16, gap: 10 }}>
        {answered && (
          <>
            <span style={{ fontSize: 15, fontWeight: 500, color: selected === q.card.en ? T.olive : T.pom }}>
              {selected === q.card.en ? "Right! ✓" : `Not quite — it means "${q.card.en}".`}
            </span>
            <Btn kind="primary" onClick={next} style={{ padding: "11px 28px" }}>
              {index + 1 === questions.length ? "See my score" : "Next →"}
            </Btn>
          </>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
        <button onClick={onExit} style={{ border: "none", background: "none", fontSize: 13, color: T.inkSoft, cursor: "pointer", textDecoration: "underline" }}>
          End quiz
        </button>
      </div>
    </div>
  );
}

/* ---------- teacher report (anonymous aggregates) ---------- */

function ReportPage({ deck, onExit }) {
  const [records, setRecords] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    loadResults(deck.id).then(setRecords);
  }, [deck.id]);

  if (records === null) {
    return <p style={{ fontFamily: uiFont, color: T.inkSoft }}>Loading report…</p>;
  }

  const quizzes = records.filter((r) => r.type === "quiz");
  const studies = records.filter((r) => r.type === "study" || r.type === "speak");
  const speakCount = records.filter((r) => r.type === "speak").length;
  const chatCount = records.filter((r) => r.via === "chat").length;

  if (records.length === 0) {
    return (
      <div style={{ fontFamily: uiFont }}>
        <PageIntro eyebrow="Report" title={deck.name} sub="No activity yet." />
        <p style={{ color: T.inkSoft, fontSize: 14.5 }}>
          Results appear here after students finish quizzes or study sessions in this deck. Quizzes left unfinished aren't counted.
        </p>
        <Btn onClick={onExit}>Back to deck</Btn>
      </div>
    );
  }

  // aggregate per card, quiz results split by mode
  const agg = {};
  for (const c of deck.cards) agg[c.id] = { card: c, rSeen: 0, rRight: 0, lSeen: 0, lRight: 0, sSeen: 0, sStruggled: 0 };
  for (const r of quizzes) {
    const listen = r.mode === "listen";
    for (const w of r.words || []) {
      const a = agg[w.cardId];
      if (!a) continue;
      if (listen) { a.lSeen++; if (w.right) a.lRight++; }
      else { a.rSeen++; if (w.right) a.rRight++; }
    }
  }
  for (const r of studies) for (const w of r.words || []) {
    if (agg[w.cardId]) { agg[w.cardId].sSeen++; if (w.struggled) agg[w.cardId].sStruggled++; }
  }

  const MIN_N = 3;
  const rows = Object.values(agg).map((a) => {
    const readAcc = a.rSeen > 0 ? a.rRight / a.rSeen : null;
    const listenAcc = a.lSeen > 0 ? a.lRight / a.lSeen : null;
    const struggleRate = a.sSeen > 0 ? a.sStruggled / a.sSeen : null;
    const qSeen = a.rSeen + a.lSeen;
    const quizAcc = qSeen > 0 ? (a.rRight + a.lRight) / qSeen : null;
    // sort score: quiz accuracy first (objective), study signal only as fallback
    const acc = quizAcc !== null ? quizAcc : struggleRate !== null ? 1 - struggleRate : null;
    return { ...a, readAcc, listenAcc, struggleRate, quizAcc, qSeen, acc };
  });
  rows.sort((x, y) => {
    if (x.acc === null && y.acc === null) return 0;
    if (x.acc === null) return 1;
    if (y.acc === null) return -1;
    return x.acc - y.acc;
  });

  const avgScore = quizzes.length
    ? Math.round((quizzes.reduce((s, r) => s + r.score / (r.total || 1), 0) / quizzes.length) * 100)
    : null;
  const lastTs = Math.max(...records.map((r) => r.ts || 0));

  const band = (acc) => (acc >= 0.8 ? 0 : acc >= 0.6 ? 1 : 2);
  const BANDS = [
    { label: "Solid — use freely", color: T.olive, bg: T.oliveSoft },
    { label: "Wobbly — review", color: "#9A7215", bg: "#F7EFDA" },
    { label: "Reteach", color: T.pom, bg: T.pomSoft },
  ];

  const verdict = (row) => {
    const rOk = row.rSeen >= MIN_N;
    const lOk = row.lSeen >= MIN_N;
    if (rOk || lOk) {
      // both modes have enough data and one is clearly weaker → name it
      if (rOk && lOk && Math.abs(row.readAcc - row.listenAcc) >= 0.2) {
        const weakListen = row.listenAcc < row.readAcc;
        const b = BANDS[band(weakListen ? row.listenAcc : row.readAcc)];
        return { ...b, label: `${b.label.split(" — ")[0]} (${weakListen ? "listening" : "reading"})` };
      }
      const acc = rOk && lOk ? row.quizAcc : rOk ? row.readAcc : row.listenAcc;
      return BANDS[band(acc)];
    }
    if (row.qSeen > 0) return { label: "Needs more data", color: T.inkSoft, bg: "transparent" };
    // no quiz data at all — fall back to the (self-reported) study signal
    if (row.sSeen >= MIN_N) {
      const b = BANDS[band(1 - row.struggleRate)];
      return { ...b, label: `${b.label.split(" — ")[0]} (study only)` };
    }
    return { label: "Needs more data", color: T.inkSoft, bg: "transparent" };
  };

  const pct = (v) => (v === null ? "—" : `${Math.round(v * 100)}%`);

  return (
    <div style={{ fontFamily: uiFont }}>
      <PageIntro eyebrow="Report" title={deck.name} sub="Anonymous totals across all students — no individual tracking." />

      {/* usage summary */}
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginBottom: 24 }}>
        {[
          ["📖 Reading quizzes", quizzes.filter((r) => r.mode !== "listen").length],
          ["🎧 Listening quizzes", quizzes.filter((r) => r.mode === "listen").length],
          ["Average quiz score", avgScore === null ? "—" : `${avgScore}%`],
          ["Study sessions", studies.length - speakCount],
          ["🗣️ Speaking sessions", speakCount],
          ["💬 Done in chat", chatCount],
          ["Last activity", lastTs > 0 ? new Date(lastTs).toLocaleDateString() : "—"],
        ].map(([label, val]) => (
          <div key={label}>
            <div style={{ fontSize: 22, fontWeight: 600, color: T.ink }}>{val}</div>
            <div style={{ fontSize: 12.5, color: T.inkSoft }}>{label}</div>
          </div>
        ))}
      </div>

      {/* word table */}
      <div style={{ border: `1.5px solid ${T.line}`, borderRadius: 14, overflowX: "auto", background: T.card, marginBottom: 20 }}>
        <div style={{ minWidth: 620 }}>
          <div style={{ display: "flex", gap: 12, padding: "10px 16px", fontSize: 11.5, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: T.inkSoft, borderBottom: `1px solid ${T.line}` }}>
            <span style={{ flex: 1 }}>Word · hardest first</span>
            <span style={{ width: 92, textAlign: "right" }}>📖 Reading</span>
            <span style={{ width: 92, textAlign: "right" }}>🎧 Listening</span>
            <span style={{ width: 88, textAlign: "right" }}>Study struggles</span>
            <span style={{ width: 156, textAlign: "right" }}>Verdict</span>
          </div>
          {rows.map((row, i) => {
            const v = verdict(row);
            const quizCell = (acc, right, seen) =>
              seen === 0 ? (
                <span style={{ fontSize: 14, color: "#C9C2B2" }}>—</span>
              ) : (
                <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.25 }}>
                  <span style={{ fontSize: 14, color: T.ink }}>{Math.round(acc * 100)}%</span>
                  <span style={{ fontSize: 11.5, color: T.inkSoft }}>{right}/{seen} right</span>
                </span>
              );
            return (
              <div key={row.card.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderTop: i === 0 ? "none" : `1px solid ${T.line}` }}>
                <span style={{ flex: 1, display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
                  <span dir="rtl" lang="he" style={{ fontFamily: heFont, fontSize: 21, color: T.ink }}>{row.card.he}</span>
                  <span style={{ fontSize: 13, color: T.inkSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.card.en}</span>
                </span>
                <span style={{ width: 92, textAlign: "right" }}>{quizCell(row.readAcc, row.rRight, row.rSeen)}</span>
                <span style={{ width: 92, textAlign: "right" }}>{quizCell(row.listenAcc, row.lRight, row.lSeen)}</span>
                <span style={{ width: 88, textAlign: "right", fontSize: 14, color: row.sSeen === 0 ? "#C9C2B2" : T.inkSoft }} title={row.sSeen === 0 ? "No study sessions yet" : `Marked "still learning" in ${row.sStruggled} of ${row.sSeen} study sessions`}>
                  {pct(row.struggleRate)}
                </span>
                <span style={{ width: 156, textAlign: "right" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: v.color, background: v.bg, borderRadius: 999, padding: "4px 10px", whiteSpace: "nowrap" }}>
                    {v.label}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Btn onClick={onExit}>Back to deck</Btn>
        {!confirmClear ? (
          <Btn kind="danger" onClick={() => setConfirmClear(true)} style={{ marginLeft: "auto" }}>Clear stats…</Btn>
        ) : (
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: T.inkSoft }}>Delete all results for this deck? No undo.</span>
            <Btn onClick={() => setConfirmClear(false)}>Keep</Btn>
            <Btn
              kind="pom"
              disabled={clearing}
              onClick={async () => {
                setClearing(true);
                await clearResults(deck.id);
                setRecords([]);
                setClearing(false);
                setConfirmClear(false);
              }}
            >
              {clearing ? "Clearing…" : "Yes, clear"}
            </Btn>
          </span>
        )}
      </div>
      <p style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 14 }}>
        Verdicts come from quiz answers (a word needs at least 3 answers in a mode to count). When reading and
        listening results differ a lot, the verdict names the weaker skill. "Study struggles" combines flashcard
        study and speaking practice and is self-reported — not every student taps "still learning" — so it only
        drives the verdict when a word has no quiz data, marked "(study only)". Chat practice counts in the numbers
        above like any other session — "Done in chat" shows how many of them happened through the chat screen.
      </p>
    </div>
  );
}

/* ---------- chat practice (messenger-style study + quizzes) ---------- */

function ChatPage({ deck, accent = SHUK[0], speech, onExit }) {
  const [messages, setMessages] = useState([]);
  const [chips, setChips] = useState([]);
  const [typing, setTyping] = useState(false);
  const s = useRef({ phase: "menu" }).current;
  const scrollRef = useRef(null);
  const timers = useRef([]);
  const canQuiz = deck.cards.length >= 2;
  const hasVoice = speech.supported && !!speech.voice;

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, typing, chips]);

  const push = (msg) => setMessages((m) => [...m, { id: uid(), ...msg }]);
  const meSay = (text) => push({ from: "me", kind: "text", text });

  const botSay = (items, thenChips) => {
    setChips([]);
    // typing time scales with message length, like a real person typing — capped so quizzes stay playable
    const typeTime = (it) =>
      it.kind === "text" ? Math.min(2000, Math.max(750, 450 + (it.text?.length || 0) * 32)) : 900;
    let delay = 250;
    items.forEach((it, idx) => {
      const dur = typeTime(it);
      timers.current.push(setTimeout(() => setTyping(true), delay));
      timers.current.push(
        setTimeout(() => {
          setTyping(false);
          push({ from: "bot", ...it });
          if (it.speak && speech.voice) speakHebrew(it.speak, speech.voice);
          if (idx === items.length - 1) setChips(thenChips || []);
        }, delay + dur)
      );
      delay += dur + 280;
    });
  };

  const byeChip = { label: "👋 I'm done", onTap: () => { meSay("I'm done"); s.phase = "bye"; botSay([{ kind: "text", text: "Lehitraot — see you next time! 👋" }], [{ label: "Back to deck", onTap: onExit }]); } };

  const menuChips = () => {
    const c = [{ label: "🃏 Flashcards", onTap: () => { meSay("Flashcards"); startFlash(); } }];
    if (canQuiz) c.push({ label: "📖 Reading quiz", onTap: () => { meSay("Reading quiz"); startQuiz("read"); } });
    if (canQuiz && hasVoice) c.push({ label: "🎧 Listening quiz", onTap: () => { meSay("Listening quiz"); startQuiz("listen"); } });
    c.push(byeChip);
    return c;
  };

  /* greeting */
  useEffect(() => {
    botSay(
      [
        { kind: "text", text: `Shalom! 👋 I'm your "${deck.name}" deck.` },
        { kind: "text", text: "What do you want to practice?" },
      ],
      menuChips()
    );
  }, []);

  /* ----- quiz flow ----- */
  const qMsg = (q, label) =>
    s.mode === "listen"
      ? { kind: "audio", he: q.card.he, label, speak: q.card.he }
      : { kind: "word", he: q.card.he, label };

  const startQuiz = (mode) => {
    s.phase = "quiz"; s.mode = mode;
    s.questions = buildQuestions(deck);
    s.index = 0; s.score = 0; s.streak = 0; s.words = [];
    const q = s.questions[0];
    const intro = mode === "listen" ? "Listen and pick the meaning 🎧" : "Pick the meaning of each word 📖";
    botSay([{ kind: "text", text: intro }, qMsg(q, `1 of ${s.questions.length}`)], q.options.map((opt) => ({ label: opt, onTap: () => answerQ(q, opt) })));
  };

  const answerQ = (q, opt) => {
    meSay(opt);
    const right = opt === q.card.en;
    s.words.push({ cardId: q.card.id, right });
    if (right) { s.score++; s.streak++; } else s.streak = 0;
    const msgs = [
      {
        kind: "text",
        text: right
          ? s.streak >= 3 ? `✓ Right! 🔥 ${s.streak} in a row!` : "✓ Right!"
          : `✗ Not quite — it means "${q.card.en}".`,
      },
    ];
    if (s.mode === "listen") msgs.push({ kind: "word", he: q.card.he, small: true });
    s.index++;
    if (s.index < s.questions.length) {
      const q2 = s.questions[s.index];
      botSay([...msgs, qMsg(q2, `${s.index + 1} of ${s.questions.length}`)], q2.options.map((opt2) => ({ label: opt2, onTap: () => answerQ(q2, opt2) })));
    } else {
      logResult(deck.id, { type: "quiz", mode: s.mode, total: s.questions.length, score: s.score, words: s.words, via: "chat" });
      const ratio = s.score / s.questions.length;
      const line =
        ratio === 1 ? `🌟 ${s.score}/${s.questions.length} — Metzuyan! Perfect!`
        : ratio >= 0.8 ? `🎉 ${s.score}/${s.questions.length} — kol hakavod!`
        : ratio >= 0.6 ? `💪 ${s.score}/${s.questions.length} — getting there!`
        : `🌱 ${s.score}/${s.questions.length} — good practice, let's try flashcards?`;
      const lastMode = s.mode;
      s.phase = "menu";
      botSay([...msgs, { kind: "text", text: line }, { kind: "text", text: "What next?" }], [
        { label: "🔁 Same quiz again", onTap: () => { meSay("Same quiz again"); startQuiz(lastMode); } },
        ...menuChips(),
      ]);
    }
  };

  /* ----- flashcards flow ----- */
  const startFlash = () => {
    s.phase = "flash";
    s.queue = shuffleArr(deck.cards.map((c) => c.id));
    s.total = deck.cards.length; s.known = 0; s.reviews = 0; s.struggled = new Set();
    flashNext([{ kind: "text", text: "Tap 'Show answer' when you've got it 🃏" }]);
  };

  const flashNext = (pre) => {
    const card = deck.cards.find((c) => c.id === s.queue[0]);
    botSay([...pre, { kind: "word", he: card.he, tr: card.tr, label: `${s.known} of ${s.total} done` }], [
      { label: "Show answer 👀", onTap: () => flashReveal(card) },
    ]);
  };

  const flashReveal = (card) => {
    meSay("Show answer");
    const msgs = [{ kind: "text", text: `"${card.en}"${card.tr ? ` · ${card.tr}` : ""}` }];
    if (card.img) msgs.push({ kind: "image", src: card.img });
    botSay(msgs, [
      { label: "Knew it ✓", onTap: () => flashMark(card, true) },
      { label: "Still learning ↻", onTap: () => flashMark(card, false) },
    ]);
  };

  const flashMark = (card, knows) => {
    meSay(knows ? "Knew it ✓" : "Still learning ↻");
    s.reviews++;
    const rest = s.queue.slice(1);
    if (knows) { s.known++; s.queue = rest; }
    else {
      s.struggled.add(card.id);
      const at = Math.min(rest.length, 2 + Math.floor(Math.random() * 2));
      s.queue = [...rest.slice(0, at), card.id, ...rest.slice(at)];
    }
    if (s.queue.length === 0) {
      logResult(deck.id, {
        type: "study", total: s.total, reviews: s.reviews,
        words: deck.cards.map((c) => ({ cardId: c.id, struggled: s.struggled.has(c.id) })),
        via: "chat",
      });
      s.phase = "menu";
      botSay([
        { kind: "text", text: `🎉 That's all ${s.total} cards — kol hakavod!` },
        { kind: "text", text: "What next?" },
      ], menuChips());
    } else {
      flashNext(knows ? [] : [{ kind: "text", text: "No problem — it'll come back around 🔁" }]);
    }
  };

  /* ----- render ----- */
  return (
    <div style={{ maxWidth: 440, margin: "0 auto", fontFamily: uiFont }}>
      <div style={{ background: "#fff", border: `1.5px solid ${T.line}`, borderRadius: 22, overflow: "hidden", boxShadow: "0 12px 34px rgba(31,42,68,0.10)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: `1px solid ${T.line}`, background: "#FBFAF6" }}>
          <span style={{ width: 38, height: 38, borderRadius: "50%", background: accent.soft, color: accent.dark, fontFamily: heFont, fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {deckLetter(deck)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{deck.name}</div>
            <div style={{ fontSize: 11.5, color: T.olive }}>● online</div>
          </div>
          <button onClick={onExit} aria-label="Leave chat" style={{ border: "none", background: "none", fontSize: 18, color: T.inkSoft, cursor: "pointer" }}>✕</button>
        </div>
        <div ref={scrollRef} style={{ height: "min(58vh, 520px)", overflowY: "auto", padding: "14px 12px", display: "flex", flexDirection: "column", gap: 8, background: "#FFFEFB" }}>
          {messages.map((m) => (
            <Bubble key={m.id} m={m} accent={accent} voice={speech.voice} hasVoice={hasVoice} />
          ))}
          {typing && <TypingBubble />}
        </div>
        <div style={{ borderTop: `1px solid ${T.line}`, padding: "10px 12px", display: "flex", gap: 8, flexWrap: "wrap", background: "#FBFAF6", minHeight: 56, alignItems: "center" }}>
          {chips.map((c, i) => (
            <button
              key={i}
              onClick={() => { setChips([]); c.onTap(); }}
              style={{ fontFamily: uiFont, fontSize: 14, fontWeight: 500, padding: "9px 14px", borderRadius: 999, border: `1.5px solid ${accent.main}`, background: "#fff", color: accent.dark, cursor: "pointer" }}
            >
              {c.label}
            </button>
          ))}
          {chips.length === 0 && <span style={{ fontSize: 12.5, color: T.inkSoft }}>…</span>}
        </div>
      </div>
      <p style={{ textAlign: "center", fontSize: 12, color: T.inkSoft, marginTop: 10 }}>Tap a reply to answer — no typing needed.</p>
    </div>
  );
}

function Bubble({ m, accent, voice, hasVoice }) {
  const mine = m.from === "me";
  const base = {
    maxWidth: "78%", padding: "9px 13px", borderRadius: 18, fontSize: 15, lineHeight: 1.45,
    alignSelf: mine ? "flex-end" : "flex-start",
    background: mine ? accent.main : "#ECEAE3",
    color: mine ? "#fff" : T.ink,
    borderBottomRightRadius: mine ? 6 : 18,
    borderBottomLeftRadius: mine ? 18 : 6,
    fontFamily: uiFont,
  };
  if (m.kind === "image")
    return (
      <img
        src={m.src}
        alt=""
        style={{ alignSelf: "flex-start", maxWidth: "60%", maxHeight: 140, borderRadius: 18, borderBottomLeftRadius: 6, objectFit: "cover" }}
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
    );
  if (m.kind === "word")
    return (
      <div style={base}>
        {m.label && <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 2 }}>{m.label}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span dir="rtl" lang="he" style={{ fontFamily: heFont, fontSize: m.small ? 22 : 30, color: T.ink }}>{m.he}</span>
          {hasVoice && <SpeakerBtn text={m.he} voice={voice} size={26} />}
        </div>
        {m.tr && <div style={{ fontSize: 12.5, fontStyle: "italic", color: T.inkSoft, marginTop: 2 }}>{m.tr}</div>}
      </div>
    );
  if (m.kind === "audio")
    return (
      <div style={{ ...base, display: "flex", alignItems: "center", gap: 10 }}>
        {m.label && <span style={{ fontSize: 11, color: T.inkSoft }}>{m.label}</span>}
        <button
          onClick={() => speakHebrew(m.he, voice)}
          aria-label="Play the word"
          style={{ width: 34, height: 34, borderRadius: "50%", border: "none", background: accent.main, color: "#fff", fontSize: 14, cursor: "pointer", flexShrink: 0 }}
        >
          ▶
        </button>
        <span aria-hidden="true" style={{ display: "flex", gap: 2, alignItems: "center" }}>
          {[8, 14, 10, 16, 7, 12, 9, 15, 8].map((h, i) => (
            <span key={i} style={{ width: 3, height: h, background: T.inkSoft, borderRadius: 2, opacity: 0.55 }} />
          ))}
        </span>
      </div>
    );
  return <div style={base}>{m.text}</div>;
}

function TypingBubble() {
  return (
    <div style={{ alignSelf: "flex-start", background: "#ECEAE3", borderRadius: 18, borderBottomLeftRadius: 6, padding: "13px 14px", display: "flex", gap: 4 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#A7A294", animation: `otiyot-dot 1.2s ${i * 0.18}s infinite ease-in-out` }} />
      ))}
    </div>
  );
}

function CardFace({ children, back, color }) {
  return (
    <div
      style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        background: T.card, borderRadius: 20,
        border: `1.5px solid ${T.line}`,
        boxShadow: "0 10px 30px rgba(31,42,68,0.08)",
        backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden",
        transform: back ? "rotateY(180deg)" : "none",
        padding: 24, textAlign: "center",
      }}
    >
      <div style={{ position: "absolute", top: 18, left: "50%", transform: "translateX(-50%)" }}>
        <Thread width={56} colors={color ? [color] : undefined} />
      </div>
      {children}
    </div>
  );
}

/* ---------- shared layout pieces ---------- */

function Shell({ header, children }) {
  return (
    <div style={{ minHeight: "100vh", background: T.paper }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Frank+Ruhl+Libre:wght@500;700&display=swap');
        * { -webkit-tap-highlight-color: transparent; }
        button:focus-visible, [role="button"]:focus-visible, input:focus-visible { outline: 2px solid ${T.blue}; outline-offset: 2px; }
        @keyframes otiyot-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          85% { opacity: 1; }
          100% { transform: translateY(112vh) rotate(320deg); opacity: 0; }
        }
        @keyframes otiyot-pop {
          0% { transform: scale(0.4); opacity: 0; }
          70% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes otiyot-dot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation: none !important; transition: none !important; }
        }
      `}</style>
      {header}
      <main style={{ maxWidth: 860, margin: "0 auto", padding: "28px 20px 60px" }}>{children}</main>
    </div>
  );
}

function Header({ view, cls, deck, teacher, saving, onHome, onClass, onDeck, onTeacherToggle }) {
  const crumb = (label, onClick, last) => (
    <span key={label} style={{ display: "inline-flex", alignItems: "center" }}>
      <button
        onClick={onClick}
        disabled={last}
        style={{
          border: "none", background: "none", cursor: last ? "default" : "pointer",
          fontFamily: uiFont, fontSize: 13.5, color: last ? T.ink : T.inkSoft,
          fontWeight: last ? 600 : 400, padding: 0, textDecoration: last ? "none" : "underline",
          textUnderlineOffset: 3, textDecorationColor: T.line,
        }}
      >
        {label}
      </button>
      {!last && <span style={{ margin: "0 7px", color: "#C9C2B2" }}>›</span>}
    </span>
  );

  const crumbs = [crumb("Classes", onHome, view.page === "classes")];
  if (cls && view.page !== "classes") crumbs.push(crumb(cls.name, onClass, view.page === "decks"));
  if (deck && (view.page === "deck" || view.page === "study" || view.page === "quiz" || view.page === "report" || view.page === "chat"))
    crumbs.push(crumb(deck.name, onDeck, view.page === "deck"));
  if (view.page === "study") crumbs.push(crumb(view.mode === "speak" ? "Speaking practice" : "Studying", () => {}, true));
  if (view.page === "quiz") crumbs.push(crumb(view.mode === "listen" ? "Listening quiz" : "Reading quiz", () => {}, true));
  if (view.page === "report") crumbs.push(crumb("Report", () => {}, true));
  if (view.page === "chat") crumbs.push(crumb("Chat practice", () => {}, true));

  return (
    <header style={{ borderBottom: `1.5px solid ${T.line}`, background: "#FFFDF8" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "14px 20px", display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, cursor: "pointer" }} onClick={onHome}>
          <span style={{ fontFamily: uiFont, fontSize: 17, fontWeight: 700, color: T.ink, lineHeight: 1, whiteSpace: "nowrap" }}>
            Evyatar's Flashcards
          </span>
          <Thread width={48} colors={SHUK.map((s) => s.main)} />
        </div>
        <nav style={{ flex: 1, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{crumbs}</nav>
        {saving && <span style={{ fontFamily: uiFont, fontSize: 12, color: T.inkSoft }}>Saving…</span>}
        <Btn kind={teacher ? "primary" : "ghost"} onClick={onTeacherToggle} style={{ padding: "7px 14px", fontSize: 13 }}>
          {teacher ? "Exit teacher mode" : "Teacher"}
        </Btn>
      </div>
    </header>
  );
}

function PageIntro({ eyebrow, title, sub, color }) {
  return (
    <div style={{ marginBottom: 24, fontFamily: uiFont }}>
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: color || T.blue, marginBottom: 4 }}>
        {eyebrow}
      </div>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, color: T.ink }}>{title}</h1>
      {sub && <p style={{ margin: "6px 0 0", fontSize: 14.5, color: T.inkSoft }}>{sub}</p>}
    </div>
  );
}

function FolderCard({ title, meta, onOpen, teacher, onEdit, onDelete, onDuplicate, onMove, color = SHUK[0], letter, badge }) {
  return (
    <div
      style={{
        background: T.card, border: `1.5px solid ${T.line}`, borderTop: `5px solid ${color.main}`,
        borderRadius: 16, padding: 18, cursor: "pointer", position: "relative", overflow: "hidden",
        transition: "box-shadow 0.15s ease, transform 0.15s ease",
      }}
      onClick={onOpen}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 8px 22px rgba(31,42,68,0.09)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "none"; }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
    >
      {letter && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute", right: -8, top: -20, fontFamily: heFont, fontSize: 96,
            color: color.main, opacity: 0.09, pointerEvents: "none", userSelect: "none", lineHeight: 1,
          }}
        >
          {letter}
        </span>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {badge && (
          <span
            aria-hidden="true"
            style={{
              width: 30, height: 30, borderRadius: "50%", background: color.soft, color: color.dark,
              fontFamily: heFont, fontSize: 17, fontWeight: 700, display: "inline-flex",
              alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}
          >
            {badge}
          </span>
        )}
        <Thread width={40} colors={[color.main]} />
      </div>
      <h3 style={{ fontFamily: uiFont, fontSize: 17, fontWeight: 600, color: T.ink, margin: "10px 0 4px", position: "relative" }}>{title}</h3>
      <p style={{ fontFamily: uiFont, fontSize: 13, color: color.dark, margin: 0, position: "relative" }}>{meta}</p>
      {teacher && (
        <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
          {onDuplicate && <IconBtn label="Duplicate deck" onClick={onDuplicate}>⧉</IconBtn>}
          {onMove && <IconBtn label="Move to another class" onClick={onMove}>→</IconBtn>}
          <IconBtn label="Rename" onClick={onEdit}>✎</IconBtn>
          <IconBtn label="Delete" danger onClick={onDelete}>🗑</IconBtn>
        </div>
      )}
    </div>
  );
}

function AddTile({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent", border: `2px dashed #CFC8B8`, borderRadius: 16,
        padding: 18, minHeight: 104, cursor: "pointer",
        fontFamily: uiFont, fontSize: 15, fontWeight: 500, color: T.inkSoft,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = T.blue; e.currentTarget.style.color = T.blue; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#CFC8B8"; e.currentTarget.style.color = T.inkSoft; }}
    >
      + {label}
    </button>
  );
}

function IconBtn({ children, onClick, label, danger }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: 30, height: 30, borderRadius: 8, border: `1.5px solid ${T.line}`,
        background: "#fff", cursor: "pointer", fontSize: 13,
        color: danger ? T.pom : T.inkSoft, display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}

/* ---------- modals ---------- */

function NameModal({ title, initial, placeholder, onSave, onClose }) {
  const [name, setName] = useState(initial);
  return (
    <Modal title={title} onClose={onClose}>
      <Field label="Name" value={name} onChange={setName} placeholder={placeholder} autoFocus />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save</Btn>
      </div>
    </Modal>
  );
}

/* small helper used by the card editor and bulk add */
function PicturePicker({ term, value, onPick }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState(null);
  const [err, setErr] = useState("");

  const run = async () => {
    setOpen(true); setBusy(true); setErr(""); setHits(null);
    try {
      const r = await searchPictures(term);
      setHits(r);
      if (!r.length) setErr("Nothing found for that word. Try a simpler English word, or paste a link yourself.");
    } catch (e) {
      setErr("Picture search didn't respond. Paste a link yourself, or try again in a moment.");
    }
    setBusy(false);
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Btn onClick={run} disabled={!term.trim() || busy} title={!term.trim() ? "Fill in the English word first" : undefined}>
          {busy ? "Searching…" : "🔍 Find a picture"}
        </Btn>
        {value ? <Btn kind="danger" onClick={() => onPick("")}>Remove picture</Btn> : null}
        {open && !busy && hits && hits.length > 0 && (
          <button onClick={() => setOpen(false)} style={{ border: "none", background: "none", fontFamily: uiFont, fontSize: 12.5, color: T.inkSoft, cursor: "pointer", textDecoration: "underline" }}>
            hide results
          </button>
        )}
      </div>
      {err && <p style={{ fontFamily: uiFont, fontSize: 12.5, color: T.inkSoft, margin: "8px 0 0" }}>{err}</p>}
      {open && hits && hits.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 6, marginTop: 8 }}>
            {hits.map((h) => (
              <button
                key={h.thumb}
                onClick={() => { onPick(h.thumb); setOpen(false); }}
                title={h.title}
                style={{
                  padding: 0, border: `2px solid ${value === h.thumb ? T.blue : T.line}`, borderRadius: 10,
                  overflow: "hidden", cursor: "pointer", background: "#fff", height: 72,
                }}
              >
                <img src={h.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  onError={(e) => { e.currentTarget.parentElement.style.display = "none"; }} />
              </button>
            ))}
          </div>
          <p style={{ fontFamily: uiFont, fontSize: 11.5, color: T.inkSoft, margin: "6px 0 0" }}>
            From Wikimedia Commons (freely licensed). Tap one to use it.
          </p>
        </>
      )}
    </div>
  );
}

function CardModal({ card, onSave, onClose }) {
  const [he, setHe] = useState(card?.he || "");
  const [en, setEn] = useState(card?.en || "");
  const [tr, setTr] = useState(card?.tr || "");
  const [img, setImg] = useState(card?.img || "");
  const [imgOk, setImgOk] = useState(true);
  const [tBusy, setTBusy] = useState(false);
  const [tErr, setTErr] = useState("");

  const suggest = async () => {
    if (!he.trim()) return;
    setTBusy(true); setTErr("");
    try {
      setEn(await translateHeToEn(he));
    } catch (e) {
      setTErr("Couldn't get a suggestion — type the English yourself.");
    }
    setTBusy(false);
  };

  return (
    <Modal title={card ? "Edit card" : "New card"} onClose={onClose}>
      <Field label="Hebrew (niqqud welcome)" value={he} onChange={setHe} rtl placeholder="שָׁלוֹם" autoFocus />
      <Field label="English" value={en} onChange={setEn} placeholder="hello / peace" />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: -6, marginBottom: 12, flexWrap: "wrap" }}>
        <Btn onClick={suggest} disabled={!he.trim() || tBusy} style={{ fontSize: 13, padding: "7px 12px" }}>
          {tBusy ? "Translating…" : "✨ Suggest English"}
        </Btn>
        <span style={{ fontFamily: uiFont, fontSize: 12, color: tErr ? T.pom : T.inkSoft }}>
          {tErr || "A machine guess — check it says what you teach."}
        </span>
      </div>
      <Field label="Transliteration (optional)" value={tr} onChange={setTr} placeholder="shalom" />
      <Field
        label="Picture link (optional)"
        value={img}
        onChange={(v) => { setImg(v); setImgOk(true); }}
        placeholder="https://…/picture.jpg"
      />
      <PicturePicker term={en} value={img} onPick={(u) => { setImg(u); setImgOk(true); }} />
      {img.trim() && (
        imgOk ? (
          <img
            src={img.trim()}
            alt="Preview"
            style={{ maxHeight: 90, maxWidth: "100%", borderRadius: 10, border: `1px solid ${T.line}`, marginBottom: 12, display: "block" }}
            onError={() => setImgOk(false)}
          />
        ) : (
          <p style={{ fontFamily: uiFont, fontSize: 13, color: T.pom, marginTop: -4 }}>
            That link didn't load as an image. Use a direct link ending in .jpg, .png, or similar — you can still save, but students may see no picture.
          </p>
        )
      )}
      <p style={{ fontFamily: uiFont, fontSize: 12, color: T.inkSoft, marginTop: 0 }}>
        Pictures show on the English side after the flip, so they don't give the answer away.
      </p>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={!he.trim() || !en.trim()} onClick={() => onSave({ he: he.trim(), en: en.trim(), tr: tr.trim(), img: img.trim() })}>
          Save card
        </Btn>
      </div>
    </Modal>
  );
}

function BulkAddModal({ onSave, onClose }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [note, setNote] = useState("");

  const parse = (t) => {
    const out = [];
    for (const raw of (t || "").split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.includes("\t") ? line.split("\t") : line.split(",");
      const he = (parts[0] || "").trim();
      if (!he) continue;
      out.push({
        he,
        en: (parts[1] || "").trim(),
        tr: (parts[2] || "").trim(),
        img: (parts[3] || "").trim(),
      });
    }
    return out;
  };

  const onText = (t) => { setText(t); setRows(parse(t)); setNote(""); };

  const missing = rows.filter((r) => !r.en).length;

  const fillMissing = async () => {
    setBusy(true); setNote("");
    const next = [...rows];
    let failed = 0, n = 0;
    for (let i = 0; i < next.length; i++) {
      if (next[i].en) continue;
      n++;
      setProgress(`Translating ${n} of ${missing}…`);
      try {
        next[i] = { ...next[i], en: await translateHeToEn(next[i].he) };
      } catch (e) {
        failed++;
      }
      setRows([...next]);
      await new Promise((r) => setTimeout(r, 350)); // be gentle with the free service
    }
    setBusy(false); setProgress("");
    setNote(
      failed
        ? `${failed} word${failed === 1 ? "" : "s"} couldn't be translated — fill those in below.`
        : "Done. Check each line before adding — machine translations pick one meaning, not always the one you teach."
    );
  };

  const setRowEn = (i, v) => setRows((rs) => rs.map((r, x) => (x === i ? { ...r, en: v } : r)));
  const ready = rows.filter((r) => r.he.trim() && r.en.trim());

  const small = { fontFamily: uiFont, fontSize: 13, color: T.inkSoft };

  return (
    <Modal title="Bulk add cards" onClose={onClose}>
      <p style={{ ...small, marginTop: 0 }}>
        One word per line. Paste straight from a spreadsheet, or type
        <code style={{ fontSize: 12 }}> Hebrew, English, transliteration</code> — English and transliteration are optional.
      </p>
      <textarea
        dir="auto"
        value={text}
        onChange={(e) => onText(e.target.value)}
        placeholder={"שָׁלוֹם, hello, shalom\nתּוֹדָה, thank you, toda\nכֶּלֶב"}
        style={{
          width: "100%", boxSizing: "border-box", height: 110, fontFamily: heFont, fontSize: 16,
          border: `1.5px solid ${T.line}`, borderRadius: 10, padding: 10, color: T.ink, background: "#fff", resize: "vertical",
        }}
      />
      {rows.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "10px 0" }}>
            <span style={{ ...small, fontWeight: 600, color: T.ink }}>{rows.length} line{rows.length === 1 ? "" : "s"}</span>
            {missing > 0 && (
              <Btn onClick={fillMissing} disabled={busy} style={{ fontSize: 13, padding: "7px 12px" }}>
                {busy ? progress || "Translating…" : `✨ Suggest English for ${missing}`}
              </Btn>
            )}
          </div>
          {note && <p style={{ ...small, marginTop: 0 }}>{note}</p>}
          <div style={{ maxHeight: 200, overflowY: "auto", border: `1.5px solid ${T.line}`, borderRadius: 10, marginBottom: 10 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderTop: i === 0 ? "none" : `1px solid ${T.line}` }}>
                <span dir="rtl" lang="he" style={{ fontFamily: heFont, fontSize: 19, color: T.ink, minWidth: 90, textAlign: "right" }}>{r.he}</span>
                <input
                  value={r.en}
                  onChange={(e) => setRowEn(i, e.target.value)}
                  placeholder="English…"
                  style={{
                    flex: 1, minWidth: 0, fontFamily: uiFont, fontSize: 14, padding: "6px 8px",
                    border: `1.5px solid ${r.en.trim() ? T.line : T.pomSoft}`, borderRadius: 8, background: "#fff", color: T.ink, outline: "none",
                  }}
                />
              </div>
            ))}
          </div>
        </>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
        {rows.length > ready.length && (
          <span style={{ ...small, marginRight: "auto", color: T.pom }}>
            {rows.length - ready.length} line{rows.length - ready.length === 1 ? "" : "s"} still need English
          </span>
        )}
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={!ready.length || busy} onClick={() => onSave(ready)}>
          Add {ready.length || ""} card{ready.length === 1 ? "" : "s"}
        </Btn>
      </div>
      <p style={{ ...small, fontSize: 12, marginBottom: 0 }}>
        Pictures aren't added here — open a card afterwards to find one.
      </p>
    </Modal>
  );
}

function DeckActionModal({ mode, deck, classes, currentClassId, onClose, onConfirm }) {
  const copy = mode === "copy";
  const targets = copy ? classes : classes.filter((c) => c.id !== currentClassId);
  const [target, setTarget] = useState(copy ? currentClassId : targets[0]?.id || "");
  const [name, setName] = useState(`${deck.name} (copy)`);
  const small = { fontFamily: uiFont, fontSize: 13.5, color: T.inkSoft };

  if (!targets.length) {
    return (
      <Modal title="Move deck" onClose={onClose}>
        <p style={{ ...small, marginTop: 0 }}>
          There's only one class, so there's nowhere to move this deck yet. Add another class first.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Btn kind="primary" onClick={onClose}>OK</Btn>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={copy ? "Duplicate deck" : "Move deck"} onClose={onClose}>
      <p style={{ ...small, marginTop: 0 }}>
        <strong style={{ color: T.ink, fontWeight: 600 }}>{deck.name}</strong>
        {" — "}
        {deck.cards.length} card{deck.cards.length === 1 ? "" : "s"}
      </p>

      {copy && <Field label="Name for the copy" value={name} onChange={setName} autoFocus />}

      <label style={{ display: "block", marginBottom: 12 }}>
        <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: T.inkSoft, marginBottom: 5, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {copy ? "Put the copy in" : "Move to"}
        </span>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          style={{
            width: "100%", boxSizing: "border-box", fontFamily: uiFont, fontSize: 15,
            padding: "10px 12px", border: `1.5px solid ${T.line}`, borderRadius: 10,
            background: "#fff", color: T.ink, outline: "none",
          }}
        >
          {targets.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}{c.id === currentClassId ? " (same class)" : ""}
            </option>
          ))}
        </select>
      </label>

      <p style={{ ...small, fontSize: 12.5 }}>
        {copy
          ? "The copy is a separate deck: it starts with an empty report, and editing it later won't change the original."
          : "The deck keeps its cards and its report history — only the class it sits in changes."}
      </p>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={!target || (copy && !name.trim())} onClick={() => onConfirm(target, name.trim())}>
          {copy ? "Make a copy" : "Move deck"}
        </Btn>
      </div>
    </Modal>
  );
}

function BlooketModal({ deck, onClose }) {
  const [dir, setDir] = useState("he2en");
  const [seconds, setSeconds] = useState(20);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState("");

  const rows = useMemo(() => buildBlooketRows(deck, dir, seconds), [deck, dir, seconds]);
  const skipped = deck.cards.length - rows.length;
  const thin = rows.filter((r) => !r[3]).length; // fewer than 2 answer options
  const small = { fontFamily: uiFont, fontSize: 13.5, color: T.inkSoft };
  const safeName = (deck.name || "deck").replace(/[^\w\u05D0-\u05EA -]/g, "").trim().replace(/\s+/g, "-") || "deck";

  const radio = (val, label, sub) => (
    <label style={{ display: "flex", gap: 9, alignItems: "flex-start", cursor: "pointer", marginBottom: 8 }}>
      <input type="radio" checked={dir === val} onChange={() => setDir(val)} style={{ marginTop: 3, accentColor: T.blue }} />
      <span>
        <span style={{ fontFamily: uiFont, fontSize: 14.5, color: T.ink }}>{label}</span>
        <span style={{ display: "block", fontFamily: uiFont, fontSize: 12.5, color: T.inkSoft }}>{sub}</span>
      </span>
    </label>
  );

  return (
    <Modal title="Export for Blooket" onClose={onClose}>
      <p style={{ ...small, marginTop: 0 }}>
        Blooket only takes multiple-choice questions, so each word becomes one question with wrong answers
        pulled from this same deck.
      </p>

      <div style={{ marginBottom: 10 }}>
        {radio("he2en", "Hebrew question → English answers", "Matches the reading quiz. Easier — recognition.")}
        {radio("en2he", "English question → Hebrew answers", "Harder — recall, like speaking practice.")}
      </div>

      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, fontFamily: uiFont, fontSize: 14, color: T.ink }}>
        Seconds per question
        <input
          type="number" min="5" max="300" value={seconds}
          onChange={(e) => setSeconds(Math.max(5, Math.min(300, parseInt(e.target.value, 10) || 20)))}
          style={{ width: 70, fontFamily: uiFont, fontSize: 14, padding: "6px 8px", border: `1.5px solid ${T.line}`, borderRadius: 8, outline: "none", color: T.ink, background: "#fff" }}
        />
      </label>

      <div style={{ background: T.blueSoft, borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontFamily: uiFont, fontSize: 13.5, color: T.ink }}>
        {rows.length} question{rows.length === 1 ? "" : "s"} ready
        {skipped > 0 && <span style={{ color: T.pom }}> · {skipped} card{skipped === 1 ? "" : "s"} skipped (missing Hebrew or English)</span>}
        {thin > 0 && <span style={{ color: T.inkSoft }}> · {thin} will have only 2 choices (small deck)</span>}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <Btn
          kind="primary"
          onClick={() => {
            const ok = downloadText(toCSV(rows), `${safeName}-blooket.csv`, "text/csv");
            setMsg(ok ? "Downloaded. In Blooket: Create → Spreadsheet Import → Upload CSV." : "Download blocked — use the copy button instead.");
          }}
        >
          ⬇️ Download CSV
        </Btn>
        <Btn
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(toTSV(rows));
              setCopied(true);
              setMsg("Copied. Open Blooket's spreadsheet template and paste into the first empty data row.");
            } catch (e) {
              setMsg("Copy failed — use the download button instead.");
            }
          }}
        >
          {copied ? "Copied ✓" : "📋 Copy for the template"}
        </Btn>
      </div>
      {msg && <p style={{ ...small, marginTop: 0 }}>{msg}</p>}

      <p style={{ ...small, fontSize: 12.5 }}>
        Two ways in, if one gives you trouble: upload the CSV directly, or copy the rows and paste them into
        Blooket's own template (Create → Spreadsheet Import → Copy), then download that as CSV. Check the Hebrew
        looks right in Blooket before class — some sites render niqqud and right-to-left text imperfectly.
      </p>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Btn onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  );
}

function BackupModal({ mode, data, onApplyClasses, onClose }) {
  const [status, setStatus] = useState(mode === "export" ? "working" : "idle");
  const [json, setJson] = useState("");
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(null);
  const [copied, setCopied] = useState(false);

  // export: gather everything, then try to download
  useEffect(() => {
    if (mode !== "export") return;
    let cancelled = false;
    (async () => {
      try {
        const backup = await buildBackup(data);
        if (cancelled) return;
        setJson(JSON.stringify(backup));
        const ok = downloadJSON(backup, `otiyot-backup-${new Date().toISOString().slice(0, 10)}.json`);
        setStatus(ok ? "done" : "nodownload");
      } catch (e) {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const tryParse = (text) => {
    setJson(text); setError(""); setParsed(null);
    if (!text.trim()) return;
    try {
      const p = JSON.parse(text);
      if (p?.app !== "otiyot" || !Array.isArray(p?.data?.classes)) {
        setError("This doesn't look like an Otiyot backup file.");
        return;
      }
      setParsed(p);
    } catch (e) {
      setError("Couldn't read that — make sure it's the complete backup file.");
    }
  };

  const counts = parsed
    ? {
        classes: parsed.data.classes.length,
        decks: parsed.data.classes.reduce((s, c) => s + (c.decks?.length || 0), 0),
        cards: parsed.data.classes.reduce((s, c) => s + (c.decks || []).reduce((x, d) => x + (d.cards?.length || 0), 0), 0),
        records: Object.values(parsed.results || {}).reduce((s, a) => s + (a?.length || 0), 0),
      }
    : null;

  const doRestore = async () => {
    setStatus("working");
    try {
      await onApplyClasses(parsed.data.classes);
      const r = await restoreResults(parsed.results);
      setRestored(r);
      setStatus("done");
    } catch (e) {
      setStatus("error");
    }
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
    } catch (e) {
      setError("Copy failed — select the text below and copy it manually.");
    }
  };

  const small = { fontFamily: uiFont, fontSize: 13.5, color: T.inkSoft };

  if (mode === "export") {
    return (
      <Modal title="Export backup" onClose={onClose}>
        {status === "working" && <p style={small}>Gathering your decks and reports…</p>}
        {status === "error" && <p style={{ ...small, color: T.pom }}>Something went wrong gathering the data. Try again — if it keeps failing, check that you're signed in and online.</p>}
        {(status === "done" || status === "nodownload") && (
          <>
            <p style={small}>
              {status === "done"
                ? "Your backup file should be downloading now. If it didn't, use the copy button below and paste it somewhere safe (a note, a doc, an email to yourself)."
                : "Downloads are blocked here, so copy the backup below and paste it somewhere safe (a note, a doc, an email to yourself)."}
            </p>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <Btn kind="primary" onClick={copyJson}>{copied ? "Copied ✓" : "Copy backup to clipboard"}</Btn>
            </div>
            <textarea
              readOnly
              value={json}
              onFocus={(e) => e.target.select()}
              style={{ width: "100%", boxSizing: "border-box", height: 90, fontFamily: "monospace", fontSize: 11, border: `1.5px solid ${T.line}`, borderRadius: 10, padding: 8, color: T.inkSoft, background: "#fff", resize: "vertical" }}
            />
            <p style={{ ...small, fontSize: 12.5, marginBottom: 0 }}>
              Contains all classes, decks, cards, and report records. Does not contain your teacher password.
            </p>
          </>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <Btn onClick={onClose}>Close</Btn>
        </div>
      </Modal>
    );
  }

  // import
  return (
    <Modal title="Import backup" onClose={onClose}>
      {status !== "done" ? (
        <>
          <p style={small}>Pick your backup file, or paste its contents:</p>
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const r = new FileReader();
              r.onload = () => tryParse(String(r.result));
              r.onerror = () => setError("Couldn't read that file.");
              r.readAsText(f);
            }}
            style={{ fontFamily: uiFont, fontSize: 13, marginBottom: 10, display: "block" }}
          />
          <textarea
            placeholder='Or paste the backup text here ({"app":"otiyot",…})'
            value={parsed ? json : json}
            onChange={(e) => tryParse(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", height: 80, fontFamily: "monospace", fontSize: 11, border: `1.5px solid ${error ? T.pom : T.line}`, borderRadius: 10, padding: 8, color: T.ink, background: "#fff", resize: "vertical" }}
          />
          {error && <p style={{ ...small, color: T.pom }}>{error}</p>}
          {counts && (
            <div style={{ background: T.blueSoft, borderRadius: 10, padding: "10px 12px", margin: "10px 0", fontFamily: uiFont, fontSize: 13.5, color: T.ink }}>
              Found: {counts.classes} class{counts.classes === 1 ? "" : "es"}, {counts.decks} deck{counts.decks === 1 ? "" : "s"}, {counts.cards} cards, {counts.records} report record{counts.records === 1 ? "" : "s"}
              {parsed.exportedAt ? ` · exported ${new Date(parsed.exportedAt).toLocaleDateString()}` : ""}
            </div>
          )}
          {counts && (
            <p style={{ ...small, color: T.pom }}>
              Restoring replaces all current classes, decks, and cards with the backup. Report records are added on top (already-present records are skipped, so importing twice won't double-count). Your teacher sign-in is not affected.
            </p>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn kind="primary" disabled={!parsed || status === "working"} onClick={doRestore}>
              {status === "working" ? "Restoring…" : "Restore backup"}
            </Btn>
          </div>
          {status === "error" && <p style={{ ...small, color: T.pom, marginBottom: 0 }}>Restore failed partway. Your backup file is untouched — try again.</p>}
        </>
      ) : (
        <>
          <p style={{ fontFamily: uiFont, fontSize: 14.5, color: T.ink }}>
            ✓ Restored. {restored ? `${restored.written} report record${restored.written === 1 ? "" : "s"} added${restored.skipped ? `, ${restored.skipped} duplicate${restored.skipped === 1 ? "" : "s"} skipped` : ""}.` : ""}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Btn kind="primary" onClick={onClose}>Done</Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

function LoginModal({ onClose, onSuccess }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async () => {
    if (!email.trim() || !pw) return;
    setBusy(true); setErr("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pw);
      onSuccess();
    } catch (e) {
      setErr("Sign-in failed — check the email and password.");
      setBusy(false);
    }
  };
  return (
    <Modal title="Teacher sign in" onClose={onClose}>
      <p style={{ fontFamily: uiFont, fontSize: 13.5, color: T.inkSoft, marginTop: 0 }}>
        Students don't need this — only the teacher signs in, to edit decks and see reports.
      </p>
      <Field label="Email" value={email} onChange={setEmail} placeholder="you@example.com" autoFocus />
      <label style={{ display: "block", marginBottom: 12 }}>
        <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: T.inkSoft, marginBottom: 5, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Password
        </span>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") go(); }}
          style={{
            width: "100%", boxSizing: "border-box", fontFamily: uiFont, fontSize: 15,
            padding: "10px 12px", border: `1.5px solid ${T.line}`, borderRadius: 10,
            background: "#fff", color: T.ink, outline: "none",
          }}
          onFocus={(e) => (e.target.style.borderColor = T.blue)}
          onBlur={(e) => (e.target.style.borderColor = T.line)}
        />
      </label>
      {err && <p style={{ fontFamily: uiFont, fontSize: 13, color: T.pom, marginTop: -4 }}>{err}</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={!email.trim() || !pw || busy} onClick={go}>{busy ? "Signing in…" : "Sign in"}</Btn>
      </div>
      <p style={{ fontFamily: uiFont, fontSize: 12, color: T.inkSoft, marginBottom: 0 }}>
        Forgot the password? Reset it in the Firebase console (Authentication → Users).
      </p>
    </Modal>
  );
}

/* ---------- mount ---------- */

function Root() {
  if (!CONFIG_OK || !db || !auth) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: 40, maxWidth: 560, margin: "0 auto", color: "#1F2A44" }}>
        <h2 style={{ marginTop: 0 }}>Almost there!</h2>
        <p>
          The app isn't connected to Firebase yet. Open <code>firebase-config.js</code>, paste your Firebase
          project's config object (see the README, step 2), commit the change, and reload this page.
        </p>
      </div>
    );
  }
  return <App />;
}

createRoot(document.getElementById("root")).render(<Root />);
