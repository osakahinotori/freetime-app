// ===== 空き時間の計算ロジック（外部依存なし・テスト可能） =====
(function () {
  const MS_MIN = 60 * 1000;

  // 区間配列をマージ（重なり・隣接を統合）。区間は {start, end}（Date or ms）。
  function mergeIntervals(intervals) {
    const arr = intervals
      .map((i) => ({ start: +i.start, end: +i.end }))
      .filter((i) => i.end > i.start)
      .sort((a, b) => a.start - b.start);
    const out = [];
    for (const cur of arr) {
      const last = out[out.length - 1];
      if (last && cur.start <= last.end) {
        last.end = Math.max(last.end, cur.end);
      } else {
        out.push({ ...cur });
      }
    }
    return out;
  }

  // base 区間群から sub 区間群を差し引く。
  function subtractIntervals(base, sub) {
    const subs = mergeIntervals(sub);
    let result = base.map((b) => ({ start: +b.start, end: +b.end }));
    for (const s of subs) {
      const next = [];
      for (const b of result) {
        if (s.end <= b.start || s.start >= b.end) {
          next.push(b); // 重なりなし
        } else {
          if (b.start < s.start) next.push({ start: b.start, end: s.start });
          if (s.end < b.end) next.push({ start: s.end, end: b.end });
        }
      }
      result = next;
    }
    return result.filter((r) => r.end > r.start);
  }

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  // "HH:MM" → 0時からの分数
  function timeToMin(s) {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  }

  // ある日について、除外時間帯を具体的な区間に展開（日跨ぎ対応）。
  function excludeIntervalsForDay(dayStart, excludeRanges) {
    const out = [];
    const day0 = +startOfDay(dayStart);
    for (const r of excludeRanges) {
      const from = timeToMin(r.from);
      const to = timeToMin(r.to);
      if (from === to) continue;
      if (from < to) {
        out.push({ start: day0 + from * MS_MIN, end: day0 + to * MS_MIN });
      } else {
        // 日跨ぎ: その日の from→24:00 と、当日 00:00→to
        out.push({ start: day0 + from * MS_MIN, end: day0 + 1440 * MS_MIN });
        out.push({ start: day0, end: day0 + to * MS_MIN });
      }
    }
    return out;
  }

  // メイン: 空き時間を日別に算出。
  // opts: { rangeStart, rangeEnd, busy:[{start,end}], excludeRanges:[{from,to}],
  //         minMinutes, allDayBusyDates:Set<'YYYY-MM-DD'> }
  // その月で「その曜日が何回目か」= 第N週（1..5）
  function weekOfMonth(d) {
    return Math.ceil(d.getDate() / 7);
  }

  function computeFreeSlots(opts) {
    const rangeStart = new Date(opts.rangeStart);
    const rangeEnd = new Date(opts.rangeEnd);
    const minMs = (opts.minMinutes || 0) * MS_MIN;
    const busy = mergeIntervals(opts.busy || []);
    const allDayBusy = opts.allDayBusyDates || new Set();
    const workBands = opts.workBands || []; // カレンダー外の予定（仕事など）
    const offDateSet = opts.offDateSet || new Set(); // 仕事が休みの日（YYYY-MM-DD）

    // 1日の時間帯（例: 8:00〜翌2:00）。終了が開始以下なら日跨ぎ
    const dayStartMin = timeToMin(opts.dayStart || "00:00");
    let dayEndMin = timeToMin(opts.dayEnd || "24:00");
    if (opts.dayEnd && dayEndMin <= dayStartMin) dayEndMin += 1440;

    const days = [];
    let cursor = startOfDay(rangeStart);
    while (+cursor <= +rangeEnd) {
      const base = +cursor; // その論理日の 00:00
      const key = dateKey(cursor);

      // この論理日の窓 = [base+開始, base+終了]（range にクリップ）
      const winStart = Math.max(base + dayStartMin * MS_MIN, +rangeStart);
      const winEnd = Math.min(base + dayEndMin * MS_MIN, +rangeEnd);
      let free = [];
      if (winEnd > winStart && !allDayBusy.has(key)) {
        free = [{ start: winStart, end: winEnd }];
        // カレンダー外の仕事の時間帯を引く（曜日＋第N週が一致するバンドのみ・休みの日は無視）
        if (workBands.length && !offDateSet.has(key)) {
          const dow = cursor.getDay();      // 0=日 .. 6=土
          const wom = weekOfMonth(cursor);  // 第N週
          const todays = workBands.filter((b) =>
            (b.days == null || b.days.includes(dow)) &&
            (b.weeks == null || b.weeks.length === 0 || b.weeks.includes(wom))
          );
          if (todays.length) {
            free = subtractIntervals(free, excludeIntervalsForDay(cursor, todays));
          }
        }
        // 予定を引く
        free = subtractIntervals(free, busy);
        // 最小長フィルタ
        free = free.filter((f) => f.end - f.start >= minMs);
      }
      days.push({
        date: new Date(base),
        key,
        // sh/eh = base 00:00 からの時間（24超あり＝翌日）
        slots: free.map((f) => ({
          start: new Date(f.start),
          end: new Date(f.end),
          sh: (f.start - base) / 3600000,
          eh: (f.end - base) / 3600000,
        })),
      });
      cursor = new Date(base + 1440 * MS_MIN);
    }
    return days;
  }

  function dateKey(d) {
    const x = new Date(d);
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, "0");
    const day = String(x.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  window.FreeBusy = {
    mergeIntervals,
    subtractIntervals,
    computeFreeSlots,
    timeToMin,
    dateKey,
  };
})();
