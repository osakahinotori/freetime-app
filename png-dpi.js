// ===== PNG に物理解像度(pHYs)チャンクを埋め込んで DPI を設定する =====
(function () {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u32(n) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }

  // dataURL(PNG) を受け取り、指定DPIの pHYs を挿入した Blob を返す。
  function setDpi(pngArrayBuffer, dpi) {
    const data = new Uint8Array(pngArrayBuffer);
    // pHYs: pixels per meter = dpi / 0.0254
    const ppm = Math.round(dpi / 0.0254);
    const type = [0x70, 0x48, 0x59, 0x73]; // "pHYs"
    const chunkData = [...u32(ppm), ...u32(ppm), 1]; // x, y, unit=1(meter)
    const lenAndType = [...u32(chunkData.length), ...type, ...chunkData];
    const crc = crc32(new Uint8Array([...type, ...chunkData]));
    const phys = new Uint8Array([...lenAndType, ...u32(crc)]);

    // IHDR の直後（最初のチャンク後）に挿入する。
    // PNG署名(8) + IHDR: length(4)+type(4)+data(13)+crc(4) = 8 + 25 = 33
    const insertAt = 8 + 4 + 4 + 13 + 4;
    const out = new Uint8Array(data.length + phys.length);
    out.set(data.subarray(0, insertAt), 0);
    out.set(phys, insertAt);
    out.set(data.subarray(insertAt), insertAt + phys.length);
    return new Blob([out], { type: "image/png" });
  }

  // canvas → 400dpi PNG Blob
  async function canvasToDpiPng(canvas, dpi) {
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    const buf = await blob.arrayBuffer();
    return setDpi(buf, dpi);
  }

  window.PngDpi = { setDpi, canvasToDpiPng };
})();
