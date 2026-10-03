// SnapMark 新功能端到端验证：
// 自定义位置 / 字体与颜色 / 批量随机 / 通用文字模板 + 任意花名册列 + 文件名模板
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const JSZip = require("../vendor/jszip.min.js");
const { suppressOnboard, openAllDetails } = require("./_helpers");

const BASE = process.env.SNAPMARK_BASE || "http://localhost:8765";
const fx = path.join(__dirname, "fixtures");

(async () => {
  const report = [];
  const ok = (name, cond, extra = "") => {
    report.push(!!cond);
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);
  };

  const smallImg = path.join(fx, "小图.png");
  const otherImgs = [path.join(fx, "网页截图.png"), path.join(fx, "深色模式.png")];
  [smallImg, ...otherImgs].forEach((p) => {
    if (!fs.existsSync(p)) throw new Error("缺少测试图，请先跑 node test/gen_v2_fixtures.js: " + p);
  });
  const rosterCsv = path.join(fx, "花名册_80人_多列.csv");
  if (!fs.existsSync(rosterCsv)) throw new Error("缺少测试花名册: " + rosterCsv);

  const roster = fs
    .readFileSync(rosterCsv, "utf8")
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(","));
  const students = roster.slice(1); // [姓名, 学号, 班级, 日期, 是否成功]

  const tmpDownload = fs.mkdtempSync(path.join(os.tmpdir(), "snapmark-v2-"));
  const pageErrors = [];

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push("console: " + m.text());
  });

  const setRange = (sel, val) =>
    page.evaluate(
      ([s, v]) => {
        const el = document.querySelector(s);
        el.value = String(v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      },
      [sel, val]
    );

  const baseImgUrl = `${BASE}/test/fixtures/%E5%B0%8F%E5%9B%BE.png`;

  /** 预览画布上「标注内容」的包围盒（和原图逐像素比，不同即算标注） */
  const previewBBox = () =>
    page.evaluate(async (url) => {
      const c = document.getElementById("preview-canvas");
      if (!c.width || c.style.display === "none") return null;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const base = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      });
      const bc = document.createElement("canvas");
      bc.width = c.width;
      bc.height = c.height;
      const bx = bc.getContext("2d");
      bx.drawImage(base, 0, 0, c.width, c.height);
      const bd = bx.getImageData(0, 0, c.width, c.height).data;
      let minX = 1e9,
        minY = 1e9,
        maxX = -1,
        maxY = -1,
        count = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] !== bd[i] || d[i + 1] !== bd[i + 1] || d[i + 2] !== bd[i + 2]) {
          const p = (i / 4) | 0;
          const x = p % c.width;
          const y = (p / c.width) | 0;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          count++;
        }
      }
      return count
        ? { minX, minY, maxX, maxY, count, w: c.width, h: c.height }
        : null;
    }, baseImgUrl);

  try {
    await suppressOnboard(page);
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await openAllDetails(page);

    // ---------- 1. 字体下拉必须有内容 ----------
    const fontOpts = await page.locator("#font-family option").count();
    ok("字体下拉已填充选项", fontOpts >= 8, `共 ${fontOpts} 项`);

    // ---------- 2. 导入图片 ----------
    await page.setInputFiles("#file-input", [smallImg, ...otherImgs]);
    await page.waitForFunction(
      () => document.querySelectorAll("#image-list li").length === 3,
      { timeout: 8000 }
    );
    await page.click("#image-list li:first-child");
    await page.waitForTimeout(200);
    ok("图片已导入并选中第一张", await page.locator("#btn-export").isEnabled());

    // ---------- 3. 单张模式字段 + 任意字段名 ----------
    const valueInput = (i) => page.locator("#meta-fields .meta-row").nth(i).locator("input").nth(1);
    await valueInput(0).fill("张三");
    await valueInput(1).fill("2023100001");
    await valueInput(2).fill("软件2301班");
    await page.click("#btn-add-field");
    const newKey = page.locator("#meta-fields .meta-row").last().locator("input").nth(0);
    await newKey.fill("是否成功");
    await newKey.press("Enter");
    await page.locator("#meta-fields .meta-row").last().locator("input").nth(1).fill("是");
    await page.waitForTimeout(200);
    const chipTexts = await page.locator("#var-chips .chip").allTextContents();
    ok("可用变量含自定义字段 {是否成功}", chipTexts.some((t) => t.includes("是否成功")), chipTexts.join(" "));

    // ---------- 4. 单行 vs 多行模板 ----------
    await page.fill("#tpl", "{姓名} {学号}");
    await page.waitForTimeout(200);
    const oneLine = await previewBBox();
    await page.fill("#tpl", "{姓名}\n{学号}\n{是否成功}");
    await page.waitForTimeout(200);
    const threeLine = await previewBBox();
    ok("单行模板能画出文字", oneLine && oneLine.count > 0);
    ok(
      "三行模板比单行更高（换行生效）",
      oneLine && threeLine && threeLine.maxY - threeLine.minY > oneLine.maxY - oneLine.minY,
      oneLine && threeLine
        ? `单行高 ${oneLine.maxY - oneLine.minY} / 三行高 ${threeLine.maxY - threeLine.minY}`
        : "缺少数据"
    );

    // ---------- 5. 自定义位置（滑杆 + 图上拖动） ----------
    await page.click("#pos-custom-btn");
    await page.waitForTimeout(150);
    ok("自定义位置面板已展开", !(await page.locator("#custom-pos").isHidden()));
    await setRange("#pos-x", 25);
    await setRange("#pos-y", 20);
    await page.waitForTimeout(200);
    const topLeft = await previewBBox();
    ok(
      "滑杆把文字移到左上",
      topLeft && topLeft.minX < topLeft.w / 2 && topLeft.minY < topLeft.h / 2,
      topLeft ? `minX=${topLeft.minX} minY=${topLeft.minY}` : "无标注"
    );

    const box = await page.locator("#preview-canvas").boundingBox();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7 + 4, box.y + box.height * 0.8 + 4, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const dragX = await page.inputValue("#pos-x");
    const dragY = await page.inputValue("#pos-y");
    ok("在预览图上拖动可改位置", Number(dragX) > 40 && Number(dragY) > 40, `x=${dragX} y=${dragY}`);

    // ---------- 6. 字体 / 字重 / 倾斜 / 对齐 ----------
    await page.selectOption("#font-family", "kaiti");
    await page.selectOption("#font-weight", "700");
    await page.selectOption("#text-align", "left");
    await page.check("#italic");
    await page.fill("#text-color", "#ffe066");
    await page.waitForTimeout(200);
    const styled = await previewBBox();
    ok("改字体/颜色后仍能正常出字", styled && styled.count > 0);

    // ---------- 7. 文件名模板：全角括号 + 花名册列 ----------
    await page.fill("#name-tpl", "｛学号｝-｛姓名｝");
    await page.waitForTimeout(200);
    const np1 = await page.textContent("#name-preview");
    ok(
      "全角括号的模板也能替换（用户反馈的 bug）",
      np1.includes("2023100001") && np1.includes("张三") && !/[\uFF5B\uFF5D]/.test(np1),
      np1.trim()
    );

    // ---------- 8. 导入多列花名册 ----------
    await page.setInputFiles("#roster-input", rosterCsv);
    await page.waitForFunction(
      () => document.getElementById("roster-badge").textContent.includes("80"),
      { timeout: 8000 }
    );
    ok("多列花名册导入 80 人", true, await page.textContent("#roster-badge"));
    const chips2 = await page.locator("#var-chips .chip").allTextContents();
    ok(
      "花名册任意列都出现在可用变量里",
      chips2.some((t) => t.includes("日期")) && chips2.some((t) => t.includes("是否成功")),
      chips2.join(" ")
    );

    // ---------- 9. 一图 × 名单 ----------
    await page.check('input[name="batch-mode"][value="one-to-many"]');
    await page.waitForTimeout(300);
    ok(
      "导出数量显示 80 张",
      (await page.textContent("#export-count")).includes("80"),
      (await page.textContent("#export-count")).trim()
    );

    await page.fill("#tpl", "{姓名}\n{日期}\n{是否成功}");
    await page.fill("#name-tpl", "{学号}-{姓名}");
    await page.waitForTimeout(200);
    const np2 = await page.textContent("#name-preview");
    ok("文件名预览跟随花名册", np2.includes(`${students[0][1]}-${students[0][0]}`), np2.trim());

    // ---------- 10. 批量随机 ----------
    await page.check("#random-enabled");
    await page.check("#random-color");
    await page.check("#random-font");
    await setRange("#random-size", 25);
    await setRange("#random-pos", 12);
    await setRange("#random-opacity", 30);
    await page.fill("#random-seed", "e2e-seed");
    await page.waitForTimeout(300);
    ok("批量随机已开启", (await page.textContent("#random-badge")).includes("已开启"));

    // ---------- 11. 导出 ZIP 并校验 ----------
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#btn-export"),
    ]);
    const zipPath = path.join(tmpDownload, dl.suggestedFilename());
    await dl.saveAs(zipPath);
    const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    ok("ZIP 里共 80 个文件", names.length === 80, `${names.length} 个`);

    const expected = students.map((s) => `${s[1]}-${s[0]}.png`);
    const nameSet = new Set(names);
    const missing = expected.filter((n) => !nameSet.has(n));
    ok(
      "文件名按「学号-姓名」来自花名册",
      missing.length === 0,
      missing.length ? `缺/错 ${missing.slice(0, 3).join(", ")}` : `例：${names[0]}`
    );
    ok(
      "文件名里没有残留占位符",
      names.every((n) => !/[{}｛｝]/.test(n)),
      names.find((n) => /[{}｛｝]/.test(n)) || "无"
    );

    const hashes = [];
    for (const n of names) {
      const buf = await zip.files[n].async("nodebuffer");
      hashes.push(crypto.createHash("sha1").update(buf).digest("hex"));
    }
    ok("80 张图导出内容各不相同", new Set(hashes).size === 80, `不同 ${new Set(hashes).size} / 80`);

    // 抽 20 张量包围盒，确认字号/位置真的在变
    const b64 = fs.readFileSync(zipPath).toString("base64");
    const boxes = await page.evaluate(
      async ({ b64, url }) => {
        const zip = await JSZip.loadAsync(b64, { base64: true });
        const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).slice(0, 20);
        const base = await new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = url;
        });
        const bc = document.createElement("canvas");
        bc.width = base.naturalWidth;
        bc.height = base.naturalHeight;
        const bx = bc.getContext("2d");
        bx.drawImage(base, 0, 0);
        const bd = bx.getImageData(0, 0, bc.width, bc.height).data;
        const out = [];
        for (const n of names) {
          const blob = await zip.files[n].async("blob");
          const u = URL.createObjectURL(blob);
          const img = await new Promise((res, rej) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = rej;
            i.src = u;
          });
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const cx = c.getContext("2d");
          cx.drawImage(img, 0, 0);
          const d = cx.getImageData(0, 0, c.width, c.height).data;
          let minX = 1e9,
            minY = 1e9,
            maxX = -1,
            maxY = -1;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i] !== bd[i] || d[i + 1] !== bd[i + 1] || d[i + 2] !== bd[i + 2]) {
              const p = (i / 4) | 0;
              const x = p % c.width;
              const y = (p / c.width) | 0;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
          URL.revokeObjectURL(u);
          out.push({ n, w: maxX - minX, h: maxY - minY, cx: minX + maxX, cy: minY + maxY });
        }
        return out;
      },
      { b64, url: baseImgUrl }
    );
    const distinctBox = new Set(boxes.map((b) => `${b.w}x${b.h}@${b.cx},${b.cy}`)).size;
    const inBounds = boxes.every((b) => b.w > 0 && b.h > 0 && b.cx >= 0 && b.cy >= 0);
    ok("抽样 20 张里位置/字号确实各不相同", distinctBox >= 15, `不同 ${distinctBox} / 20`);
    ok("所有标注都在图片范围内", inBounds);

    // ---------- 12. 导出数量限制 ----------
    await page.fill("#export-limit", "5");
    await page.waitForTimeout(300);
    ok(
      "导出数量限制生效",
      (await page.textContent("#export-count")).includes("5"),
      (await page.textContent("#export-count")).trim()
    );
    const [dl2] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#btn-export"),
    ]);
    const zipPath2 = path.join(tmpDownload, dl2.suggestedFilename());
    await dl2.saveAs(zipPath2);
    const zip2 = await JSZip.loadAsync(fs.readFileSync(zipPath2));
    ok(
      "限制后只导出 5 张",
      Object.keys(zip2.files).filter((n) => !zip2.files[n].dir).length === 5
    );
    await page.fill("#export-limit", "");

    // ---------- 13. 设置持久化 ----------
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const afterTpl = await page.inputValue("#tpl");
    const afterName = await page.inputValue("#name-tpl");
    const afterFont = await page.inputValue("#font-family");
    const afterSeed = await page.inputValue("#random-seed");
    ok("刷新后模板仍在", afterTpl.includes("{是否成功}"), JSON.stringify(afterTpl));
    ok("刷新后文件名模板仍在", afterName === "{学号}-{姓名}", afterName);
    ok("刷新后字体设置仍在", afterFont === "kaiti", afterFont);
    ok("刷新后随机种子仍在", afterSeed === "e2e-seed", afterSeed);

    // ---------- 14. 无脚本错误 ----------
    ok("页面无 JS 报错", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  } catch (err) {
    console.error("E2E 异常:", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }

  const failed = report.filter((r) => !r).length;
  console.log(`\n合计 ${report.length} 项，失败 ${failed} 项`);
  console.log("DOWNLOAD_DIR=" + tmpDownload);
  if (failed) process.exitCode = 1;
})();
