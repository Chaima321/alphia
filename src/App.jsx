import { useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import "./index.css";

/* ---------- helpers ---------- */
const key = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
const parse = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const pretty = (s) =>
  parse(s).toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long" });

// Arabic-Indic digits: 97 -> ٩٧
const ar = (n) => Number(n).toLocaleString("ar-EG", { useGrouping: false });
// 97,98 -> "٩٧ و ٩٨"   97,100 -> "٩٧ – ١٠٠"   97,97 -> "٩٧"
const label = (a, b) =>
  a === b ? ar(a) : b - a === 1 ? `${ar(a)} و ${ar(b)}` : `${ar(a)} – ${ar(b)}`;

// Arabic display names (falls back to the name stored in the database)
const NAMES = { chaima: "شيماء", yassmine: "ياسمين" };
const arName = (n) => NAMES[(n || "").toLowerCase()] ?? n ?? "؟";
const initial = (n) => Array.from(arName(n))[0] ?? "؟";

/* ---------- root ---------- */
export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";
    document.title = "الدرر السنية";
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <p className="center">جارٍ التحميل…</p>;
  if (!session) return <Login />;
  return <Home user={session.user} />;
}

/* ---------- login ---------- */
function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError("البريد الإلكتروني أو كلمة المرور غير صحيحة.");
  };

  return (
    <main className="login">
      <div className="login-card">
        <div className="star" aria-hidden="true" />
        <h1>الدرر السنية</h1>
        <p className="muted">سجّلي دخولك لتري آياتك القادمة.</p>
        <form onSubmit={submit}>
          <label>
            البريد الإلكتروني
            <input
              type="email"
              dir="ltr"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            كلمة المرور
            <input
              type="password"
              dir="ltr"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "جارٍ الدخول…" : "تسجيل الدخول"}
          </button>
        </form>
      </div>
    </main>
  );
}

