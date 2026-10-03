/* SnapMark · 批量截图标注工具
 * 全部在浏览器本地运行，不上传任何数据。
 */

(function () {
  "use strict";

  // ---------- 状态 ----------
  const RANDOM_DEFAULTS = {
    enabled: true,
    sizePct: 12,
    posPct: 6,
    opacityPct: 15,
    color: true,
    font: true,
    seed: "1",
    fontPool: ["yahei", "heiti", "songti", "kaiti"],
  };

  const state = {
    images: [], // { file, name, imgEl, url }
    currentIndex: -1,
    settings: {
      template: "{姓名} {学号} {班级}",
      nameTemplate: "{姓名}_{学号}_{班级}_{序号}",
      meta: { 姓名: "", 学号: "", 班级: "" },
      position: "bottom-center",
      customX: 50,
      customY: 88,
      fontSizePct: 4,
      fontKey: "yahei",
      fontWeight: "600",
      italic: false,
      textAlign: "center",
      opacity: 55,
      textColor: "#ffffff",
      bgColor: "#000000",
      showBar: true,
      outFormat: "png",
      batchMode: "none",
      matchBy: "order",
      exportLimit: "",
      rosterOpen: false,
      roster: null, // { columns: [], rows: [{}], map: {name,id,cls}, hasHeader: bool }
      random: Object.assign({}, RANDOM_DEFAULTS, { fontPool: RANDOM_DEFAULTS.fontPool.slice() }),
    },
  };

  const STORE_KEY = "snapmark.settings.v2";
  const MAX_PERSIST_ROWS = 2000;
  const ONBOARD_KEY = "snapmark.onboarded.v1";

  // 字体表：全部使用系统字体，不联网加载，保证离线可用
  const FONTS = {
    yahei: { label: "微软雅黑", css: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif' },
    heiti: { label: "黑体", css: '"SimHei", "Heiti SC", "Noto Sans SC", sans-serif' },
    songti: { label: "宋体", css: '"SimSun", "Songti SC", "Noto Serif SC", serif' },
    kaiti: { label: "楷体", css: '"KaiTi", "STKaiti", "Kaiti SC", "Noto Serif SC", serif' },
    fangsong: { label: "仿宋", css: '"FangSong", "STFangsong", "Noto Serif SC", serif' },
    dengxian: { label: "等线", css: '"DengXian", "PingFang SC", "Noto Sans SC", sans-serif' },
    pingfang: { label: "苹方", css: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif' },
    source: { label: "思源黑体", css: '"Source Han Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif' },
    yuanti: { label: "圆体", css: '"Yuanti SC", "HYQiHei", "Microsoft YaHei", sans-serif' },
    mono: { label: "等宽", css: '"Cascadia Mono", Consolas, "Courier New", monospace' },
    system: { label: "系统默认", css: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  };

  // 随机文字颜色池：都在深色底条上清晰可读
  const COLOR_PALETTE = [
    "#ffffff", "#ffe066", "#ffd23f", "#ffa502", "#ff6b6b", "#ff9ff3",
    "#4ecdc4", "#2ed573", "#7bed9f", "#70a1ff", "#a29bfe", "#f8f9fa",
  ];

  /** 把一个字符串散列成 32 位无符号整数，用于可复现的随机 */
  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** mulberry32：轻量确定性伪随机，同一个种子每次结果一致 */
  function mulberry32(a) {
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) {
    return Math.min(Math.max(v, lo), hi);
  }

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

  /** 中文输入法常打出全角括号，统一成半角，否则 {姓名} 这种占位符匹配不上 */
  function normalizePlaceholders(tpl) {
    return String(tpl == null ? "" : tpl)
      .replace(/[\uFF5B]/g, "{")
      .replace(/[\uFF5D]/g, "}");
  }

  /** 通用模板替换：任何 {列名} 都会被替换，花名册里那列叫什么就写什么 */
  function fillTemplate(tpl, vars) {
    return normalizePlaceholders(tpl).replace(/\{([^{}]+)\}/g, (m, rawKey) => {
      const key = rawKey.trim();
      const v = vars[key];
      return v === undefined || v === null || v === "" ? "" : String(v);
    });
  }

  /** 模板里用到的变量名列表，用于提示写错的占位符 */
  function templateVarNames(tpl) {
    const out = [];
    normalizePlaceholders(tpl).replace(/\{([^{}]+)\}/g, (m, rawKey) => {
      const key = rawKey.trim();
      if (key && out.indexOf(key) === -1) out.push(key);
      return m;
    });
    return out;
  }

  function hexToRgba(hex, alpha) {
    const m = hex.replace("#", "");
    const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
    const n = parseInt(v, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  /** 按宽度折行；只有当内容真的放不下时，末行才加省略号 */
  function truncateLines(ctx, text, maxWidth, maxLines) {
    const lines = [];
    const chars = Array.from(text);
    let current = "";
    let overflowed = false;

    for (let i = 0; i < chars.length; i++) {
      const test = current + chars[i];
      if (current === "" || ctx.measureText(test).width <= maxWidth) {
        current = test;
        continue;
      }
      if (lines.length === maxLines - 1) {
        overflowed = true;
        break;
      }
      lines.push(current);
      current = chars[i];
    }

    if (overflowed) {
      let last = current;
      while (last.length > 0 && ctx.measureText(last + "…").width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines.push(last + "…");
      return lines;
    }
    if (current !== "") lines.push(current);
    return lines.length ? lines : [""];
  }

  const MAX_TEXT_LINES = 8;

  /** 不依赖花名册的内置变量 */
  function builtinVars() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const ymd = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
    return { 日期: ymd, 时间: hm, 日期时间: `${ymd} ${hm}` };
  }

  /** 模板 → 实际绘制行：模板里每个换行就是图上的一行，超宽再自动折 */
  function buildTextLines(ctx, tpl, scope, maxWidth) {
    const raw = fillTemplate(tpl, scope);
    const tplLines = raw
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter((x) => x !== "");
    const out = [];
    for (const tl of tplLines) {
      if (out.length >= MAX_TEXT_LINES) break;
      const wrapped = truncateLines(ctx, tl, maxWidth, MAX_TEXT_LINES - out.length);
      for (const wl of wrapped) {
        if (out.length < MAX_TEXT_LINES) out.push(wl);
      }
    }
    return out;
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
    $("step1-badge").textContent = state.images.length ? `已放 ${state.images.length} 张` : "还没放图";
    $("step1-badge").className = "badge" + (state.images.length ? " ok" : "");
    $("image-list-wrap").hidden = !state.images.length;
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
    const matchField = $("match-field");

    // 批量开关：控制名单区与手动字段区的显隐
    const open = !!state.settings.rosterOpen;
    $("roster-toggle").checked = open;
    $("roster-body").hidden = !open;
    $("meta-section").hidden = open;
    $("roster-toggle-hint").textContent = open
      ? "已开启：以花名册为准，上面手动填的字段不生效"
      : "开了这个，下面这些信息就不用一个个手填了";

    if (!rosterActive()) {
      badge.textContent = "未导入";
      badge.className = "badge";
      preview.hidden = true;
      preview.innerHTML = "";
      mapField.hidden = true;
      matchField.hidden = true;
      $("roster-detail").hidden = true;
      $("btn-clear-roster").disabled = true;
      renderVarChips();
      return;
    }

    badge.textContent = `${r.rows.length} 人`;
    badge.className = "badge ok";
    $("roster-detail").hidden = false;
    mapField.hidden = false;
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
    renderVarChips();
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

    // 给每个任务挂上随机变化参数（同一张图每次结果一致）
    jobs.forEach((j) => {
      const name = (j.vars && j.vars["姓名"]) || "";
      const id = (j.vars && j.vars["学号"]) || "";
      j.variation = makeVariation(`${j.seq}|${name}|${id}`);
    });

    // 导出数量限制
    const limit = parseInt(s.exportLimit, 10);
    let limited = jobs;
    if (!isNaN(limit) && limit > 0 && limit < jobs.length) {
      limited = jobs.slice(0, limit);
      warnings.push(`已按数量限制只导出前 ${limit} 张`);
    }

    // 提示模板里写错/没有对应数据的占位符
    const known = {};
    availableVariables().forEach((k) => (known[k] = true));
    known["序号"] = true;
    const missing = [];
    [
      ["图片文字", s.template],
      ["文件名", s.nameTemplate],
    ].forEach(([label, tpl]) => {
      templateVarNames(tpl).forEach((k) => {
        if (known[k]) return;
        const label2 = `{${k}}（${label}模板）`;
        if (missing.indexOf(label2) === -1) missing.push(label2);
      });
    });
    if (missing.length) {
      warnings.push(
        `这些变量没有对应数据：${missing.join("、")}。花名册里那列叫什么就用什么，也可以在「可用变量」里点选。`
      );
    }

    if (!limited.length && !errors.length) errors.push("没有可导出的内容");
    return { jobs: limited, warnings, errors };
  }

  // ---------- 绘制 ----------
  /** 生成某一张图的随机变化参数；同一个种子 + 同一个人 → 结果稳定不变 */
  function makeVariation(key) {
    const r = state.settings.random;
    if (!r || !r.enabled) return null;
    const rnd = mulberry32(hashStr(String(r.seed) + "|" + key));
    const v = {
      sizeMul: 1 + (rnd() * 2 - 1) * (Number(r.sizePct) / 100),
      dx: (rnd() * 2 - 1) * (Number(r.posPct) / 100),
      dy: (rnd() * 2 - 1) * (Number(r.posPct) / 100),
      opacityMul: 1 + (rnd() * 2 - 1) * (Number(r.opacityPct) / 100),
      fontKey: null,
      textColor: null,
    };
    const pool = (r.fontPool || []).filter((k) => FONTS[k]);
    if (r.font && pool.length) v.fontKey = pool[Math.floor(rnd() * pool.length)];
    if (r.color) v.textColor = COLOR_PALETTE[Math.floor(rnd() * COLOR_PALETTE.length)];
    return v;
  }

  function fontString(sizePx, fontKey, weight, italic) {
    const fam = (FONTS[fontKey] || FONTS.yahei).css;
    return `${italic ? "italic " : ""}${weight || 600} ${sizePx}px ${fam}`;
  }

  /** 把文字框夹在图片内，避免自定义位置/随机偏移把字挤出画面 */
  function clampAnchor(x, y, w, h, barW, barH) {
    const m = Math.round(Math.min(w, h) * 0.01);
    const loX = Math.min(barW / 2 + m, w / 2);
    const hiX = Math.max(w - barW / 2 - m, w / 2);
    const loY = Math.min(barH / 2 + m, h / 2);
    const hiY = Math.max(h - barH / 2 - m, h / 2);
    return { x: clamp(x, loX, hiX), y: clamp(y, loY, hiY) };
  }

  function drawAnnotated(ctx, img, vars, seq, total, variation) {
    const s = state.settings;
    const v = variation || null;
    const w = img.naturalWidth,
      h = img.naturalHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const scope = Object.assign({}, builtinVars(), vars, {
      序号: padSeq(seq, total),
    });

    const shortSide = Math.min(w, h);
    const sizeMul = v ? v.sizeMul : 1;
    const fontSize = Math.max(12, Math.round((shortSide * s.fontSizePct * sizeMul) / 100));
    const fontKey = (v && v.fontKey) || s.fontKey;
    const textColor = (v && v.textColor) || s.textColor;
    const align = s.textAlign || "center";
    ctx.font = fontString(fontSize, fontKey, s.fontWeight, s.italic);
    ctx.textBaseline = "middle";
    ctx.textAlign = align;

    const lines = buildTextLines(ctx, s.template, scope, w * 0.86);
    if (!lines.length) return;
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

    let { x, y } = computeAnchor(s.position, w, h, margin, barW, barH, s);
    if (v) {
      x += v.dx * shortSide;
      y += v.dy * shortSide;
    }
    ({ x, y } = clampAnchor(x, y, w, h, barW, barH));

    // 文字对齐影响底条的横向基准
    const alignShift =
      align === "left" ? -barW / 2 + padX : align === "right" ? barW / 2 - padX : 0;

    if (s.showBar) {
      const alpha = clamp((s.opacity * (v ? v.opacityMul : 1)) / 100, 0, 1);
      ctx.fillStyle = hexToRgba(s.bgColor, alpha);
      roundRect(ctx, x - barW / 2, y - barH / 2, barW, barH, Math.min(12, fontSize * 0.5));
      ctx.fill();
    }

    ctx.fillStyle = textColor;
    const textX = x + alignShift;
    let startY = y - (lines.length * lineHeight) / 2 + lineHeight / 2;
    lines.forEach((l) => {
      ctx.fillText(l, textX, startY);
      startY += lineHeight;
    });
  }

  function computeAnchor(pos, w, h, margin, barW, barH, s) {
    if (pos === "custom") {
      const cx = s && s.customX != null ? Number(s.customX) : 50;
      const cy = s && s.customY != null ? Number(s.customY) : 88;
      return { x: (w * cx) / 100, y: (h * cy) / 100 };
    }
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
      updateNamePreview();
      return;
    }
    previewCanvas.style.display = "block";
    emptyTip.style.display = "none";

    const s = state.settings;
    let vars = varsFromEntry(null);
    let seq = state.currentIndex + 1;
    let total = state.images.length;
    let note = `第 ${state.currentIndex + 1} / ${state.images.length} 张`;
    let variation = null;

    // 与导出共用同一套任务，预览和成品保证一致
    const { jobs } = computeJobs();
    const job = rosterActive() && s.batchMode === "one-to-many"
      ? jobs[0]
      : jobs.find((j) => j.img === item) || jobs[0];
    if (job) {
      vars = job.vars;
      seq = job.seq;
      total = job.total;
      variation = job.variation;
    }

    if (rosterActive() && s.batchMode === "one-to-many") {
      note = `批量预览：${total} 人各出一张（示例为第 1 人）`;
    } else if (rosterActive() && s.batchMode === "one-to-one") {
      const who = (vars && (vars["姓名"] || vars["学号"])) || "?";
      note =
        s.matchBy === "filename"
          ? job
            ? `已匹配：${who}`
            : "未匹配到学生（这张会被跳过）"
          : `对应第 ${seq} 位：${who}`;
    }

    previewName.textContent = item.name;
    previewMeta.textContent = note;
    previewCanvas.width = item.imgEl.naturalWidth;
    previewCanvas.height = item.imgEl.naturalHeight;
    drawAnnotated(ctx, item.imgEl, vars, seq, total, variation);
    updateNamePreview();
  }

  // ---------- 导出 ----------
  function buildOutputName(vars, seq, total, ext) {
    const scope = Object.assign({}, builtinVars(), vars, { 序号: padSeq(seq, total) });
    const base = fillTemplate(state.settings.nameTemplate, scope);
    return `${sanitizeFilePart(base) || `snapmark_${seq}`}.${ext}`;
  }

  /** 导出文件名实时预览，避免模板写错却到导出后才发现 */
  function updateNamePreview() {
    const el = $("name-preview");
    if (!el) return;
    const job = currentPreviewJob();
    if (!job) {
      el.textContent = "文件名预览：（导入图片后显示）";
      return;
    }
    const ext = state.settings.outFormat === "jpeg" ? "jpg" : "png";
    const name = buildOutputName(job.vars, job.seq, job.total, ext);
    const bare = name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_\s.．（）()]/g, "");
    el.textContent = bare
      ? `文件名预览：${name}`
      : "文件名预览：（还没有可用数据，先导入花名册或填写下面的字段）";
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
      drawAnnotated(octx, job.img.imgEl, job.vars, job.seq, job.total, job.variation);
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
    drawAnnotated(
      off.getContext("2d"),
      job.img.imgEl,
      job.vars,
      job.seq,
      job.total,
      job.variation
    );
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

  // ---------- 模板与字段 ----------
  const TPL_PRESETS = [
    { label: "一行：姓名 学号 班级", text: "{姓名} {学号} {班级}" },
    { label: "两行：姓名 / 学号", text: "{姓名}\n{学号}" },
    { label: "两行：姓名 / 班级 学号", text: "{姓名}\n{班级} {学号}" },
    { label: "两行：姓名 / 日期", text: "{姓名}\n{日期}" },
    { label: "两行：姓名 / 是否成功", text: "{姓名}\n{是否成功}" },
    { label: "三行：姓名 / 班级 / 日期", text: "{姓名}\n{班级}\n{日期}" },
    { label: "带序号：序号. 姓名", text: "{序号}. {姓名}" },
  ];

  /** 当前可用的全部变量：内置 + 花名册所有列 + 单张模式字段 */
  function availableVariables() {
    const out = [];
    const push = (k) => {
      if (k && out.indexOf(k) === -1) out.push(k);
    };
    ["序号", "名单序号", "日期", "时间", "日期时间"].forEach(push);
    const r = state.settings.roster;
    if (r && r.columns) {
      r.columns.forEach(push);
      // 「列的对应关系」映射出的统一字段，花名册里叫什么列都一定能用
      ["姓名", "学号", "班级"].forEach(push);
    }
    Object.keys(state.settings.meta || {}).forEach(push);
    return out;
  }

  function renderVarChips() {
    const box = $("var-chips");
    if (!box) return;
    box.innerHTML = "";
    availableVariables().forEach((k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = "{" + k + "}";
      b.title = "插入到模板光标处";
      b.addEventListener("click", () => insertIntoTemplate("{" + k + "}"));
      box.appendChild(b);
    });
  }

  function insertIntoTemplate(text) {
    const ta = $("tpl");
    const start = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    const end = ta.selectionEnd == null ? ta.value.length : ta.selectionEnd;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    const pos = start + text.length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    state.settings.template = ta.value;
    saveSettings();
    renderPreview();
    updateButtons();
  }

  function renderPresets() {
    const box = $("tpl-presets");
    if (!box) return;
    box.innerHTML = "";
    TPL_PRESETS.forEach((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = p.label;
      b.title = p.text.replace(/\n/g, " ⏎ ");
      b.addEventListener("click", () => {
        $("tpl").value = p.text;
        state.settings.template = p.text;
        saveSettings();
        renderPreview();
      });
      box.appendChild(b);
    });
  }

  /** 单张模式的字段行：字段名可改、可增、可删 */
  function renderMetaFields() {
    const box = $("meta-fields");
    if (!box) return;
    box.innerHTML = "";
    Object.keys(state.settings.meta || {}).forEach((key) => {
      const row = document.createElement("div");
      row.className = "meta-row";

      const kInput = document.createElement("input");
      kInput.type = "text";
      kInput.className = "key";
      kInput.value = key;
      kInput.placeholder = "字段名";
      kInput.addEventListener("change", () => {
        const nk = kInput.value.trim();
        const meta = state.settings.meta;
        if (!nk || nk === key || nk in meta) {
          kInput.value = key;
          return;
        }
        const next = {};
        Object.keys(meta).forEach((k) => {
          next[k === key ? nk : k] = meta[k];
        });
        state.settings.meta = next;
        saveSettings();
        renderMetaFields();
        renderVarChips();
        renderPreview();
      });

      const vInput = document.createElement("input");
      vInput.type = "text";
      vInput.value = state.settings.meta[key] || "";
      vInput.placeholder = "值";
      vInput.addEventListener("input", () => {
        state.settings.meta[key] = vInput.value;
        saveSettings();
        renderPreview();
        updateButtons();
      });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "del";
      del.textContent = "×";
      del.title = "删除该字段";
      del.addEventListener("click", () => {
        delete state.settings.meta[key];
        saveSettings();
        renderMetaFields();
        renderVarChips();
        renderPreview();
      });

      row.appendChild(kInput);
      row.appendChild(vInput);
      row.appendChild(del);
      box.appendChild(row);
    });
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
      state.settings.random = Object.assign({}, RANDOM_DEFAULTS, s.random || {});
      if (!Array.isArray(state.settings.random.fontPool)) {
        state.settings.random.fontPool = RANDOM_DEFAULTS.fontPool.slice();
      }
      if (!FONTS[state.settings.fontKey]) state.settings.fontKey = "yahei";
      if (state.settings.position !== "custom" && !/^(top|center|bottom)-(left|center|right)$/.test(state.settings.position)) {
        state.settings.position = "bottom-center";
      }
    } catch (_) {}
  }

  function syncControlsFromSettings() {
    const s = state.settings;
    $("tpl").value = s.template;
    $("name-tpl").value = s.nameTemplate;
    $("font-size").value = s.fontSizePct;
    $("font-size-val").textContent = s.fontSizePct;
    $("opacity").value = s.opacity;
    $("opacity-val").textContent = s.opacity;
    $("text-color").value = s.textColor;
    $("bg-color").value = s.bgColor;
    $("show-bar").checked = s.showBar;
    $("italic").checked = !!s.italic;
    $("font-family").value = s.fontKey;
    $("font-weight").value = String(s.fontWeight || "600");
    $("text-align").value = s.textAlign || "center";
    $("out-format").value = s.outFormat;
    $("match-by").value = s.matchBy;
    $("export-limit").value = s.exportLimit || "";
    $("pos-x").value = s.customX;
    $("pos-x-val").textContent = Math.round(s.customX);
    $("pos-y").value = s.customY;
    $("pos-y-val").textContent = Math.round(s.customY);

    const rd = s.random;
    $("random-enabled").checked = !!rd.enabled;
    $("random-size").value = rd.sizePct;
    $("random-size-val").textContent = rd.sizePct;
    $("random-pos").value = rd.posPct;
    $("random-pos-val").textContent = rd.posPct;
    $("random-opacity").value = rd.opacityPct;
    $("random-opacity-val").textContent = rd.opacityPct;
    $("random-color").checked = !!rd.color;
    $("random-font").checked = !!rd.font;
    $("random-seed").value = rd.seed;

    document.querySelectorAll('input[name="batch-mode"]').forEach((r) => {
      r.checked = r.value === s.batchMode;
    });
    document.querySelectorAll("#pos-grid button").forEach((b) => {
      b.classList.toggle("active", b.dataset.pos === s.position);
    });
    $("custom-pos").hidden = s.position !== "custom";
    updateRandomBadge();
    renderMetaFields();
    renderVarChips();
    renderPresets();
    renderFontPool();
  }

  function updateRandomBadge() {
    const on = !!state.settings.random.enabled;
    const badge = $("random-badge");
    badge.textContent = on ? "已开启" : "已关闭";
    badge.className = "badge" + (on ? " ok" : "");
    $("random-body").classList.toggle("off", !on);
  }

  // ---------- 新手引导 ----------
  function maybeShowOnboard() {
    try {
      if (localStorage.getItem(ONBOARD_KEY)) return;
    } catch (_) {}
    const box = $("onboard");
    if (box) box.hidden = false;
  }

  function renderFontPool() {
    const box = $("font-pool");
    if (!box) return;
    const pool = state.settings.random.fontPool || [];
    box.innerHTML = "";
    Object.keys(FONTS).forEach((key) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (pool.indexOf(key) !== -1 ? " on" : "");
      b.textContent = FONTS[key].label;
      b.style.fontFamily = FONTS[key].css;
      b.addEventListener("click", () => {
        const list = state.settings.random.fontPool;
        const i = list.indexOf(key);
        if (i === -1) list.push(key);
        else if (list.length > 1) list.splice(i, 1);
        else {
          toast("至少保留一种字体");
          return;
        }
        saveSettings();
        renderFontPool();
        renderPreview();
      });
      box.appendChild(b);
    });
  }

  function renderFontSelect() {
    const sel = $("font-family");
    if (!sel || sel.options.length) return;
    Object.keys(FONTS).forEach((key) => {
      const o = document.createElement("option");
      o.value = key;
      o.textContent = FONTS[key].label;
      o.style.fontFamily = FONTS[key].css;
      sel.appendChild(o);
    });
  }

  /** 预览用的当前任务：和导出时的取法保持一致，保证所见即所得 */
  function currentPreviewJob() {
    const item = state.images[state.currentIndex];
    if (!item) return null;
    const s = state.settings;
    const { jobs } = computeJobs();
    if (!jobs.length) return null;
    if (rosterActive() && s.batchMode === "one-to-many") return jobs[0];
    return jobs.find((j) => j.img === item) || jobs[0];
  }

  /** 在预览图上按住拖动即可改变文字位置 */
  function bindCanvasDrag() {
    const wrap = previewCanvas.parentElement;
    let dragging = false;

    const applyPoint = (e) => {
      const rect = previewCanvas.getBoundingClientRect();
      if (!rect.width || !rect.height || !previewCanvas.width) return;
      const px = ((e.clientX - rect.left) / rect.width) * previewCanvas.width;
      const py = ((e.clientY - rect.top) / rect.height) * previewCanvas.height;
      const job = currentPreviewJob();
      const v = job && job.variation;
      const shortSide = Math.min(previewCanvas.width, previewCanvas.height);
      const ax = px - (v ? v.dx * shortSide : 0);
      const ay = py - (v ? v.dy * shortSide : 0);
      state.settings.customX = Math.round(clamp((ax / previewCanvas.width) * 100, 0, 100));
      state.settings.customY = Math.round(clamp((ay / previewCanvas.height) * 100, 0, 100));
      state.settings.position = "custom";
      $("pos-x").value = state.settings.customX;
      $("pos-x-val").textContent = state.settings.customX;
      $("pos-y").value = state.settings.customY;
      $("pos-y-val").textContent = state.settings.customY;
      $("custom-pos").hidden = false;
      document
        .querySelectorAll("#pos-grid button")
        .forEach((b) => b.classList.toggle("active", b.dataset.pos === "custom"));
      saveSettings();
      renderPreview();
    };

    wrap.classList.add("draggable");
    previewCanvas.addEventListener("pointerdown", (e) => {
      if (state.currentIndex < 0) return;
      dragging = true;
      wrap.classList.add("dragging");
      try {
        previewCanvas.setPointerCapture(e.pointerId);
      } catch (_) {}
      applyPoint(e);
    });
    previewCanvas.addEventListener("pointermove", (e) => {
      if (dragging) applyPoint(e);
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      wrap.classList.remove("dragging");
      try {
        previewCanvas.releasePointerCapture(e.pointerId);
      } catch (_) {}
    };
    previewCanvas.addEventListener("pointerup", end);
    previewCanvas.addEventListener("pointercancel", end);
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
      state.settings.rosterOpen = true;
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
        $("custom-pos").hidden = b.dataset.pos !== "custom";
        saveSettings();
        renderPreview();
      });
    });

    // ---------- 字体 ----------
    $("font-family").addEventListener("change", (e) => {
      state.settings.fontKey = e.target.value;
      saveSettings();
      renderPreview();
    });
    $("font-weight").addEventListener("change", (e) => {
      state.settings.fontWeight = e.target.value;
      saveSettings();
      renderPreview();
    });
    $("text-align").addEventListener("change", (e) => {
      state.settings.textAlign = e.target.value;
      saveSettings();
      renderPreview();
    });
    $("italic").addEventListener("change", (e) => {
      state.settings.italic = e.target.checked;
      saveSettings();
      renderPreview();
    });

    // ---------- 自定义位置 ----------
    ["pos-x", "pos-y"].forEach((id) => {
      $(id).addEventListener("input", (e) => {
        const val = Number(e.target.value);
        if (id === "pos-x") {
          state.settings.customX = val;
          $("pos-x-val").textContent = Math.round(val);
        } else {
          state.settings.customY = val;
          $("pos-y-val").textContent = Math.round(val);
        }
        saveSettings();
        renderPreview();
      });
    });

    // ---------- 批量随机 ----------
    $("random-enabled").addEventListener("change", (e) => {
      state.settings.random.enabled = e.target.checked;
      updateRandomBadge();
      saveSettings();
      renderPreview();
    });
    [
      ["random-size", "sizePct", "random-size-val"],
      ["random-pos", "posPct", "random-pos-val"],
      ["random-opacity", "opacityPct", "random-opacity-val"],
    ].forEach(([id, key, valId]) => {
      $(id).addEventListener("input", (e) => {
        const val = Number(e.target.value);
        state.settings.random[key] = val;
        $(valId).textContent = val;
        saveSettings();
        renderPreview();
      });
    });
    $("random-color").addEventListener("change", (e) => {
      state.settings.random.color = e.target.checked;
      saveSettings();
      renderPreview();
    });
    $("random-font").addEventListener("change", (e) => {
      state.settings.random.font = e.target.checked;
      saveSettings();
      renderPreview();
    });
    $("random-seed").addEventListener("input", (e) => {
      state.settings.random.seed = e.target.value;
      saveSettings();
      renderPreview();
    });
    $("btn-reshuffle").addEventListener("click", () => {
      state.settings.random.seed = String(Math.floor(Math.random() * 100000) + 1);
      $("random-seed").value = state.settings.random.seed;
      saveSettings();
      renderPreview();
      toast("已换一批随机效果");
    });
    $("btn-add-field").addEventListener("click", () => {
      const meta = state.settings.meta;
      let i = 1;
      while (`字段${i}` in meta) i++;
      meta[`字段${i}`] = "";
      saveSettings();
      renderMetaFields();
      renderVarChips();
      const rows = $("meta-fields").querySelectorAll(".meta-row input.key");
      if (rows.length) rows[rows.length - 1].focus();
    });

    bindCanvasDrag();

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
        state.settings.rosterOpen = true;
        setRoster(roster);
        toast(`已解析 ${roster.rows.length} 条名单`);
      } catch (e) {
        alert("解析失败：" + e.message);
      }
    });

    document.querySelectorAll('input[name="batch-mode"]').forEach((r) => {
      r.addEventListener("change", () => {
        state.settings.batchMode = r.value;
        saveSettings();
        renderRoster();
        renderPreview();
        updateButtons();
      });
    });

    // 批量开关：开了但没名单时，自动弹出文件选择
    $("roster-toggle").addEventListener("change", (e) => {
      const open = e.target.checked;
      state.settings.rosterOpen = open;
      state.settings.batchMode = open ? "one-to-many" : "none";
      document.querySelectorAll('input[name="batch-mode"]').forEach((r) => {
        r.checked = r.value === state.settings.batchMode;
      });
      saveSettings();
      renderRoster();
      renderPreview();
      updateButtons();
      if (open && !rosterActive()) {
        toast("先选一份花名册（或把 Excel 名单粘贴进来）");
        $("roster-input").click();
      }
    });

    // 新手引导
    const closeOnboard = () => {
      $("onboard").hidden = true;
      try {
        localStorage.setItem(ONBOARD_KEY, "1");
      } catch (_) {}
    };
    $("btn-onboard-close").addEventListener("click", closeOnboard);
    $("onboard").querySelector(".onboard-mask").addEventListener("click", closeOnboard);

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
          renderVarChips();
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
    renderFontSelect();
    loadSettings();
    // 旧版本存过 batchMode，但没有 rosterOpen 概念，这里补一致
    if (state.settings.rosterOpen === undefined) {
      state.settings.rosterOpen = state.settings.batchMode !== "none" && rosterActive();
    }
    if (!state.settings.rosterOpen) state.settings.batchMode = "none";
    syncControlsFromSettings();
    bindEvents();
    renderList();
    renderRoster();
    renderPreview();
    updateButtons();
    maybeShowOnboard();
  }

  init();
})();
