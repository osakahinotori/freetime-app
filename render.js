// ===== 空き時間カレンダー画像の描画 =====
(function () {
  const THEMES = {
    teal:   { brand: "#0f766e", free: "#5eead4", freeInk: "#0f3d38", accent: "#0d9488" },
    indigo: { brand: "#4338ca", free: "#c7d2fe", freeInk: "#312e81", accent: "#6366f1" },
    rose:   { brand: "#be123c", free: "#fecdd3", freeInk: "#881337", accent: "#e11d48" },
    mono:   { brand: "#1f2937", free: "#d1d5db", freeInk: "#111827", accent: "#4b5563" },
  };
  const WD = ["日", "月", "火", "水", "木", "金", "土"];

  function fmtTime(d) {
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function fmtDateLabel(d) {
    return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
  }

  // 表示する時間帯の範囲（時）を slots から決定。
  function hourBounds(days) {
    let min = 24, max = 0, any = false;
    for (const day of days) {
      for (const s of day.slots) {
        any = true;
        min = Math.min(min, s.start.getHours() + s.start.getMinutes() / 60);
        const eh = s.end.getHours() + s.end.getMinutes() / 60;
        max = Math.max(max, eh === 0 ? 24 : eh);
      }
    }
    if (!any) return [8, 22];
    return [Math.floor(min), Math.ceil(Math.min(24, Math.max(max, min + 1)))];
  }

  // メイン描画。canvas を所定サイズにして描画。
  // opts: { title, rangeStart, rangeEnd, layout, theme }
  function render(canvas, days, opts) {
    const theme = THEMES[opts.theme] || THEMES.teal;
    const layout = opts.layout || "hybrid";
    const showGrid = layout === "grid" || layout === "hybrid";
    const showList = layout === "list" || layout === "hybrid";

    const DPR = opts.scale || 4; // 高解像度（400dpi相当）
    const W = 1000;              // 論理幅(px)
    const pad = 36;
    const headerH = 96;

    // --- 高さを内容から見積もり ---
    const [h0, h1] = hourBounds(days);
    const hourCount = Math.max(1, h1 - h0);
    const gridRowH = 34;          // 1時間あたりの高さ
    const dayHeaderH = 44;
    const gridH = showGrid ? dayHeaderH + hourCount * gridRowH : 0;

    // リスト部の高さ見積り
    let listLines = 0;
    if (showList) {
      for (const d of days) listLines += 1 + Math.max(1, d.slots.length);
    }
    const listH = showList ? 28 + listLines * 26 + 16 : 0;

    const totalH = headerH + (showGrid ? gridH + 24 : 0) + (showList ? listH + 8 : 0) + pad;

    canvas.width = W * DPR;
    canvas.height = totalH * DPR;
    const ctx = canvas.getContext("2d");
    ctx.scale(DPR, DPR);
    ctx.textBaseline = "alphabetic";

    // 背景
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, totalH);

    // ヘッダー
    ctx.fillStyle = theme.brand;
    ctx.fillRect(0, 0, W, headerH);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 30px -apple-system, 'Hiragino Sans', sans-serif";
    ctx.fillText(opts.title || "空き時間のご案内", pad, 48);
    ctx.font = "400 18px -apple-system, 'Hiragino Sans', sans-serif";
    const rs = new Date(opts.rangeStart), re = new Date(opts.rangeEnd);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText(`${fmtDateLabel(rs)} ${fmtTime(rs)} 〜 ${fmtDateLabel(re)} ${fmtTime(re)}`, pad, 76);

    let y = headerH + 24;

    // --- グリッド ---
    if (showGrid) {
      const axisW = 52;
      const gx = pad + axisW;
      const gw = W - pad - gx;
      const cols = days.length;
      const colW = gw / Math.max(1, cols);

      // 時間軸の目盛り
      ctx.strokeStyle = "#e7e5e4";
      ctx.lineWidth = 1;
      ctx.fillStyle = "#a8a29e";
      ctx.font = "400 13px -apple-system, sans-serif";
      ctx.textAlign = "right";
      for (let h = h0; h <= h1; h++) {
        const ly = y + dayHeaderH + (h - h0) * gridRowH;
        ctx.beginPath();
        ctx.moveTo(gx, ly);
        ctx.lineTo(gx + gw, ly);
        ctx.stroke();
        ctx.fillText(`${h}:00`, gx - 8, ly + 4);
      }
      ctx.textAlign = "left";

      // 列ヘッダ＋空きブロック
      for (let c = 0; c < cols; c++) {
        const day = days[c];
        const cx = gx + c * colW;
        // 列ヘッダ
        const isSun = day.date.getDay() === 0, isSat = day.date.getDay() === 6;
        ctx.fillStyle = isSun ? "#dc2626" : isSat ? "#2563eb" : "#44403c";
        ctx.font = "600 15px -apple-system, 'Hiragino Sans', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(fmtDateLabel(day.date), cx + colW / 2, y + 28);
        ctx.textAlign = "left";
        // 縦罫線
        ctx.strokeStyle = "#f5f5f4";
        ctx.beginPath();
        ctx.moveTo(cx, y + dayHeaderH);
        ctx.lineTo(cx, y + dayHeaderH + hourCount * gridRowH);
        ctx.stroke();

        // 空きブロック
        for (const s of day.slots) {
          const sh = s.start.getHours() + s.start.getMinutes() / 60;
          let eh = s.end.getHours() + s.end.getMinutes() / 60;
          if (eh === 0) eh = 24;
          const by = y + dayHeaderH + (sh - h0) * gridRowH;
          const bh = (eh - sh) * gridRowH;
          roundRect(ctx, cx + 3, by, colW - 6, Math.max(6, bh), 5);
          ctx.fillStyle = theme.free;
          ctx.fill();
          if (bh > 22) {
            ctx.fillStyle = theme.freeInk;
            ctx.font = "600 11px -apple-system, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(`${fmtTime(s.start)}`, cx + colW / 2, by + 14);
            ctx.textAlign = "left";
          }
        }
      }
      // 外枠
      ctx.strokeStyle = "#e7e5e4";
      ctx.strokeRect(gx, y + dayHeaderH, gw, hourCount * gridRowH);
      ctx.strokeRect(gx + gw, y + dayHeaderH, 0, 0);
      y += gridH + 24;
    }

    // --- リスト ---
    if (showList) {
      ctx.fillStyle = theme.accent;
      ctx.font = "700 17px -apple-system, 'Hiragino Sans', sans-serif";
      ctx.fillText("空き時間", pad, y + 4);
      y += 28;
      ctx.font = "400 15px -apple-system, 'Hiragino Sans', sans-serif";
      for (const day of days) {
        const isSun = day.date.getDay() === 0, isSat = day.date.getDay() === 6;
        ctx.fillStyle = isSun ? "#dc2626" : isSat ? "#2563eb" : "#1c1917";
        ctx.font = "600 15px -apple-system, 'Hiragino Sans', sans-serif";
        ctx.fillText(fmtDateLabel(day.date), pad, y + 16);
        ctx.font = "400 15px -apple-system, sans-serif";
        ctx.fillStyle = "#57534e";
        if (day.slots.length === 0) {
          ctx.fillStyle = "#a8a29e";
          ctx.fillText("空きなし", pad + 110, y + 16);
          y += 26;
        } else {
          let first = true;
          for (const s of day.slots) {
            const txt = `${fmtTime(s.start)}–${fmtTime(s.end)}`;
            ctx.fillStyle = "#44403c";
            ctx.fillText(txt, pad + 110, y + 16);
            y += 26;
            first = false;
          }
        }
        // 区切り線
        ctx.strokeStyle = "#f5f5f4";
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(W - pad, y);
        ctx.stroke();
      }
    }

    return { width: canvas.width, height: canvas.height };
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  window.Renderer = { render };
})();
