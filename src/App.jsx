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

/* ---------- plan helpers ---------- */
const TOTAL = 1000; // total number of lines (change if your text is different)
const DAY_MS = 86400000;
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const longDate = (d) =>
  d.toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" });

// getDay() values; Friday (5) is a rest day so it is not listed
const WEEK = [[6, "السبت"], [0, "الأحد"], [1, "الاثنين"], [2, "الثلاثاء"], [3, "الأربعاء"], [4, "الخميس"]];
const DEFAULT_PLAN = { base: 2, fastCount: 4, fast: [4] };
const plannedFor = (plan, s) =>
  plan.fast.includes(parse(s).getDay()) ? plan.fastCount : plan.base;

// day-by-day simulation, skipping Fridays. Returns null if it never ends.
function finishDate(remaining, plan, from) {
  let d = new Date(from);
  let left = remaining;
  for (let i = 0; i < 4000; i++) {
    if (left <= 0) return d;
    d = addDays(d, 1);
    const wd = d.getDay();
    if (wd === 5) continue;
    left -= plan.fast.includes(wd) ? plan.fastCount : plan.base;
  }
  return null;
}

// average lines per working day over the last 14 days (about 12 working days)
function paceOf(entries, uid) {
  const since = key(addDays(new Date(), -14));
  const total = entries
    .filter((e) => e.user_id === uid && e.day > since)
    .reduce((sum, e) => sum + (e.to_verse - e.from_verse + 1), 0);
  return total > 0 ? total / 12 : null;
}

