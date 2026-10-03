// 花名册批量功能端到端验证
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { suppressOnboard } = require("./_helpers");

const fx = path.join(__dirname, "fixtures");

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "snapmark-batch-"));
  const report = [];
  const ok = (n, c, e = "") => {
    report.push(!!c);
    console.log(`${c ? "PASS" : "FAIL"}  ${n}${e ? "  | " + e : ""}`);
  };

  // 复制出几张以学生姓名命名的图片，用于文件名匹配测试
  const base = path.join(fx, "网页截图.png");
  const named = {};
  ["钱芳", "孙娜", "李敏"].forEach((n, i) => {
    const p = path.join(tmp, `${n}.png`);
    fs.copyFileSync(base, p);
    named[n] = p;
  });
  const plainImgs = [
    path.join(fx, "手机截图.png"),
    path.join(fx, "网页截图.png"),
    path.join(fx, "深色模式.png"),
  ];

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push(m.text());
  });

  async function reset() {
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
  }

  try {
    await suppressOnboard(page);
    await page.goto("http://localhost:8765", { waitUntil: "networkidle" });

    // ---- 1. 导入 UTF-8 CSV ----
    await page.setInputFiles("#roster-input", path.join(fx, "花名册_80人_utf8.csv"));
    await page.waitForFunction(
      () => document.getElementById("roster-badge").textContent.includes("80"),
      { timeout: 8000 }
    );
    ok("导入 UTF-8 CSV：识别 80 人", true, await page.textContent("#roster-badge"));
    const firstRow = await page.textContent("#roster-preview tbody tr:first-child");
    ok("内容正确解码（中文不乱码）", firstRow.includes("钱芳") && firstRow.includes("2023100001"), firstRow.trim());
    ok("列映射自动识别姓名", (await page.inputValue("#map-name")) === "0");
    ok("列映射自动识别学号", (await page.inputValue("#map-id")) === "1");
    ok("列映射自动识别班级", (await page.inputValue("#map-class")) === "2");

    // ---- 2. 导入 GBK CSV（中文 Excel 默认导出）----
    const gbkCsv = path.join(fx, "花名册_80人_gbk.csv");
    if (fs.existsSync(gbkCsv)) {
      await page.setInputFiles("#roster-input", gbkCsv);
      await page.waitForTimeout(600);
      const gbkRow = await page.textContent("#roster-preview tbody tr:first-child");
      ok("导入 GBK CSV：中文正确解码", gbkRow.includes("钱芳"), gbkRow.trim());
    } else {
      console.log("SKIP  导入 GBK CSV（缺 fixtures/花名册_80人_gbk.csv，先跑 test/gen_roster_gbk.ps1）");
    }

    // ---- 3. 粘贴 TSV ----
    const tsv = fs.readFileSync(path.join(fx, "花名册_80人_粘贴用.tsv"), "utf8");
    await page.fill("#roster-paste", tsv.split("\n").slice(0, 6).join("\n"));
    await page.click("#btn-parse-paste");
    await page.waitForFunction(
      () => document.getElementById("roster-badge").textContent.includes("5"),
      { timeout: 5000 }
    );
    ok("粘贴 Excel 内容：解析 5 人", true, await page.textContent("#roster-badge"));

    // ---- 4. XLSX 导入（在页面内用 SheetJS 现造一个 xlsx）----
    const xlsxB64 = await page.evaluate(() => {
      const rows = [["姓名", "学号", "班级"]];
      for (let i = 1; i <= 6; i++) rows.push([`测试${i}`, `2024${String(100000 + i)}`, "软件2302班"]);
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "花名册");
      return XLSX.write(wb, { bookType: "xlsx", type: "base64" });
    });
    const xlsxPath = path.join(tmp, "花名册.xlsx");
    fs.writeFileSync(xlsxPath, Buffer.from(xlsxB64, "base64"));
    await page.setInputFiles("#roster-input", xlsxPath);
    await page.waitForFunction(
      () => document.getElementById("roster-badge").textContent.includes("6"),
      { timeout: 8000 }
    );
    const xlsxRow = await page.textContent("#roster-preview tbody tr:first-child");
    ok("导入 XLSX：解析 6 人且中文正确", xlsxRow.includes("测试1"), xlsxRow.trim());

    // ---- 5. 一图 × 名单（80 人 → 80 张）----
    await reset();
    await page.setInputFiles("#roster-input", path.join(fx, "花名册_80人_utf8.csv"));
    await page.waitForFunction(() => document.getElementById("roster-badge").textContent.includes("80"), { timeout: 8000 });
    await page.setInputFiles("#file-input", [plainImgs[0]]);
    await page.waitForFunction(() => document.querySelectorAll("#image-list li").length === 1, { timeout: 8000 });
    await page.check('input[name="batch-mode"][value="one-to-many"]');
    await page.waitForTimeout(400);
    const cnt1 = await page.textContent("#export-count");
    ok("一图×名单：显示将生成 80 张", cnt1.includes("80"), cnt1);

    const [dl1] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#btn-export"),
    ]);
    const z1 = path.join(tmp, dl1.suggestedFilename());
    await dl1.saveAs(z1);
    ok("一图×名单：ZIP 导出成功", fs.statSync(z1).size > 10000, Math.round(fs.statSync(z1).size / 1024) + "KB");

    // ---- 6. 导出数量限制 ----
    await reset();
    await page.setInputFiles("#roster-input", path.join(fx, "花名册_80人_utf8.csv"));
    await page.waitForFunction(() => document.getElementById("roster-badge").textContent.includes("80"), { timeout: 8000 });
    await page.setInputFiles("#file-input", [plainImgs[0]]);
    await page.waitForFunction(() => document.querySelectorAll("#image-list li").length === 1, { timeout: 8000 });
    await page.check('input[name="batch-mode"][value="one-to-many"]');
    await page.fill("#export-limit", "5");
    await page.waitForTimeout(400);
    const cnt2 = await page.textContent("#export-count");
    ok("数量限制：显示将生成 5 张", cnt2.includes("5"), cnt2);
    const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#btn-export")]);
    const z2 = path.join(tmp, dl2.suggestedFilename());
    await dl2.saveAs(z2);
    ok("数量限制：文件名含张数", dl2.suggestedFilename().includes("5张"), dl2.suggestedFilename());

    // ---- 7. 图片 × 名单 按顺序 ----
    await reset();
    await page.setInputFiles("#roster-input", path.join(fx, "花名册_80人_utf8.csv"));
    await page.waitForFunction(() => document.getElementById("roster-badge").textContent.includes("80"), { timeout: 8000 });
    await page.setInputFiles("#file-input", plainImgs);
    await page.waitForFunction(() => document.querySelectorAll("#image-list li").length === 3, { timeout: 8000 });
    await page.check('input[name="batch-mode"][value="one-to-one"]');
    await page.waitForTimeout(400);
    const cnt3 = await page.textContent("#export-count");
    ok("图片×名单（顺序）：3 图 80 人 → 3 张并提示", cnt3.includes("3"), cnt3);
    const [dl3] = await Promise.all([page.waitForEvent("download"), page.click("#btn-export")]);
    const z3 = path.join(tmp, dl3.suggestedFilename());
    await dl3.saveAs(z3);
    ok("图片×名单（顺序）：导出成功", fs.statSync(z3).size > 5000);

    // ---- 8. 图片 × 名单 按文件名匹配 ----
    await reset();
    await page.setInputFiles("#roster-input", path.join(fx, "花名册_80人_utf8.csv"));
    await page.waitForFunction(() => document.getElementById("roster-badge").textContent.includes("80"), { timeout: 8000 });
    await page.setInputFiles("#file-input", [named["钱芳"], named["孙娜"], named["李敏"]]);
    await page.waitForFunction(() => document.querySelectorAll("#image-list li").length === 3, { timeout: 8000 });
    await page.check('input[name="batch-mode"][value="one-to-one"]');
    await page.selectOption("#match-by", "filename");
    await page.waitForTimeout(500);
    const cnt4 = await page.textContent("#export-count");
    ok("按文件名匹配：3 张全部匹配", cnt4.includes("3"), cnt4);
    const previewNote = await page.textContent("#preview-meta");
    ok("按文件名匹配：预览提示匹配到学生", previewNote.includes("钱芳"), previewNote);

    const [dl4] = await Promise.all([page.waitForEvent("download"), page.click("#btn-export")]);
    const z4 = path.join(tmp, dl4.suggestedFilename());
    await dl4.saveAs(z4);
    ok("按文件名匹配：导出成功", fs.statSync(z4).size > 3000);

    ok("全程无 JS 报错", errs.length === 0, errs.slice(0, 3).join(" ; "));
    console.log("\nTMP=" + tmp);
  } catch (e) {
    console.error("异常:", e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }

  const failed = report.filter((r) => !r).length;
  console.log(`\n合计 ${report.length} 项，失败 ${failed} 项`);
  if (failed) process.exitCode = 1;
})();
