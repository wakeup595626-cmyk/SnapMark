/* SnapMark · 批量截图标注工具
 * 全部在浏览器本地运行，不上传任何数据。
 */

(function () {
  "use strict";

  // ---------- 状态 ----------
  const state = {
    images: [], // { file, name, imgEl, url }
    currentIndex: -1,
    settings: {
      template: "{姓名} {学号} {班级}",
      nameTemplate: "{姓名}_{学号}_{班级}_{序号}",
      meta: { 姓名: "", 学号: "", 班级: "" },
      position: "bottom-center",
      fontSizePct: 4,
      opacity: 55,
      textColor: "#ffffff",
      bgColor: "#000000",
      showBar: true,
      outFormat: "png",
      batchMode: "none",
      matchBy: "order",
      exportLimit: "",
      roster: null, // { columns: [], rows: [{}], map: {name,id,cls}, hasHeader: bool }
    },
  };

  const STORE_KEY = "snapmark.settings.v2";
  const MAX_PERSIST_ROWS = 2000;

  const NAME_KEYS = ["姓名", "名字", "学生姓名", "学生", "人员", "name"];
  const ID_KEYS = ["学号", "学籍号", "编号", "考生号", "工号", "id"];
  const CLASS_KEYS = ["班级", "班别", "所在班级", "行政班", "class"];

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const dropzone = $("dropzone");
  const fileInput = $("file-input");
  const imageList = $("image-list");
  const previewCanvas = $("preview-canvas");
  const emptyTip = $("empty-tip");
  const previewName = $("preview-name");
  const previewMeta = $("preview-meta");
  const btnExport = $("btn-export");
  const btnClear = $("btn-clear");
  const btnPrev = $("btn-prev");
  const btnNext = $("btn-next");
  const btnDownloadCurrent = $("btn-download-current");
  const exportCount = $("export-count");

  // ---------- 通用工具 ----------
  function sanitizeFilePart(s) {
    return (s || "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[_.]+|[_.]+$/g, "");
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function padSeq(n, total) {
    return String(n).padStart(String(total).length, "0");
  }

  /** 通用模板替换：任何 {列名} 都会被替换 */
  function fillTemplate(tpl, vars) {
    return String(tpl || "").replace(/\{([^{}]+)\}/g, (m, rawKey) => {
      const key = rawKey.trim();
      const v = vars[key];
      return v === undefined || v === null || v === "" ? "" : String(v);
    });
  }

  function hexToRgba(hex, alpha) {
    const m = hex.replace("#", "");
    const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
    const n = parseInt(v, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function truncateLines(ctx, text, maxWidth, maxLines) {
    const lines = [];
    let current = "";
    for (const ch of text) {
      const test = current + ch;
      if (ctx.measureText(test).width <= maxWidth || !current) {
        current = test;
      } else {
        lines.push(current);
        current = ch;
        if (lines.length === maxLines) break;
      }
    }
    if (current && lines.length < maxLines) lines.push(current);
    if (lines.length === maxLines) {
      let last = lines[lines.length - 1];
      while (ctx.measureText(last + "…").width > maxWidth && last.length > 0) {
        last = last.slice(0, -1);
      }
      lines[lines.length - 1] = last + "…";
    }
    return lines;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- 名单解析 ----------
  /** 编码智能识别：BOM → UTF-8，出现乱码回退 GBK（兼容中文 Excel 导出的 CSV） */
  function decodeTextSmart(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return new TextDecoder("utf-8").decode(bytes.subarray(3));
    }
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder("utf-16be").decode(bytes.subarray(2));
    }
    const utf8 = new TextDecoder("utf-8").decode(bytes);
    if (utf8.indexOf("\uFFFD") !== -1) {
      try {
        return new TextDecoder("gbk").decode(bytes);
      } catch (_) {
        return utf8;
      }
    }
    return utf8;
  }

  function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== "") || "";
    const counts = { "\t": 0, ",": 0, ";": 0 };
    for (const ch of firstLine) if (ch in counts) counts[ch]++;
    let best = "\t",
      bestN = -1;
    for (const d in counts) {
      if (counts[d] > bestN) {
        bestN = counts[d];
        best = d;
      }
    }
    return bestN <= 0 ? "," : best;
  }

  /** RFC4180 风格的定界符解析，支持引号转义 */
  function parseDelimited(text, delim) {
    const rows = [];
    let row = [],
      field = "",
      inQuotes = false;
    const s = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') {
            field += '"';
            i++;
          } else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === delim) {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c !== "\r") {
        field += c;
      }
    }
    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows
      .map((r) => r.map((c) => String(c).trim()))
      .filter((r) => r.some((c) => c !== ""));
  }

  function parseXlsx(buffer) {
    if (typeof XLSX === "undefined") {
      throw new Error("Excel 解析组件未加载，请改用 CSV 或直接粘贴");
    }
    const wb = XLSX.read(buffer, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    });
    return rows
      .map((r) => r.map((c) => String(c == null ? "" : c).trim()))
      .filter((r) => r.some((c) => c !== ""));
  }

  function looksLikeHeader(row) {
    const all = NAME_KEYS.concat(ID_KEYS, CLASS_KEYS).map((k) => k.toLowerCase());
    return row.some((cell) => {
      const c = String(cell || "").toLowerCase().trim();
      return c && all.some((k) => c === k || c.indexOf(k) !== -1);
    });
  }

  function findColumnIndex(columns, keys) {
    const lower = columns.map((c) => String(c).toLowerCase().trim());
    for (const k of keys) {
      const kl = k.toLowerCase();
      const exact = lower.findIndex((c) => c === kl);
      if (exact !== -1) return exact;
    }
    for (const k of keys) {
      const kl = k.toLowerCase();
      const part = lower.findIndex((c) => c && c.indexOf(kl) !== -1);
      if (part !== -1) return part;
    }
    return -1;
  }

  /** 把二维数组转成 { columns, rows, map, hasHeader } */
  function buildRoster(matrix) {
    if (!matrix.length) throw new Error("名单内容为空");

    const hasHeader = looksLikeHeader(matrix[0]);
    const width = matrix.reduce((m, r) => Math.max(m, r.length), 0);
    let columns;
    let bodyRows;

    if (hasHeader) {
      columns = [];
      for (let i = 0; i < width; i++) {
        columns.push((matrix[0][i] || "").trim() || `列${i + 1}`);
      }
      bodyRows = matrix.slice(1);
    } else {
      columns = [];
      const positional = ["姓名", "学号", "班级"];
      for (let i = 0; i < width; i++) {
        columns.push(positional[i] || `列${i + 1}`);
      }
      bodyRows = matrix;
    }

    // 去重列名
    const seen = {};
    columns = columns.map((c) => {
      if (seen[c] === undefined) {
        seen[c] = 0;
        return c;
      }
      seen[c]++;
      return `${c}_${seen[c]}`;
    });

    const rows = bodyRows.map((r) => {
      const obj = {};
      columns.forEach((c, i) => {
        obj[c] = (r[i] === undefined ? "" : String(r[i])).trim();
      });
      return obj;
    });

    const map = {
      name: findColumnIndex(columns, NAME_KEYS),
      id: findColumnIndex(columns, ID_KEYS),
      cls: findColumnIndex(columns, CLASS_KEYS),
    };

    return { columns, rows, map, hasHeader };
  }

  // ---------- 图片管理 ----------
  function addFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    files.forEach((f) => {
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        if (state.currentIndex === -1) state.currentIndex = 0;
        renderList();
        renderPreview();
        updateButtons();
      };
      img.src = url;
      state.images.push({ file: f, name: f.name, imgEl: img, url });
    });
  }

  function removeImage(index) {
    const item = state.images[index];
    if (!item) return;
    URL.revokeObjectURL(item.url);
    state.images.splice(index, 1);
    if (state.currentIndex >= state.images.length) {
      state.currentIndex = state.images.length - 1;
    }
    renderList();
    renderPreview();
    updateButtons();
  }

  function clearAll() {
    state.images.forEach((i) => URL.revokeObjectURL(i.url));
    state.images = [];
    state.currentIndex = -1;
    renderList();
    renderPreview();
    updateButtons();
  }

  function renderList() {
    imageList.innerHTML = "";
    state.images.forEach((item, idx) => {
      const li = document.createElement("li");
      li.className = idx === state.currentIndex ? "active" : "";

      const thumb = document.createElement("img");
      thumb.src = item.url;
      thumb.alt = item.name;

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = item.name;
      name.title = item.name;

      const remove = document.createElement("button");
      remove.className = "remove";
      remove.textContent = "×";
      remove.title = "移除";
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        removeImage(idx);
      });

      li.appendChild(thumb);
      li.appendChild(name);
      li.appendChild(remove);
      li.addEventListener("click", () => {
        state.currentIndex = idx;
        renderList();
        renderPreview();
        updateButtons();
      });
      imageList.appendChild(li);
    });
  }

  // ---------- 名单状态 ----------
  function rosterActive() {
    const r = state.settings.roster;
    return !!(r && r.rows && r.rows.length);
  }

  function rosterCount() {
    return rosterActive() ? state.settings.roster.rows.length : 0;
  }

  /** 把某一行名单转成模板变量，并叠加全局 meta 作为兜底 */
  function varsFromEntry(entry) {
    const vars = Object.assign({}, state.settings.meta);
    if (entry) for (const k in entry) vars[k] = entry[k];
    return vars;
  }

  function setRoster(roster) {
    state.settings.roster = roster;
    saveSettings();
    renderRoster();
    renderPreview();
    updateButtons();
  }

  function clearRoster() {
    state.settings.roster = null;
    $("roster-input").value = "";
    $("roster-paste").value = "";
    setRoster(null);
  }

  function renderRoster() {
    const r = state.settings.roster;
    const badge = $("roster-badge");
    const preview = $("roster-preview");
    const mapField = $("map-field");
    const limitField = $("limit-field");
    const matchField = $("match-field");

    if (!rosterActive()) {
      badge.textContent = "未导入";
      badge.className = "badge";
      preview.hidden = true;
      preview.innerHTML = "";
      mapField.hidden = true;
      limitField.hidden = true;
      matchField.hidden = true;
      $("btn-clear-roster").disabled = true;
      return;
    }

    badge.textContent = `${r.rows.length} 人`;
    badge.className = "badge ok";
    mapField.hidden = false;
    limitField.hidden = false;
    matchField.hidden = state.settings.batchMode !== "one-to-one";
    $("btn-clear-roster").disabled = false;

    // 列映射下拉
    [["map-name", "name"], ["map-id", "id"], ["map-class", "cls"]].forEach(
      ([selId, key]) => {
        const sel = $(selId);
        const current = r.map[key];
        sel.innerHTML =
          `<option value="-1">（未指定）</option>` +
          r.columns
            .map(
              (c, i) =>
                `<option value="${i}"${i === current ? " selected" : ""}>${esc(c)}</option>`
            )
            .join("");
      }
    );

    // 预览表格
    const head = r.columns.map((c) => `<th>${esc(c)}</th>`).join("");
    const body = r.rows
      .slice(0, 5)
      .map(
        (row) =>
          `<tr>${r.columns.map((c) => `<td>${esc(row[c])}</td>`).join("")}</tr>`
      )
      .join("");
    const more =
      r.rows.length > 5
        ? `<div class="more">…… 共 ${r.rows.length} 条，此处显示前 5 条</div>`
        : "";

    preview.hidden = false;
    preview.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${more}`;
  }

  /** 按列映射，把名单行整理成统一字段 姓名/学号/班级 */
  function mappedEntries() {
    const r = state.settings.roster;
    if (!r) return [];
    return r.rows.map((row, i) => {
      const out = Object.assign({}, row);
      const cols = r.columns;
      const pick = (idx) => (idx >= 0 && idx < cols.length ? row[cols[idx]] : "");
      const name = pick(r.map.name);
      const id = pick(r.map.id);
      const cls = pick(r.map.cls);
      if (name) out["姓名"] = name;
      if (id) out["学号"] = id;
      if (cls) out["班级"] = cls;
      out["名单序号"] = String(i + 1);
      return out;
    });
  }

  /** 文件名匹配：取命中长度最长的学生，避免"张三"误配"张三丰" */
  function matchByFilename(imgName, entries) {
    const base = String(imgName).replace(/\.[^.]+$/, "");
    let best = null,
      bestLen = 0;
    for (const e of entries) {
      for (const key of ["姓名", "学号"]) {
        const v = String(e[key] || "").trim();
        if (v && base.indexOf(v) !== -1 && v.length > bestLen) {
          best = e;
          bestLen = v.length;
        }
      }
    }
    return best;
  }

  // ---------- 任务编排 ----------
  /** 生成导出任务列表；同时返回提示与错误 */
  function computeJobs() {
    const s = state.settings;
    const warnings = [];
    const errors = [];
    const jobs = [];
    const entries = mappedEntries();
    const total = state.images.length;

    if (!total) return { jobs, warnings, errors: ["请先导入图片"] };

    if (s.batchMode === "none" || !rosterActive()) {
      state.images.forEach((img, i) => {
        jobs.push({
          img,
          vars: varsFromEntry(null),
          entry: null,
          seq: i + 1,
          total,
        });
      });
    } else if (s.batchMode === "one-to-many") {
      const baseIdx = state.currentIndex >= 0 ? state.currentIndex : 0;
      const base = state.images[baseIdx];
      entries.forEach((entry, i) => {
        jobs.push({
          img: base,
          vars: varsFromEntry(entry),
          entry,
          seq: i + 1,
          total: entries.length,
        });
      });
    } else if (s.batchMode === "one-to-one") {
      if (s.matchBy === "filename") {
        let unmatched = 0;
        state.images.forEach((img) => {
          const entry = matchByFilename(img.name, entries);
          if (entry) {
            jobs.push({
              img,
              vars: varsFromEntry(entry),
              entry,
              seq: jobs.length + 1,
              total: 0,
            });
          } else {
            unmatched++;
          }
        });
        if (unmatched) {
          warnings.push(
            `${unmatched} 张图片的文件名里没找到对应学生，已跳过（建议文件名含姓名或学号）`
          );
        }
        jobs.forEach((j, i) => {
          j.seq = i + 1;
          j.total = jobs.length;
        });
      } else {
        const n = Math.min(total, entries.length);
        if (total !== entries.length) {
          warnings.push(
            `图片 ${total} 张、名单 ${entries.length} 人，数量不一致，只处理前 ${n} 组`
          );
        }
        for (let i = 0; i < n; i++) {
          jobs.push({
            img: state.images[i],
            vars: varsFromEntry(entries[i]),
            entry: entries[i],
            seq: i + 1,
            total: n,
          });
        }
      }
    }

    // 导出数量限制
    const limit = parseInt(s.exportLimit, 10);
    let limited = jobs;
    if (!isNaN(limit) && limit > 0 && limit < jobs.length) {
      limited = jobs.slice(0, limit);
      warnings.push(`已按数量限制只导出前 ${limit} 张`);
    }

    if (!limited.length && !errors.length) errors.push("没有可导出的内容");
    return { jobs: limited, warnings, errors };
  }

  // ---------- 绘制 ----------
  function drawAnnotated(ctx, img, vars, seq, total) {
    const s = state.settings;
    const w = img.naturalWidth,
      h = img.naturalHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const scope = Object.assign({}, vars, {
      序号: padSeq(seq, total),
    });
    const text = fillTemplate(s.template, scope).trim();
    if (!text) return;

    const shortSide = Math.min(w, h);
    const fontSize = Math.max(12, Math.round((shortSide * s.fontSizePct) / 100));
    ctx.font = `600 ${fontSize}px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    const lines = truncateLines(ctx, text, w * 0.86, 3);
    const lineHeight = fontSize * 1.35;
    const padX = fontSize * 0.9;
    const padY = fontSize * 0.7;

    let maxLineW = 0;
    lines.forEach((l) => {
      maxLineW = Math.max(maxLineW, ctx.measureText(l).width);
    });
    const barW = maxLineW + padX * 2;
    const barH = lines.length * lineHeight + padY * 2;
    const margin = Math.round(shortSide * 0.03);

    const { x, y } = computeAnchor(s.position, w, h, margin, barW, barH);

    if (s.showBar) {
      ctx.fillStyle = hexToRgba(s.bgColor, s.opacity / 100);
      roundRect(ctx, x - barW / 2, y - barH / 2, barW, barH, Math.min(12, fontSize * 0.5));
      ctx.fill();
    }

    ctx.fillStyle = s.textColor;
    let startY = y - (lines.length * lineHeight) / 2 + lineHeight / 2;
    lines.forEach((l) => {
      ctx.fillText(l, x, startY);
      startY += lineHeight;
    });
  }

  function computeAnchor(pos, w, h, margin, barW, barH) {
    const halfW = barW / 2,
      halfH = barH / 2;
    const xMap = { left: margin + halfW, center: w / 2, right: w - margin - halfW };
    const yMap = { top: margin + halfH, center: h / 2, bottom: h - margin - halfH };
    let horiz = "center",
      vert = "center";
    if (pos.indexOf("left") !== -1) horiz = "left";
    else if (pos.indexOf("right") !== -1) horiz = "right";
    if (pos.indexOf("top") === 0) vert = "top";
    else if (pos.indexOf("bottom") === 0) vert = "bottom";
    return { x: xMap[horiz], y: yMap[vert] };
  }

  function renderPreview() {
    const item = state.images[state.currentIndex];
    const ctx = previewCanvas.getContext("2d");
    if (!item) {
      previewCanvas.style.display = "none";
      emptyTip.style.display = "flex";
      previewName.textContent = "未选择图片";
      previewMeta.textContent = "";
      return;
    }
    previewCanvas.style.display = "block";
    emptyTip.style.display = "none";

    const s = state.settings;
    const entries = mappedEntries();
    let vars = varsFromEntry(null);
    let seq = state.currentIndex + 1;
    let total = state.images.length;
    let note = `第 ${state.currentIndex + 1} / ${state.images.length} 张`;

    if (rosterActive() && s.batchMode === "one-to-many") {
      vars = varsFromEntry(entries[0]);
      seq = 1;
      total = entries.length;
      note = `批量预览：${entries.length} 人各出一张（示例为第 1 人）`;
    } else if (rosterActive() && s.batchMode === "one-to-one") {
      if (s.matchBy === "filename") {
        const e = matchByFilename(item.name, entries);
        if (e) {
          vars = varsFromEntry(e);
          note = `已匹配：${e["姓名"] || e["学号"] || "?"}`;
        } else {
          note = "⚠ 未匹配到学生";
        }
      } else {
        const e = entries[state.currentIndex];
        if (e) {
          vars = varsFromEntry(e);
          note = `对应第 ${state.currentIndex + 1} 位：${e["姓名"] || e["学号"] || "?"}`;
        }
      }
      total = entries.length;
    }

    previewName.textContent = item.name;
    previewMeta.textContent = note;
    previewCanvas.width = item.imgEl.naturalWidth;
    previewCanvas.height = item.imgEl.naturalHeight;
    drawAnnotated(ctx, item.imgEl, vars, seq, total);
  }

  // ---------- 导出 ----------
  function buildOutputName(vars, seq, total, ext) {
    const scope = Object.assign({}, vars, { 序号: padSeq(seq, total) });
    const base = fillTemplate(state.settings.nameTemplate, scope);
    return `${sanitizeFilePart(base) || `snapmark_${seq}`}.${ext}`;
  }

  function canvasToBlob(canvas, format) {
    return new Promise((resolve) => {
      if (format === "jpeg") canvas.toBlob(resolve, "image/jpeg", 0.92);
      else canvas.toBlob(resolve, "image/png");
    });
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 100);
  }

  async function exportZip() {
    const { jobs, errors } = computeJobs();
    if (errors.length) {
      alert(errors.join("\n"));
      return;
    }
    const s = state.settings;
    const ext = s.outFormat === "jpeg" ? "jpg" : "png";
    const zip = new JSZip();
    const off = document.createElement("canvas");
    const octx = off.getContext("2d");
    const used = new Set();

    for (const job of jobs) {
      off.width = job.img.imgEl.naturalWidth;
      off.height = job.img.imgEl.naturalHeight;
      drawAnnotated(octx, job.img.imgEl, job.vars, job.seq, job.total);
      const blob = await canvasToBlob(off, s.outFormat);

      let name = buildOutputName(job.vars, job.seq, job.total, ext);
      let n = name,
        c = 1;
      while (used.has(n.toLowerCase())) {
        const dot = name.lastIndexOf(".");
        n = `${name.slice(0, dot)}_${++c}${name.slice(dot)}`;
      }
      used.add(n.toLowerCase());
      zip.file(n, blob);
    }

    const content = await zip.generateAsync({ type: "blob" });
    downloadBlob(content, `snapmark_${jobs.length}张_${stamp()}.zip`);
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  }

  async function downloadCurrent() {
    const { jobs, errors } = computeJobs();
    if (errors.length) {
      alert(errors.join("\n"));
      return;
    }
    const job = jobs.find((j) => j.img === state.images[state.currentIndex]) || jobs[0];
    if (!job) return;
    const s = state.settings;
    const ext = s.outFormat === "jpeg" ? "jpg" : "png";
    const off = document.createElement("canvas");
    off.width = job.img.imgEl.naturalWidth;
    off.height = job.img.imgEl.naturalHeight;
    drawAnnotated(off.getContext("2d"), job.img.imgEl, job.vars, job.seq, job.total);
    const blob = await canvasToBlob(off, s.outFormat);
    downloadBlob(blob, buildOutputName(job.vars, job.seq, job.total, ext));
  }

  // ---------- 界面刷新 ----------
  function updateButtons() {
    const has = state.images.length > 0;
    btnExport.disabled = !has;
    btnDownloadCurrent.disabled = state.currentIndex < 0;

    if (!has) {
      exportCount.hidden = true;
      return;
    }
    const { jobs, warnings } = computeJobs();
    exportCount.hidden = false;
    if (jobs.length) {
      exportCount.textContent = `将生成 ${jobs.length} 张`;
      exportCount.className = "export-count" + (warnings.length ? " warn-text" : "");
      exportCount.title = warnings.join("\n");
    } else {
      exportCount.textContent = "无可导出内容";
      exportCount.className = "export-count warn-text";
    }
    btnExport.textContent = jobs.length > 1 ? `导出 ZIP（${jobs.length} 张）` : "导出 ZIP";
  }

  // ---------- 设置持久化 ----------
  function saveSettings() {
    try {
      const s = Object.assign({}, state.settings);
      if (s.roster && s.roster.rows.length > MAX_PERSIST_ROWS) {
        s.roster = Object.assign({}, s.roster, { rows: s.roster.rows.slice(0, MAX_PERSIST_ROWS) });
      }
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    } catch (_) {}
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem("snapmark.settings.v1");
      if (!raw) return;
      const s = JSON.parse(raw);
      Object.assign(state.settings, s);
      if (s.meta) state.settings.meta = Object.assign({ 姓名: "", 学号: "", 班级: "" }, s.meta);
    } catch (_) {}
  }

  function syncControlsFromSettings() {
    const s = state.settings;
    $("tpl").value = s.template;
    $("name-tpl").value = s.nameTemplate;
    $("meta-name").value = s.meta["姓名"] || "";
    $("meta-id").value = s.meta["学号"] || "";
    $("meta-cls").value = s.meta["班级"] || "";
    $("font-size").value = s.fontSizePct;
    $("font-size-val").textContent = s.fontSizePct;
    $("opacity").value = s.opacity;
    $("opacity-val").textContent = s.opacity;
    $("text-color").value = s.textColor;
    $("bg-color").value = s.bgColor;
    $("show-bar").checked = s.showBar;
    $("out-format").value = s.outFormat;
    $("match-by").value = s.matchBy;
    $("export-limit").value = s.exportLimit || "";
    document.querySelectorAll('input[name="batch-mode"]').forEach((r) => {
      r.checked = r.value === s.batchMode;
    });
    document.querySelectorAll("#pos-grid button").forEach((b) => {
      b.classList.toggle("active", b.dataset.pos === s.position);
    });
  }

  // ---------- 名单文件导入 ----------
  async function importRosterFile(file) {
    try {
      const buf = await file.arrayBuffer();
      const lower = file.name.toLowerCase();
      let matrix;
      if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
        matrix = parseXlsx(buf);
      } else {
        const text = decodeTextSmart(buf);
        matrix = parseDelimited(text, detectDelimiter(text));
      }
      const roster = buildRoster(matrix);
      if (!roster.rows.length) throw new Error("没有解析到数据行");
      setRoster(roster);
      toast(`已导入 ${roster.rows.length} 条名单`);
    } catch (e) {
      alert("名单导入失败：" + e.message);
    }
  }

  function toast(msg) {
    let el = document.getElementById("snapmark-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "snapmark-toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  // ---------- 事件绑定 ----------
  function bindEvents() {
    dropzone.addEventListener("click", () => fileInput.click());
    dropzone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") fileInput.click();
    });
    fileInput.addEventListener("change", (e) => {
      addFiles(e.target.files);
      fileInput.value = "";
    });

    ["dragenter", "dragover"].forEach((ev) =>
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
      })
    );
    dropzone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

    const liveInputs = [
      ["tpl", (v) => (state.settings.template = v)],
      ["name-tpl", (v) => (state.settings.nameTemplate = v)],
      ["meta-name", (v) => (state.settings.meta["姓名"] = v)],
      ["meta-id", (v) => (state.settings.meta["学号"] = v)],
      ["meta-cls", (v) => (state.settings.meta["班级"] = v)],
    ];
    liveInputs.forEach(([id, setter]) => {
      $(id).addEventListener("input", (e) => {
        setter(e.target.value);
        saveSettings();
        renderPreview();
        updateButtons();
      });
    });

    $("font-size").addEventListener("input", (e) => {
      state.settings.fontSizePct = Number(e.target.value);
      $("font-size-val").textContent = e.target.value;
      saveSettings();
      renderPreview();
    });
    $("opacity").addEventListener("input", (e) => {
      state.settings.opacity = Number(e.target.value);
      $("opacity-val").textContent = e.target.value;
      saveSettings();
      renderPreview();
    });
    $("text-color").addEventListener("input", (e) => {
      state.settings.textColor = e.target.value;
      saveSettings();
      renderPreview();
    });
    $("bg-color").addEventListener("input", (e) => {
      state.settings.bgColor = e.target.value;
      saveSettings();
      renderPreview();
    });
    $("show-bar").addEventListener("change", (e) => {
      state.settings.showBar = e.target.checked;
      saveSettings();
      renderPreview();
    });
    $("out-format").addEventListener("change", (e) => {
      state.settings.outFormat = e.target.value;
      saveSettings();
    });

    document.querySelectorAll("#pos-grid button").forEach((b) => {
      b.addEventListener("click", () => {
        state.settings.position = b.dataset.pos;
        document
          .querySelectorAll("#pos-grid button")
          .forEach((x) => x.classList.toggle("active", x === b));
        saveSettings();
        renderPreview();
      });
    });

    // 批量名单相关
    $("btn-import-roster").addEventListener("click", () => $("roster-input").click());
    $("roster-input").addEventListener("change", (e) => {
      if (e.target.files[0]) importRosterFile(e.target.files[0]);
      e.target.value = "";
    });
    $("btn-clear-roster").addEventListener("click", clearRoster);
    $("btn-parse-paste").addEventListener("click", () => {
      const text = $("roster-paste").value;
      if (!text.trim()) {
        alert("请先粘贴名单内容");
        return;
      }
      try {
        const roster = buildRoster(parseDelimited(text, detectDelimiter(text)));
        if (!roster.rows.length) throw new Error("没有解析到数据行");
        setRoster(roster);
        toast(`已解析 ${roster.rows.length} 条名单`);
      } catch (e) {
        alert("解析失败：" + e.message);
      }
    });

    document.querySelectorAll('input[name="batch-mode"]').forEach((r) => {
      r.addEventListener("change", () => {
        state.settings.batchMode = r.value;
        if (r.value !== "none" && !rosterActive()) {
          toast("还没有导入名单，请先导入或粘贴花名册");
        }
        saveSettings();
        renderRoster();
        renderPreview();
        updateButtons();
      });
    });

    $("match-by").addEventListener("change", (e) => {
      state.settings.matchBy = e.target.value;
      saveSettings();
      renderPreview();
      updateButtons();
    });

    $("export-limit").addEventListener("input", (e) => {
      state.settings.exportLimit = e.target.value;
      saveSettings();
      updateButtons();
    });

    [["map-name", "name"], ["map-id", "id"], ["map-class", "cls"]].forEach(
      ([id, key]) => {
        $(id).addEventListener("change", (e) => {
          if (!state.settings.roster) return;
          state.settings.roster.map[key] = parseInt(e.target.value, 10);
          saveSettings();
          renderPreview();
          updateButtons();
        });
      }
    );

    btnExport.addEventListener("click", exportZip);
    btnClear.addEventListener("click", clearAll);
    btnDownloadCurrent.addEventListener("click", downloadCurrent);
    btnPrev.addEventListener("click", () => {
      if (state.currentIndex > 0) {
        state.currentIndex--;
        renderList();
        renderPreview();
        updateButtons();
      }
    });
    btnNext.addEventListener("click", () => {
      if (state.currentIndex < state.images.length - 1) {
        state.currentIndex++;
        renderList();
        renderPreview();
        updateButtons();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.target.matches("input, textarea, select")) return;
      if (e.key === "ArrowLeft") btnPrev.click();
      else if (e.key === "ArrowRight") btnNext.click();
    });
  }

  // ---------- 启动 ----------
  function init() {
    loadSettings();
    syncControlsFromSettings();
    bindEvents();
    renderList();
    renderRoster();
    renderPreview();
    updateButtons();
  }

  init();
})();