// consecutive working days with a log (Fridays never break the streak)
function streakOf(entries, uid) {
  const days = new Set(entries.filter((e) => e.user_id === uid).map((e) => e.day));
  let d = new Date();
  if (!days.has(key(d))) d = addDays(d, -1);
  let n = 0;
  for (let i = 0; i < 400; i++) {
    if (d.getDay() === 5 && !days.has(key(d))) { d = addDays(d, -1); continue; }
    if (!days.has(key(d))) break;
    n++;
    d = addDays(d, -1);
  }
  return n;
}

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
        <p className="muted">سجّلي دخولك لتري أبياتك القادمة.</p>
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
  const [plan, setPlan] = useState(DEFAULT_PLAN);
  const [goals, setGoals] = useState([]);
  const [count, setCount] = useState(2);
  const [date, setDate] = useState(key(new Date()));
  const [startInput, setStartInput] = useState("");
  const [startFor, setStartFor] = useState(user.id);

  const load = useCallback(async () => {
    const [p, e, pl, g] = await Promise.all([
      supabase.from("profiles").select("*"),
      supabase
        .from("entries")
        .select("*")
        .order("day", { ascending: false })
        .order("id", { ascending: false }),
      supabase.from("plan").select("*").eq("id", 1).maybeSingle(),
      supabase.from("goals").select("*").order("target", { ascending: true }),
    ]);
    const bad = p.error || e.error;
    if (bad) return setErr(bad.message);
    setErr("");
    setProfiles(p.data);
    setEntries(e.data);
    if (pl.data)
      setPlan({ base: pl.data.base, fastCount: pl.data.fast_count, fast: pl.data.fast });
    if (g.data) setGoals(g.data);
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

  // once data is loaded, start with the planned number for today
  useEffect(() => {
    if (loaded) setCount(plannedFor(plan, key(new Date())));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

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
  const pace = paceOf(entries, me.id);
  const streak = streakOf(entries, me.id);
  const loggedToday = entries.some((e) => e.user_id === me.id && e.day === todayKey);
  const startFrom = loggedToday ? new Date() : addDays(new Date(), -1);

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
  const savePlan = (next) => {
    setPlan(next);
    supabase
      .from("plan")
      .update({ base: next.base, fast_count: next.fastCount, fast: next.fast, updated_at: new Date().toISOString() })
      .eq("id", 1)
      .then(({ error }) => error && setErr(error.message));
  };
  const addGoal = (target, note) => {
    if (goals.some((x) => x.target === target)) return setErr("هذا الهدف موجود مسبقًا.");
    run(supabase.from("goals").insert({ target, note: note || null }));
  };
  const removeGoal = (id) => run(supabase.from("goals").delete().eq("id", id));
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

      <NextGoal
        goals={goals}
        upto={upto}
        me={me}
        plan={plan}
        startFrom={startFrom}
      />

      <section className="hero">
        <p className="hero-label">أبياتك القادمة</p>
        <p className="big" lang="ar">{label(from, to)}</p>
        <p className="hero-sub">تبدأين من البيت {ar(from)}</p>
      </section>

      <section className="card">
        <h2>كم بيتًا حفظتِ؟</h2>
        <div className="chips" role="group" aria-label="عدد الأبيات">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
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
          <input type="date" value={date} onChange={(e) => {
              const v = e.target.value || todayKey;
              setDate(v);
              setCount(plannedFor(plan, v));
            }} />
        </label>
        {date !== todayKey && (
          <p className="muted note">أنتِ تسجّلين ليوم {pretty(date)} وليس اليوم.</p>
        )}
        {isFriday && <p className="muted note">الجمعة يوم راحة في الخطة، لكن يمكنك التسجيل فيها للاستدراك.</p>}

        <button className="check" onClick={log}>
          {saved ? "تم الحفظ ✓" : "حفظتُ هذه الأبيات"}
        </button>
      </section>

      <Plan
        plan={plan}
        setPlan={savePlan}
        profiles={profiles}
        upto={upto}
        me={me}
        pace={pace}
        streak={streak}
        startFrom={startFrom}
        goals={goals}
      />

      <Goals
        goals={goals}
        profiles={profiles}
        upto={upto}
        me={me}
        plan={plan}
        startFrom={startFrom}
        onAdd={addGoal}
        onRemove={removeGoal}
      />

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
                  <span className="muted block">وصلت إلى البيت <bdi>{ar(upto(p))}</bdi></span>
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
            الأبيات المحفوظة قبل استخدام الموقع: إلى البيت {ar(startTarget.memorized_upto)}.
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

/* ---------- plan ---------- */
function Plan({ plan, setPlan, profiles, upto, me, pace, streak, startFrom, goals }) {
  const done = upto(me);
  const remaining = Math.max(TOTAL - done, 0);
  const planned = remaining ? finishDate(remaining, plan, startFrom) : null;
  const atPace =
    remaining && pace ? finishDate(remaining, { base: pace, fast: [], fastCount: 0 }, startFrom) : null;
  const saved = planned && atPace ? Math.round((atPace - planned) / DAY_MS) : 0;
  const nextGoal = goals.map((g) => g.target).filter((t) => t > done).sort((a, b) => a - b)[0];
  const next = nextGoal ?? Math.min(TOTAL, (Math.floor(done / 100) + 1) * 100);
  const weekly = plan.base * (6 - plan.fast.length) + plan.fastCount * plan.fast.length;
  const toggle = (wd) =>
    setPlan({
      ...plan,
      fast: plan.fast.includes(wd) ? plan.fast.filter((x) => x !== wd) : [...plan.fast, wd],
    });

  return (
    <section className="card">
      <h2>رحلة الألفية</h2>

      {profiles.map((p) => {
        const n = upto(p);
        return (
          <div className="bar-row" key={p.id}>
            <div className="bar-head">
              <strong>{arName(p.name)}</strong>
              <span className="muted"><bdi>{ar(n)}</bdi> / <bdi>{ar(TOTAL)}</bdi></span>
            </div>
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={TOTAL} aria-valuenow={n}>
              <div className="bar-fill" style={{ width: `${Math.min(100, (n / TOTAL) * 100)}%` }} />
            </div>
          </div>
        );
      })}

      {remaining === 0 ? (
        <p className="win">ما شاء الله! أتممتِ الألفية 🎉</p>
      ) : (
        <>
          <div className="tiles">
            <div className="tile"><b>{ar(remaining)}</b><span>بيتًا متبقيًا</span></div>
            <div className="tile"><b>{ar(streak)} 🔥</b><span>أيام متتالية</span></div>
            <div className="tile">
              <b>{pace ? ar(Math.round(pace * 10) / 10) : "—"}</b>
              <span>وتيرتك يوميًا</span>
            </div>
          </div>

          <p className="milestone">
            باقي <bdi>{ar(next - done)}</bdi> {next - done === 1 ? "بيت" : "أبيات"} للوصول إلى <bdi>{ar(next)}</bdi>
          </p>

          <div className="finish">
            <div>
              <span className="muted">حسب وتيرتك الحالية</span>
              <strong>{atPace ? longDate(atPace) : "سجّلي بعض الأيام أولًا"}</strong>
            </div>
            <div className="hl">
              <span className="muted">حسب خطتك</span>
              <strong>{planned ? longDate(planned) : "—"}</strong>
            </div>
          </div>
          {saved > 0 && (
            <p className="win small">خطتك تختصر <bdi>{ar(saved)}</bdi> يومًا. واصلي! 💪</p>
          )}
        </>
      )}

      <details className="planner">
        <summary>تعديل الخطة</summary>

        <p className="sub">أبيات في الأيام العادية</p>
        <div className="chips">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button key={n} className={n === plan.base ? "chip on" : "chip"} onClick={() => setPlan({ ...plan, base: n })}>
              {ar(n)}
            </button>
          ))}
        </div>

        <p className="sub">أيام التسريع (حفظ أكثر)</p>
        <div className="chips">
          {WEEK.map(([wd, name]) => (
            <button
              key={wd}
              className={plan.fast.includes(wd) ? "chip wide on" : "chip wide"}
              aria-pressed={plan.fast.includes(wd)}
              onClick={() => toggle(wd)}
            >
              {name}
            </button>
          ))}
        </div>

        <p className="sub">أبيات في يوم التسريع</p>
        <div className="chips">
          {[3, 4, 5, 6, 8, 10].map((n) => (
            <button key={n} className={n === plan.fastCount ? "chip on" : "chip"} onClick={() => setPlan({ ...plan, fastCount: n })}>
              {ar(n)}
            </button>
          ))}
        </div>

        <p className="muted note">
          مجموع الأسبوع حسب خطتك: <bdi>{ar(weekly)}</bdi> بيتًا (الجمعة راحة في الخطة، ويمكن التسجيل فيها للاستدراك). الخطة مشتركة بينكما.
        </p>
      </details>
    </section>
  );
}

/* ---------- goals ---------- */
function Goals({ goals, profiles, upto, me, plan, startFrom, onAdd, onRemove }) {
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const done = upto(me);
  const nextT = goals.find((g) => g.target > done)?.target;
  const rest = goals.filter((g) => g.target !== nextT);
  const ordered = [...rest.filter((g) => g.target > done), ...rest.filter((g) => g.target <= done)];

  const submit = () => {
    const n = Number(target);
    if (!Number.isInteger(n) || n < 1 || n > TOTAL) return;
    onAdd(n, note.trim());
    setTarget("");
    setNote("");
  };

  return (
    <section className="card">
      <h2>الأهداف</h2>
      {goals.length === 0 && <p className="muted">لا توجد أهداف بعد. أضيفي أول هدف.</p>}

      <ul className="goals">
        {ordered.map((g) => {
          const hit = done >= g.target;
          const left = g.target - done;
          const eta = hit ? null : finishDate(left, plan, startFrom);
          return (
            <li key={g.id} className={hit ? "goal hit" : "goal"}>
              <div className="goal-main">
                <span className="nums"><bdi>{ar(g.target)}</bdi></span>
                {g.note && <span className="muted"> · {g.note}</span>}
                <span className="block goal-line">
                  {hit
                    ? "تم بلوغه ✓"
                    : `باقي ${ar(left)} ${left === 1 ? "بيت" : "أبيات"}${eta ? ` · المتوقع ${longDate(eta)}` : ""}`}
                </span>
                <span className="muted block">
                  {profiles
                    .filter((p) => p.id !== me.id)
                    .map((p) => {
                      const r = g.target - upto(p);
                      return `${arName(p.name)}: ${r <= 0 ? "بلغته ✓" : `باقي ${ar(r)}`}`;
                    })
                    .join(" · ")}
                </span>
              </div>
              <button className="link danger" onClick={() => onRemove(g.id)}>حذف</button>
            </li>
          );
        })}
      </ul>

      <div className="row add-goal">
        <input
          type="number"
          min="1"
          max={TOTAL}
          className="goal-num"
          placeholder="رقم البيت"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <input
          type="text"
          placeholder="وصف (اختياري)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className="primary" onClick={submit}>إضافة</button>
      </div>
    </section>
  );
}

/* ---------- next goal banner ---------- */
function NextGoal({ goals, upto, me, plan, startFrom }) {
  const done = upto(me);
  const next = goals.find((g) => g.target > done);

  if (!next) {
    return goals.length ? (
      <section className="next-goal won">
        <p className="ng-label">ما شاء الله 🎉</p>
        <p className="ng-note">أتممتِ كل أهدافك. أضيفي هدفًا جديدًا من قسم الأهداف.</p>
      </section>
    ) : null;
  }

  const prev = Math.max(0, ...goals.filter((g) => g.target <= done).map((g) => g.target));
  const pct = Math.min(100, Math.max(0, ((done - prev) / (next.target - prev)) * 100));
  const left = next.target - done;
  const eta = finishDate(left, plan, startFrom);

  return (
    <section className="next-goal">
      <p className="ng-label">🎯 هدفك القادم</p>
      <p className="ng-num"><bdi>{ar(next.target)}</bdi></p>
      {next.note && <p className="ng-note">{next.note}</p>}
      <div className="ng-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <div className="ng-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="ng-left">
        باقي <b><bdi>{ar(left)}</bdi></b> {left === 1 ? "بيت" : "أبيات"}
        {eta && <> · المتوقع <b>{longDate(eta)}</b></>}
      </p>
    </section>
  );
}
