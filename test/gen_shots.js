// 生成 README 用的界面截图
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

(async () => {
  const fx = path.join(__dirname, "fixtures");
  const shotDir = path.join(__dirname, "shots");
  fs.mkdirSync(shotDir, { recursive: true });

  const browser = await chromium.launch();

  // 桌面端：带花名册的完整界面
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
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
  await page.check('input[name="batch-mode"][value="one-to-one"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(shotDir, "batch-ui.png"), fullPage: true });
  await ctx.close();

  // 手机端
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await mctx.newPage();
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
  await mctx.close();

  await browser.close();
  console.log("截图已生成:", fs.readdirSync(shotDir).join(", "));
})();
