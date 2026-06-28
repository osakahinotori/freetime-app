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
    setupExcludeDefaults();
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
  function setupExcludeDefaults() {
    addExcludeRow("22:00", "08:00");
  }

  function addExcludeRow(from = "22:00", to = "08:00") {
    const row = document.createElement("div");
    row.className = "exclude-row";
    row.innerHTML = `
      <input type="time" class="ex-from" value="${from}" />
      <span>〜</span>
      <input type="time" class="ex-to" value="${to}" />
      <button class="del" title="削除">×</button>`;
    row.querySelector(".del").onclick = () => row.remove();
    $("excludeList").appendChild(row);
  }

  function getExcludeRanges() {
    return [...document.querySelectorAll(".exclude-row")].map((r) => ({
      from: r.querySelector(".ex-from").value || "00:00",
      to: r.querySelector(".ex-to").value || "00:00",
    }));
  }

  // ---------- UI バインド ----------
  function bindUI() {
    $("signInBtn").onclick = () => tokenClient && tokenClient.requestAccessToken({ prompt: "" });
    $("signOutBtn").onclick = signOut;
    $("addExcludeBtn").onclick = () => addExcludeRow();
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
      calendars = (data.items || []).map((c) => ({
        id: c.id,
        summary: c.summaryOverride || c.summary,
        bgColor: c.backgroundColor || "#0f766e",
        selected: c.primary === true || c.selected === true,
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
      el.querySelector("input").onchange = (ev) => (c.selected = ev.target.checked);
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

      const days = window.FreeBusy.computeFreeSlots({
        rangeStart, rangeEnd, busy,
        excludeRanges: getExcludeRanges(),
        minMinutes: parseInt($("minSlot").value, 10),
        allDayBusyDates: allDayDates,
      });
      lastDays = days;
      draw(days, rangeStart, rangeEnd);
      const total = days.reduce((n, d) => n + d.slots.length, 0);
      setStatus(`完了: ${days.length}日間で空き ${total} 枠`);
    } catch (e) {
      setStatus("エラー: " + e.message, true);
    } finally {
      $("generateBtn").disabled = false;
    }
  }

  function draw(days, rangeStart, rangeEnd) {
    window.Renderer.render($("preview"), days, {
      title: $("title").value,
      rangeStart, rangeEnd,
      layout: $("layout").value,
      theme: $("theme").value,
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
    const rangeStart = new Date(base); rangeStart.setHours(9, 0, 0, 0);
    const rangeEnd = new Date(base); rangeEnd.setDate(rangeEnd.getDate() + 4); rangeEnd.setHours(21, 0, 0, 0);
    const busy = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(base); d.setDate(d.getDate() + i);
      busy.push({ start: new Date(d.getTime() + 13 * 3600e3), end: new Date(d.getTime() + 15 * 3600e3) });
      if (i % 2 === 0) busy.push({ start: new Date(d.getTime() + 10 * 3600e3), end: new Date(d.getTime() + 11.5 * 3600e3) });
    }
    const days = window.FreeBusy.computeFreeSlots({
      rangeStart, rangeEnd, busy,
      excludeRanges: getExcludeRanges(),
      minMinutes: 30, allDayBusyDates: new Set(),
    });
    draw(days, rangeStart, rangeEnd);
    return days;
  };

  document.addEventListener("DOMContentLoaded", init);
})();
