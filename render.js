// ===== 空き時間カレンダー画像の描画 =====
(function () {
  const THEMES = {
    patriots: { brand: "#002244", free: "#c60c30", freeInk: "#ffffff", accent: "#c60c30" },
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

  // 表示する時間帯の範囲（時・24超あり＝翌日）を決定。
  // opts.dayStartHour/dayEndHour があればそれを軸に、無ければ slots から。
  function hourBounds(days, opts) {
    if (opts && opts.dayStartHour != null && opts.dayEndHour != null) {
      return [Math.floor(opts.dayStartHour), Math.ceil(opts.dayEndHour)];
    }
    let min = 24, max = 0, any = false;
    for (const day of days) {
      for (const s of day.slots) {
        any = true;
        min = Math.min(min, s.sh != null ? s.sh : s.start.getHours() + s.start.getMinutes() / 60);
        const eh = s.eh != null ? s.eh : s.end.getHours() + s.end.getMinutes() / 60;
        max = Math.max(max, eh === 0 ? 24 : eh);
      }
    }
    if (!any) return [8, 22];
    return [Math.floor(min), Math.ceil(Math.max(max, min + 1))];
  }

  // メイン描画。canvas を所定サイズにして描画。
  // opts: { title, rangeStart, rangeEnd, layout, theme }
  function render(canvas, days, opts) {
    const theme = THEMES[opts.theme] || THEMES.patriots;
    const layout = opts.layout || "hybrid";
    const showGrid = layout === "grid" || layout === "hybrid";
    const showList = layout === "list" || layout === "hybrid";

    let DPR = opts.scale || 4;   // 描画後に端末のcanvas上限内で最大化する
    const W = 1000;              // 論理幅(px)
    const pad = 36;
    const headerH = 96;

    // --- 高さを内容から見積もり ---
    const [h0, h1] = hourBounds(days, opts);
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

    // --- 解像度(DPR)を端末のcanvas上限内で最大化して400dpiでも鮮明に ---
    // 端末ごとにcanvas面積の上限がある。超えるとブラウザ内部で縮小され画像が粗くなるため、
    // 上限ぎりぎりまでDPRを上げ、超えそうなら自動で下げてクリアな画像を保つ。
    //  iOS Safari … 約16.7M px が硬い上限／Android Chrome … メモリ依存だがもっと大きい
    const ua = navigator.userAgent || "";
    const isIOS = /iP(hone|ad|od)/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    const MAX_CANVAS_PX = isIOS ? 16000000 : isAndroid ? 44000000 : 64000000;
    const fit = Math.sqrt(MAX_CANVAS_PX / (W * totalH));
    DPR = Math.max(3, Math.min(fit, 12));
    if (W * totalH * DPR * DPR > MAX_CANVAS_PX) DPR = fit; // 上限超過なら面積に合わせる

    // 実機がそのサイズのcanvasを本当に確保できるか検証し、ダメなら自動で段階的に下げる。
    // （UA判定が外れても・端末が想定より非力でも、必ず鮮明＝縮小されない画像になるようにする）
    let ctx;
    for (let attempt = 0; ; attempt++) {
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(totalH * DPR);
      ctx = canvas.getContext("2d");
      let ok = false;
      if (ctx) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(canvas.width - 1, canvas.height - 1, 1, 1); // 端のピクセルを書いて
        try { ok = ctx.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data[3] !== 0; } // 読み戻せるか
        catch (e) { ok = false; }
      }
      if (ok || DPR <= 2 || attempt >= 8) break;
      DPR *= 0.85; // 確保できなかった→1段下げて再挑戦
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(canvas.width / W, canvas.height / totalH);
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
        ctx.fillText(`${h % 24}:00`, gx - 8, ly + 4); // 24超は翌日（25→1:00）
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

        // 空きブロック（sh/eh = 論理日0:00からの時間。24超＝翌日）
        for (const s of day.slots) {
          const sh = s.sh != null ? s.sh : s.start.getHours() + s.start.getMinutes() / 60;
          let eh = s.eh != null ? s.eh : s.end.getHours() + s.end.getMinutes() / 60;
          if (s.eh == null && eh === 0) eh = 24;
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
