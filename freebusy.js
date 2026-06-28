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
  function computeFreeSlots(opts) {
    const rangeStart = new Date(opts.rangeStart);
    const rangeEnd = new Date(opts.rangeEnd);
    const minMs = (opts.minMinutes || 0) * MS_MIN;
    const busy = mergeIntervals(opts.busy || []);
    const allDayBusy = opts.allDayBusyDates || new Set();
    const workBands = opts.workBands || []; // カレンダー外の毎日の予定（仕事など）
    const offDateSet = opts.offDateSet || new Set(); // 仕事が休みの日（YYYY-MM-DD）

    const days = [];
    let cursor = startOfDay(rangeStart);
    while (+cursor <= +rangeEnd) {
      const dayStart = +cursor;
      const dayEnd = dayStart + 1440 * MS_MIN;
      const key = dateKey(cursor);

      // この日の候補窓 = [range内のその日の範囲]
      const winStart = Math.max(dayStart, +rangeStart);
      const winEnd = Math.min(dayEnd, +rangeEnd);
      let free = [];
      if (winEnd > winStart && !allDayBusy.has(key)) {
        free = [{ start: winStart, end: winEnd }];
        // 除外時間帯（夜間など）を引く
        free = subtractIntervals(free, excludeIntervalsForDay(cursor, opts.excludeRanges || []));
        // カレンダー外の仕事の時間帯を引く（休みの日は無視）
        if (workBands.length && !offDateSet.has(key)) {
          free = subtractIntervals(free, excludeIntervalsForDay(cursor, workBands));
        }
        // 予定を引く
        free = subtractIntervals(free, busy);
        // 最小長フィルタ
        free = free.filter((f) => f.end - f.start >= minMs);
      }
      days.push({
        date: new Date(dayStart),
        key,
        slots: free.map((f) => ({ start: new Date(f.start), end: new Date(f.end) })),
      });
      cursor = new Date(dayStart + 1440 * MS_MIN);
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
