// 验证「双击 index.html（file://）」也能跑完整的批量 + 随机导出
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { suppressOnboard } = require("./_helpers");

(async () => {
  const dir = path.resolve(__dirname, "..").replace(/\\/g, "/");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "snapmark-desktop-"));
  const fx = path.join(__dirname, "fixtures");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push(m.text());
  });

  let fail = 0;
  const ok = (n, c, e = "") => {
    if (!c) fail++;
    console.log(`${c ? "PASS" : "FAIL"}  ${n}${e ? "  | " + e : ""}`);
  };

  await suppressOnboard(page);
  await page.goto("file:///" + dir + "/index.html", { waitUntil: "load" });

  // 导入 80 人花名册
  await page.setInputFiles("#roster-input", path.join(fx, "花名册_80人_utf8.csv"));
  await page.waitForFunction(
    () => document.getElementById("roster-badge").textContent.includes("80"),
    { timeout: 9000 }
  );
  ok("本地双击版：导入花名册 80 人", true, await page.textContent("#roster-badge"));

  // 一图 × 80 人
  await page.setInputFiles("#file-input", [path.join(fx, "网页截图.png")]);
  await page.waitForFunction(
    () => document.querySelectorAll("#image-list li").length === 1,
    { timeout: 9000 }
  );
  await page.check('input[name="batch-mode"][value="one-to-many"]');
  await page.waitForTimeout(500);
  ok("本地双击版：显示将生成 80 张", (await page.textContent("#export-count")).includes("80"));

  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#btn-export"),
  ]);
  const out = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(out);
  ok("本地双击版：导出 80 张 ZIP", fs.statSync(out).size > 100000, Math.round(fs.statSync(out).size / 1024) + "KB");
  ok("本地双击版：无 JS 报错", errs.length === 0, errs.slice(0, 2).join(";"));

  await browser.close();
  console.log("\nZIP=" + out);
  if (fail) process.exitCode = 1;
})();