/* ---------- home ---------- */
function Home({ user }) {
  const [profiles, setProfiles] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [count, setCount] = useState(2);
  const [date, setDate] = useState(key(new Date()));
  const [startInput, setStartInput] = useState("");
  const [startFor, setStartFor] = useState(user.id);

  const load = useCallback(async () => {
    const [p, e] = await Promise.all([
      supabase.from("profiles").select("*"),
      supabase
        .from("entries")
        .select("*")
        .order("day", { ascending: false })
        .order("id", { ascending: false }),
    ]);
    const bad = p.error || e.error;
    if (bad) return setErr(bad.message);
    setErr("");
    setProfiles(p.data);
    setEntries(e.data);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  if (!loaded) return <p className="center">{err || "جارٍ التحميل…"}</p>;

  const me = profiles.find((p) => p.id === user.id);
  if (!me)
    return (
      <p className="center">
        ملفك الشخصي غير موجود. شغّلي أوامر إضافة الملفات الشخصية في آخر ملف update.sql.
      </p>
    );

  const isAdmin = !!me.is_admin;
  const todayKey = key(new Date());
  const nameOf = (id) => arName(profiles.find((p) => p.id === id)?.name);

  // last verse memorized = the higher of the starting point and any logged entry
  const upto = (p) =>
    Math.max(p.memorized_upto, ...entries.filter((e) => e.user_id === p.id).map((e) => e.to_verse));

  const from = upto(me) + 1;
  const to = upto(me) + count;
  const isFriday = parse(date).getDay() === 5;

  const run = async (promise, onOk) => {
    const { error } = await promise;
    if (error) setErr(error.message);
    else {
      onOk?.();
      load();
    }
  };

  const log = () =>
    run(
      supabase.from("entries").insert({ user_id: user.id, day: date, from_verse: from, to_verse: to }),
      () => setSaved(true)
    );
  const remove = (id) => run(supabase.from("entries").delete().eq("id", id));
  const saveStart = () => {
    const n = Number(startInput);
    if (startInput === "" || !Number.isInteger(n) || n < 0) return setErr("أدخلي عددًا صحيحًا.");
    setStartInput("");
    run(supabase.from("profiles").update({ memorized_upto: n }).eq("id", startFor));
  };

  const startTarget = profiles.find((p) => p.id === startFor) ?? me;

  return (
    <main className="app">
      <header>
        <h1>الدرر السنية</h1>
        <div className="who">
          <span className="avatar" aria-hidden="true">{initial(me.name)}</span>
          <span>{arName(me.name)}</span>
          <button className="link" onClick={() => supabase.auth.signOut()}>خروج</button>
        </div>
      </header>

      {err && <p className="error banner">{err}</p>}

      <section className="hero">
        <p className="hero-label">آياتك القادمة</p>
        <p className="big" lang="ar">{label(from, to)}</p>
        <p className="hero-sub">تبدأين من الآية {ar(from)}</p>
      </section>

      <section className="card">
        <h2>كم آية حفظتِ؟</h2>
        <div className="chips" role="group" aria-label="عدد الآيات">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              className={n === count ? "chip on" : "chip"}
              aria-pressed={n === count}
              onClick={() => setCount(n)}
            >
              {ar(n)}
            </button>
          ))}
        </div>

        <label>
          اليوم
          <input type="date" value={date} onChange={(e) => setDate(e.target.value || todayKey)} />
        </label>
        {date !== todayKey && !isFriday && (
          <p className="muted note">أنتِ تسجّلين ليوم {pretty(date)} وليس اليوم.</p>
        )}
        {isFriday && <p className="muted note">الجمعة يوم راحة. اختاري يومًا آخر للتسجيل.</p>}

        <button className="check" disabled={isFriday} onClick={log}>
          {saved ? "تم الحفظ ✓" : "حفظتُ هذه الآيات"}
        </button>
      </section>

      <section className="card">
        <h2>اليوم</h2>
        <ul className="status">
          {profiles.map((p) => {
            const today = entries.filter((e) => e.user_id === p.id && e.day === todayKey);
            const lo = today.length ? Math.min(...today.map((e) => e.from_verse)) : null;
            const hi = today.length ? Math.max(...today.map((e) => e.to_verse)) : null;
            return (
              <li key={p.id} className={today.length ? "yes" : ""}>
                <span className="avatar" aria-hidden="true">{initial(p.name)}</span>
                <span className="grow">
                  <strong>{arName(p.name)}</strong>
                  <span className="muted block">وصلت إلى الآية <bdi>{ar(upto(p))}</bdi></span>
                </span>
                <span className="state">
                  {today.length ? (
                    <>
                      <bdi className="nums">{label(lo, hi)}</bdi> ✓
                    </>
                  ) : (
                    "لم تسجّل بعد"
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {entries.length > 0 && (
        <section className="card">
          <h2>السجل</h2>
          <ul className="history">
            {entries.slice(0, 40).map((e) => (
              <li key={e.id}>
                <div>
                  <strong>{pretty(e.day)}</strong>
                  <span className="muted block">{nameOf(e.user_id)}</span>
                </div>
                <div className="hist-right">
                  <bdi className="nums">{label(e.from_verse, e.to_verse)}</bdi>
                  {e.user_id === user.id && (
                    <button className="link danger" onClick={() => remove(e.id)}>حذف</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isAdmin && (
        <details className="settings">
          <summary>نقطة البداية (للمشرفة فقط)</summary>
          <label>
            الشخص
            <select value={startFor} onChange={(e) => setStartFor(e.target.value)}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{arName(p.name)}</option>
              ))}
            </select>
          </label>
          <p className="muted">
            الآيات المحفوظة قبل استخدام الموقع: إلى الآية {ar(startTarget.memorized_upto)}.
          </p>
          <div className="row">
            <input
              type="number"
              min="0"
              placeholder="مثال: 93"
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
            />
            <button className="primary" onClick={saveStart}>حفظ</button>
          </div>
        </details>
      )}
    </main>
  );
}
