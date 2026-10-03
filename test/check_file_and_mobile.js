// 验证：1) file:// 双击打开可用  2) 手机窄屏排版正常
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

(async () => {
  const projectDir = path.resolve(__dirname, "..");
  const fileUrl = "file:///" + path.join(projectDir, "index.html").replace(/\\/g, "/");
  const fixtures = path.join(__dirname, "fixtures");
  const imgs = ["手机截图.png"].map((n) => path.join(fixtures, n));
  const shotDir = path.join(__dirname, "shots");
  fs.mkdirSync(shotDir, { recursive: true });

  const browser = await chromium.launch();
  let fail = 0;
  const ok = (n, c, e = "") => {
    if (!c) fail++;
    console.log(`${c ? "PASS" : "FAIL"}  ${n}${e ? "  | " + e : ""}`);
  };

  // --- file:// 直接打开 ---
  const p1 = await (await browser.newContext({ acceptDownloads: true })).newPage();
  const errs = [];
  p1.on("pageerror", (e) => errs.push(String(e)));
  p1.on("console", (m) => {
    if (m.type() === "error") errs.push(m.text());
  });
  await p1.goto(fileUrl, { waitUntil: "load" });
  await p1.setInputFiles("#file-input", imgs);
  await p1.waitForFunction(
    () => document.querySelectorAll("#image-list li").length === 1,
    { timeout: 8000 }
  );
  await p1.fill("#meta-name", "李四");
  await p1.waitForTimeout(300);
  ok("file:// 打开可加载图片", (await p1.textContent("#preview-meta")).includes("1 / 1"));
  ok("file:// 无 JS 报错", errs.length === 0, errs.join(" ; "));
  const [dl] = await Promise.all([
    p1.waitForEvent("download"),
    p1.click("#btn-download-current"),
  ]);
  ok("file:// 可导出", fs.existsSync(await dl.path().catch(() => "")), dl.suggestedFilename());
  await p1.close();

  // --- 手机窄屏 ---
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx.newPage();
  await p2.goto("http://localhost:8765", { waitUntil: "networkidle" });
  await p2.setInputFiles("#file-input", imgs);
  await p2.waitForFunction(
    () => document.querySelectorAll("#image-list li").length === 1,
    { timeout: 8000 }
  );
  await p2.waitForTimeout(400);
  const box = await p2.locator("#preview-canvas").boundingBox();
  ok("手机端预览可见", !!box && box.width > 50 && box.height > 50, box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "no box");
  const overflow = await p2.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 2
  );
  ok("手机端无横向溢出", !overflow);
  await p2.screenshot({ path: path.join(shotDir, "mobile.png"), fullPage: true });
  ok("手机截图已保存", true);
  await ctx.close();

  await browser.close();
  console.log(`\n失败 ${fail} 项`);
  if (fail) process.exitCode = 1;
})();
