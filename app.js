// ===== アプリ本体: UI と Google Calendar 連携 =====
(function () {
  const $ = (id) => document.getElementById(id);
  const SCOPES = "https://www.googleapis.com/auth/calendar.readonly";
  let tokenClient = null;
  let accessToken = null;
  let calendars = []; // {id, summary, bgColor, selected}
  let lastDays = null;

  // ---------- 初期化 ----------
  function init() {
    const cfg = window.APP_CONFIG || {};
    const ok = cfg.GOOGLE_CLIENT_ID && !cfg.GOOGLE_CLIENT_ID.includes("ここに");
    if (!ok) $("setupWarning").hidden = false;

    setupDefaults();
    setupDayWindow();
    loadSettings();
    setupWorkDefaults();
    bindUI();

    // GIS 読み込み待ち
    waitForGoogle().then(() => {
      if (!ok) return;
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: cfg.GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: onToken,
      });
    });
  }

  function waitForGoogle() {
    return new Promise((res) => {
      const t = setInterval(() => {
        if (window.google && google.accounts && google.accounts.oauth2) {
          clearInterval(t);
          res();
        }
      }, 100);
    });
  }

  // ---------- 既定値 ----------
  function toLocalInput(d) {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 16);
  }
  function setupDefaults() {
    const now = new Date();
    const start = new Date(now); start.setHours(9, 0, 0, 0);
    const end = new Date(now); end.setDate(end.getDate() + 6); end.setHours(21, 0, 0, 0);
    $("rangeStart").value = toLocalInput(start);
    $("rangeEnd").value = toLocalInput(end);
  }
  // ---------- 1日の時間帯（端末に記憶） ----------
  const DAY_KEY = "ft_day_v1", CAL_KEY = "ft_cals_v1", SET_KEY = "ft_set_v1";

  function setupDayWindow() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(DAY_KEY)); } catch (e) {}
    $("dayStart").value = (d && d.dayStart) || "08:00";
    $("dayEnd").value = (d && d.dayEnd) || "02:00";
  }
  function getDayWindow() {
    return { dayStart: $("dayStart").value || "08:00", dayEnd: $("dayEnd").value || "02:00" };
  }
  function saveDayWindow() { try { localStorage.setItem(DAY_KEY, JSON.stringify(getDayWindow())); } catch (e) {} }
  function dwHours() {
    const w = getDayWindow();
    const sm = window.FreeBusy.timeToMin(w.dayStart);
    let em = window.FreeBusy.timeToMin(w.dayEnd);
    if (em <= sm) em += 1440; // 翌日まで
    return { dayStart: w.dayStart, dayEnd: w.dayEnd, dayStartHour: sm / 60, dayEndHour: em / 60 };
  }

  // ---------- その他設定の記憶（最小空き/終日/タイトル/表示/テーマ） ----------
  const SET_IDS = ["minSlot", "allDayBusy", "title", "layout", "theme"];
  function saveSettings() {
    const o = {};
    SET_IDS.forEach((id) => { const el = $(id); o[id] = el.type === "checkbox" ? el.checked : el.value; });
    try { localStorage.setItem(SET_KEY, JSON.stringify(o)); } catch (e) {}
  }
  function loadSettings() {
    let o = null;
    try { o = JSON.parse(localStorage.getItem(SET_KEY)); } catch (e) {}
    if (!o) return;
    SET_IDS.forEach((id) => {
      if (o[id] == null) return;
      const el = $(id);
      if (el.type === "checkbox") el.checked = o[id]; else el.value = o[id];
    });
  }
  function saveCals() {
    try { localStorage.setItem(CAL_KEY, JSON.stringify(calendars.filter((c) => c.selected).map((c) => c.id))); } catch (e) {}
  }

  // ---------- 仕事の時間帯（カレンダー外・端末に記憶） ----------
  const WORK_KEY = "ft_work_v1", OFF_KEY = "ft_off_v1";

  const WD = ["日", "月", "火", "水", "木", "金", "土"];

  function setupWorkDefaults() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(WORK_KEY)); } catch (e) {}
    // 旧形式（daysなし）は「毎日」として移行
    if (saved && saved.length) saved.forEach((w) => addWorkRow(w.from, w.to, w.days || [0, 1, 2, 3, 4, 5, 6], w.weeks || [1, 2, 3, 4, 5]));
    else addWorkRow("09:00", "17:00", [1, 2, 3, 4, 5], [1, 2, 3, 4, 5]); // 既定は毎週平日

    let off = null;
    try { off = JSON.parse(localStorage.getItem(OFF_KEY)); } catch (e) {}
    if (off && off.length) off.forEach((o) => addOffRow(o.start, o.end));
  }

  function addWorkRow(from = "09:00", to = "17:00", days = [1, 2, 3, 4, 5], weeks = [1, 2, 3, 4, 5]) {
    const wrap = document.createElement("div");
    wrap.className = "work-row";
    const dowHtml = WD.map((w, i) =>
      `<button type="button" class="dow${days.includes(i) ? " on" : ""}" data-d="${i}">${w}</button>`
    ).join("");
    const weekHtml = [1, 2, 3, 4, 5].map((n) =>
      `<button type="button" class="week${weeks.includes(n) ? " on" : ""}" data-w="${n}">${n}</button>`
    ).join("");
    wrap.innerHTML = `
      <div class="dow-toggles">${dowHtml}</div>
      <div class="week-toggles"><span class="wlabel">第</span>${weekHtml}<span class="wlabel">週</span></div>
      <div class="exclude-row">
        <input type="time" class="wk-from" value="${from}" />
        <span>〜</span>
        <input type="time" class="wk-to" value="${to}" />
        <button class="del" title="削除">×</button>
      </div>`;
    wrap.querySelectorAll(".dow, .week").forEach((b) => (b.onclick = () => { b.classList.toggle("on"); saveWork(); }));
    wrap.querySelector(".del").onclick = () => { wrap.remove(); saveWork(); };
    wrap.querySelectorAll("input").forEach((i) => (i.onchange = saveWork));
    $("workList").appendChild(wrap);
  }
  function getWorkBands() {
    return [...document.querySelectorAll("#workList .work-row")].map((r) => ({
      from: r.querySelector(".wk-from").value || "00:00",
      to: r.querySelector(".wk-to").value || "00:00",
      days: [...r.querySelectorAll(".dow.on")].map((b) => +b.dataset.d),
      weeks: [...r.querySelectorAll(".week.on")].map((b) => +b.dataset.w),
    }));
  }
  function saveWork() { try { localStorage.setItem(WORK_KEY, JSON.stringify(getWorkBands())); } catch (e) {} }

  function addOffRow(start = "", end = "") {
    const row = document.createElement("div");
    row.className = "exclude-row";
    row.innerHTML = `
      <input type="date" class="off-from" value="${start}" />
      <span>〜</span>
      <input type="date" class="off-to" value="${end}" />
      <button class="del" title="削除">×</button>`;
    row.querySelector(".del").onclick = () => { row.remove(); saveOff(); };
    row.querySelectorAll("input").forEach((i) => (i.onchange = saveOff));
    $("offList").appendChild(row);
  }
  function getOffRanges() {
    return [...document.querySelectorAll("#offList .exclude-row")]
      .map((r) => ({ start: r.querySelector(".off-from").value, end: r.querySelector(".off-to").value }))
      .filter((o) => o.start);
  }
  function saveOff() { try { localStorage.setItem(OFF_KEY, JSON.stringify(getOffRanges())); } catch (e) {} }

  // 休みの日（期間）を YYYY-MM-DD の集合に展開
  function getOffDateSet() {
    const set = new Set();
    for (const o of getOffRanges()) {
      const s = new Date(o.start + "T00:00:00");
      if (isNaN(+s)) continue;
      const e = new Date((o.end || o.start) + "T00:00:00");
      let d = new Date(s);
      while (d <= e) { set.add(window.FreeBusy.dateKey(d)); d.setDate(d.getDate() + 1); }
    }
    return set;
  }

  // ---------- UI バインド ----------
  function bindUI() {
    $("signInBtn").onclick = () => tokenClient && tokenClient.requestAccessToken({ prompt: "" });
    $("signOutBtn").onclick = signOut;
    $("dayStart").onchange = saveDayWindow;
    $("dayEnd").onchange = saveDayWindow;
    SET_IDS.forEach((id) => $(id).addEventListener("change", saveSettings));
    $("addWorkBtn").onclick = () => { addWorkRow(); saveWork(); };
    $("addOffBtn").onclick = () => { addOffRow(); };
    $("generateBtn").onclick = generate;
    $("downloadBtn").onclick = download;
    $("shareBtn").onclick = share;
    document.querySelectorAll(".chip").forEach((c) => (c.onclick = () => applyQuick(c.dataset.quick)));
  }

  function applyQuick(kind) {
    const now = new Date();
    let s = new Date(now), e = new Date(now);
    s.setHours(9, 0, 0, 0); e.setHours(21, 0, 0, 0);
    if (kind === "3days") e.setDate(e.getDate() + 2);
    else if (kind === "week") { const dow = (s.getDay() + 6) % 7; s.setDate(s.getDate() - dow); e = new Date(s); e.setDate(s.getDate() + 6); e.setHours(21,0,0,0); }
    else if (kind === "nextweek") { const dow = (s.getDay() + 6) % 7; s.setDate(s.getDate() - dow + 7); e = new Date(s); e.setDate(s.getDate() + 6); e.setHours(21,0,0,0); }
    else if (kind === "2weeks") e.setDate(e.getDate() + 13);
    $("rangeStart").value = toLocalInput(s);
    $("rangeEnd").value = toLocalInput(e);
  }

  // ---------- 認証 ----------
  function onToken(resp) {
    if (resp.error) { setStatus("認証に失敗しました: " + resp.error, true); return; }
    accessToken = resp.access_token;
    $("signInBtn").hidden = true;
    $("signOutBtn").hidden = false;
    $("generateBtn").disabled = false;
    loadCalendars();
  }
  function signOut() {
    if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
    accessToken = null; calendars = [];
    $("signInBtn").hidden = false;
    $("signOutBtn").hidden = true;
    $("generateBtn").disabled = true;
    $("calendarList").innerHTML = "";
    $("calHint").hidden = false;
  }

  async function gapi(url) {
    const r = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
    if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`);
    return r.json();
  }

  // ---------- カレンダー一覧 ----------
  async function loadCalendars() {
    try {
      const data = await gapi("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader");
      let savedCals = null;
      try { savedCals = JSON.parse(localStorage.getItem(CAL_KEY)); } catch (e) {}
      calendars = (data.items || []).map((c) => ({
        id: c.id,
        summary: c.summaryOverride || c.summary,
        bgColor: c.backgroundColor || "#0f766e",
        selected: savedCals ? savedCals.includes(c.id) : (c.primary === true || c.selected === true),
      }));
      renderCalendars();
    } catch (e) {
      setStatus("カレンダー取得に失敗: " + e.message, true);
    }
  }

  function renderCalendars() {
    $("calHint").hidden = true;
    const box = $("calendarList");
    box.innerHTML = "";
    calendars.forEach((c, i) => {
      const el = document.createElement("div");
      el.className = "cal-item";
      el.innerHTML = `
        <span class="dot" style="background:${c.bgColor}"></span>
        <label for="cal_${i}">${escapeHtml(c.summary)}</label>
        <input type="checkbox" id="cal_${i}" ${c.selected ? "checked" : ""} />`;
      el.querySelector("input").onchange = (ev) => { c.selected = ev.target.checked; saveCals(); };
      box.appendChild(el);
    });
  }

  // ---------- 予定取得 ----------
  async function fetchBusy(rangeStart, rangeEnd, allDayBusy) {
    const selected = calendars.filter((c) => c.selected);
    if (selected.length === 0) throw new Error("カレンダーを1つ以上選択してください。");
    const busy = [];
    const allDayDates = new Set();
    const timeMin = rangeStart.toISOString();
    const timeMax = rangeEnd.toISOString();
    for (const cal of selected) {
      let pageToken = "";
      do {
        const url =
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events` +
          `?singleEvents=true&orderBy=startTime&maxResults=2500` +
          `&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
          (pageToken ? `&pageToken=${pageToken}` : "");
        const data = await gapi(url);
        for (const ev of data.items || []) {
          if (ev.transparency === "transparent") continue; // 「予定なし」表示は無視
          if (ev.status === "cancelled") continue;
          if (ev.start && ev.start.date) {
            // 終日予定
            if (allDayBusy) {
              let d = new Date(ev.start.date + "T00:00:00");
              const end = new Date((ev.end && ev.end.date ? ev.end.date : ev.start.date) + "T00:00:00");
              while (d < end) { allDayDates.add(window.FreeBusy.dateKey(d)); d.setDate(d.getDate() + 1); }
            }
            continue;
          }
          if (ev.start && ev.start.dateTime) {
            busy.push({ start: new Date(ev.start.dateTime), end: new Date(ev.end.dateTime) });
          }
        }
        pageToken = data.nextPageToken || "";
      } while (pageToken);
    }
    return { busy, allDayDates };
  }

  // ---------- 生成 ----------
  async function generate() {
    try {
      setStatus("予定を取得中…");
      $("generateBtn").disabled = true;
      const rangeStart = new Date($("rangeStart").value);
      const rangeEnd = new Date($("rangeEnd").value);
      if (!(rangeEnd > rangeStart)) throw new Error("終了は開始より後にしてください。");

      const allDayBusy = $("allDayBusy").checked;
      const { busy, allDayDates } = await fetchBusy(rangeStart, rangeEnd, allDayBusy);

      saveWork(); saveOff(); saveDayWindow(); saveSettings(); saveCals();
      const dw = dwHours();
      const days = window.FreeBusy.computeFreeSlots({
        rangeStart, rangeEnd, busy,
        dayStart: dw.dayStart, dayEnd: dw.dayEnd,
        workBands: getWorkBands(),
        offDateSet: getOffDateSet(),
        minMinutes: parseInt($("minSlot").value, 10),
        allDayBusyDates: allDayDates,
      });
      lastDays = days;
      draw(days, rangeStart, rangeEnd, dw);
      const total = days.reduce((n, d) => n + d.slots.length, 0);
      setStatus(`完了: ${days.length}日間で空き ${total} 枠`);
    } catch (e) {
      setStatus("エラー: " + e.message, true);
    } finally {
      $("generateBtn").disabled = false;
    }
  }

  function draw(days, rangeStart, rangeEnd, dw) {
    dw = dw || dwHours();
    window.Renderer.render($("preview"), days, {
      title: $("title").value,
      rangeStart, rangeEnd,
      layout: $("layout").value,
      theme: $("theme").value,
      dayStartHour: dw.dayStartHour,
      dayEndHour: dw.dayEndHour,
      scale: 4,
    });
    $("resultCard").hidden = false;
    $("resultCard").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- 保存 / 共有 ----------
  function fileName() {
    return `freetime_${$("rangeStart").value.slice(0,10)}.png`;
  }
  async function download() {
    const blob = await window.PngDpi.canvasToDpiPng($("preview"), 400);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function share() {
    const blob = await window.PngDpi.canvasToDpiPng($("preview"), 400);
    const file = new File([blob], fileName(), { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: $("title").value }); }
      catch (e) { /* キャンセル */ }
    } else {
      setStatus("この端末は共有に未対応です。保存をお使いください。", true);
    }
  }

  // ---------- ユーティリティ ----------
  function setStatus(msg, isError) {
    const el = $("status");
    el.textContent = msg;
    el.className = "status" + (isError ? " error" : "");
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // テスト/プレビュー用: ダミーデータで描画
  window.__demo = function () {
    const base = new Date(); base.setHours(0, 0, 0, 0);
    const rangeStart = new Date(base);
    const rangeEnd = new Date(base); rangeEnd.setDate(rangeEnd.getDate() + 5);
    const busy = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(base); d.setDate(d.getDate() + i);
      busy.push({ start: new Date(d.getTime() + 13 * 3600e3), end: new Date(d.getTime() + 15 * 3600e3) });
      if (i % 2 === 0) busy.push({ start: new Date(d.getTime() + 10 * 3600e3), end: new Date(d.getTime() + 11.5 * 3600e3) });
    }
    const dw = dwHours();
    const days = window.FreeBusy.computeFreeSlots({
      rangeStart, rangeEnd, busy,
      dayStart: dw.dayStart, dayEnd: dw.dayEnd,
      workBands: getWorkBands(),
      offDateSet: getOffDateSet(),
      minMinutes: 30, allDayBusyDates: new Set(),
    });
    draw(days, rangeStart, rangeEnd, dw);
    return days;
  };

  document.addEventListener("DOMContentLoaded", init);
})();
