// 生成 README 用的界面截图
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const { suppressOnboard } = require("./_helpers");

(async () => {
  const fx = path.join(__dirname, "fixtures");
  const shotDir = path.join(__dirname, "shots");
  const docsDir = path.join(__dirname, "..", "docs");
  fs.mkdirSync(shotDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  const browser = await chromium.launch();

  // 截图专用：让左侧整列自然展开，避免被内部滚动裁掉
  const expandCss = `
    .layout { height: auto !important; align-items: stretch !important; }
    .controls { overflow: visible !important; }
    .preview { min-height: 640px; }
    .preview-canvas-wrap { min-height: 520px !important; align-items: flex-start !important; }
  `;

  // 桌面端：带花名册的完整界面
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await suppressOnboard(page);
  await page.goto("http://localhost:8765", { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.setInputFiles("#roster-input", path.join(fx, "花名册_80人_utf8.csv"));
  await page.waitForFunction(
    () => document.getElementById("roster-badge").textContent.includes("80"),
    { timeout: 9000 }
  );
  await page.setInputFiles("#file-input", [path.join(fx, "网页截图.png")]);
  await page.waitForFunction(
    () => document.querySelectorAll("#image-list li").length === 1,
    { timeout: 9000 }
  );
  await page.fill("#tpl", "{姓名}\n{学号} {班级}");
  await page.waitForTimeout(600);
  await page.addStyleTag({ content: expandCss });
  await page.waitForTimeout(200);
  // 视口高度贴合左侧内容，避免超长空白
  const needH = await page.evaluate(() => {
    const controls = document.querySelector(".controls");
    return Math.ceil(controls.scrollHeight + 160);
  });
  await page.setViewportSize({ width: 1440, height: Math.min(needH, 2800) });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shotDir, "batch-ui.png") });
  await page.screenshot({ path: path.join(docsDir, "screenshot.png") });
  await ctx.close();

  // 手机端
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await mctx.newPage();
  await suppressOnboard(mp);
  await mp.goto("http://localhost:8765", { waitUntil: "networkidle" });
  await mp.setInputFiles("#file-input", [path.join(fx, "手机截图.png")]);
  await mp.waitForFunction(
    () => document.querySelectorAll("#image-list li").length === 1,
    { timeout: 9000 }
  );
  await mp
    .locator("#meta-fields .meta-row")
    .nth(0)
    .locator("input")
    .nth(1)
    .fill("张三");
  await mp.waitForTimeout(500);
  await mp.screenshot({ path: path.join(shotDir, "mobile.png"), fullPage: true });
  await mp.screenshot({ path: path.join(docsDir, "mobile.png"), fullPage: true });
  await mctx.close();

  await browser.close();
  console.log("截图已生成:", fs.readdirSync(shotDir).join(", "));
})();
