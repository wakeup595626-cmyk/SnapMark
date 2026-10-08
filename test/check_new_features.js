// SnapMark 新功能验证：撤销/重做、描边、阴影、样式方案、导出进度、单张直出、CSP
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { suppressOnboard, openAllDetails } = require("./_helpers");

(async () => {
  const base = "http://localhost:8765";
  const fixtures = path.join(__dirname, "fixtures");
  const img = path.join(fixtures, "手机截图.png");
  if (!fs.existsSync(img)) throw new Error("缺少测试图: " + img);

  const tmpDownload = fs.mkdtempSync(path.join(os.tmpdir(), "snapmark-feat-"));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();

  const report = [];
  const ok = (name, cond, extra = "") => {
    report.push({ name, pass: !!cond, extra });
    console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "  | " + extra : ""));
  };
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push("console: " + m.text());
  });
  // 页面里所有原生弹窗（alert/prompt/confirm）统一处理，避免 prompt 默认值互相干扰
  page.on("dialog", (d) => {
    const msg = d.message();
    if (msg.indexOf("起个名字") !== -1) d.accept("我的方案A");
    else d.accept();
  });

  // 预览画布的抽样签名（用于检测画布是否发生可见变化）
  const canvasSig = () =>
    page.evaluate(() => {
      const c = document.getElementById("preview-canvas");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let sum = 0, n = 0;
      for (let k = 0; k < d.length; k += 397 * 4) {
        sum = (sum + d[k] * 3 + d[k + 1] * 5 + d[k + 2] * 7) % 1000000007;
        n++;
      }
      return { sum, n };
    });

  try {
    await suppressOnboard(page);
    await page.goto(base, { waitUntil: "networkidle" });

    // 0. CSP meta 存在且限制 script-src 到 self
    const csp = await page.evaluate(() => {
      const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      return m ? m.content : "";
    });
    ok("CSP meta 存在且 script-src 限定 self",
      csp.includes("script-src 'self'") && csp.includes("default-src 'self'"));

    // 1. 上传一张图，填写标注
    await page.setInputFiles("#file-input", [img]);
    await page.waitForFunction(
      () => document.querySelectorAll("#image-list li").length === 1,
      { timeout: 8000 }
    );
    await openAllDetails(page);
    const metaVal = (i) =>
      page.locator("#meta-fields .meta-row").nth(i).locator("input").nth(1);
    await metaVal(0).fill("测试员");
    await page.waitForTimeout(400);
    ok("单图导入并填好标注", true);

    // 2. 撤销/重做：改字号后 Ctrl+Z 恢复
    const sizeBefore = await page.locator("#font-size").inputValue();
    await page.locator("#font-size").fill("10");
    await page.waitForTimeout(400);
    const sizeAfter = await page.locator("#font-size").inputValue();
    ok("字号已从 " + sizeBefore + " 改为 " + sizeAfter, sizeAfter === "10");
    ok("撤销按钮已可用", await page.locator("#btn-undo").isEnabled());
    // 把焦点挪出输入框，快捷键 handler 会忽略输入框内的按键
    await page.click(".logo");
    await page.waitForTimeout(150);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(700);
    const sizeUndone = await page.locator("#font-size").inputValue();
    ok("Ctrl+Z 撤销后字号恢复为 " + sizeUndone, sizeUndone === sizeBefore);
    await page.click(".logo");
    await page.keyboard.press("Control+y");
    await page.waitForTimeout(400);
    const sizeRedone = await page.locator("#font-size").inputValue();
    ok("Ctrl+Y 重做后字号回到 " + sizeRedone, sizeRedone === "10");
    await page.click("#btn-undo");
    await page.waitForTimeout(300);
    ok("点撤销按钮同样生效", (await page.locator("#font-size").inputValue()) === sizeBefore);
    // 重做把字号带回 10，再撤销回基准，保证后续描边对比不受字号差异影响
    await page.click(".logo");
    await page.keyboard.press("Control+y");
    await page.waitForTimeout(200);
    await page.click(".logo");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);

    // 3. 文字描边：开启后 state 生效且画布签名变化
    const sig0 = await canvasSig();
    await page.check("#outline-enabled");
    await page.waitForTimeout(900);
    const olOn = await page.evaluate(() => window.__snapmark.state.settings.outline.enabled);
    const sig1 = await canvasSig();
    ok("开启描边后 state 生效且画布变化", olOn === true && sig1.sum !== sig0.sum,
      "enabled=" + olOn + " sig " + sig0.sum + "->" + sig1.sum);
    ok("描边设置面板已展开", await page.locator("#outline-body").isVisible());

    // 4. 文字阴影：开启后 state 生效且画布签名再次变化
    await page.check("#shadow-enabled");
    await page.waitForTimeout(600);
    const shOn = await page.evaluate(() => window.__snapmark.state.settings.shadow.enabled);
    const sig2 = await canvasSig();
    ok("开启阴影后 state 生效且画布变化", shOn === true && sig2.sum !== sig1.sum,
      "enabled=" + shOn + " sig " + sig1.sum + "->" + sig2.sum);
    await page.uncheck("#outline-enabled");
    await page.uncheck("#shadow-enabled");
    await page.waitForTimeout(400);

    // 5. 内置样式方案：套用醒目黄字后字号变为 6
    await page.waitForSelector("#preset-chips .preset-chip", { timeout: 5000 });
    const chipCount = await page.locator("#preset-chips .preset-chip").count();
    ok("内置样式方案已渲染（4 个）", chipCount === 4, "实际 " + chipCount + " 个");
    await page.locator("#preset-chips .preset-chip", { hasText: "醒目黄字" }).first().click();
    await page.waitForTimeout(400);
    ok("套用醒目黄字后字号=6", (await page.locator("#font-size").inputValue()) === "6");
    await page.click(".logo");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(600);
    ok("预设套用也可撤销", (await page.locator("#font-size").inputValue()) === sizeBefore);

    // 6. 自定义方案：保存 -> 出现 chip -> 刷新仍在 -> 删除（弹窗由统一 handler 处理）
    await page.click("#btn-save-preset");
    await page.waitForTimeout(400);
    const customChip = page.locator("#preset-chips .preset-chip", { hasText: "我的方案A" });
    ok("自定义方案已保存并显示", (await customChip.count()) === 1);
    await page.reload({ waitUntil: "networkidle" });
    await openAllDetails(page);
    ok("刷新后自定义方案仍在",
      (await page.locator("#preset-chips .preset-chip", { hasText: "我的方案A" }).count()) === 1);
    await page.locator("#preset-chips .preset-chip", { hasText: "我的方案A" }).locator(".del-preset").click();
    await page.waitForTimeout(300);
    ok("自定义方案可删除",
      (await page.locator("#preset-chips .preset-chip", { hasText: "我的方案A" }).count()) === 0);

    // 7. 单张导出：直接出 PNG 而非 ZIP，且进度条显示过
    await page.setInputFiles("#file-input", [img]);
    await page.waitForFunction(
      () => document.querySelectorAll("#image-list li").length === 1,
      { timeout: 8000 }
    );
    await page.click("#btn-export");
    const progressShown = await page.waitForSelector("#export-progress:not([hidden])", { timeout: 8000 })
      .then(() => true).catch(() => false);
    const dl = await page.waitForEvent("download", { timeout: 15000 });
    const fname = dl.suggestedFilename();
    ok("单张导出直接是 PNG", /\.png$/i.test(fname), fname);
    ok("单张导出时进度条曾显示", progressShown);
    const p1 = path.join(tmpDownload, fname);
    await dl.saveAs(p1);
    ok("单张 PNG 体积合理", fs.statSync(p1).size > 1000, fs.statSync(p1).size + "B");
    await page.waitForSelector("#export-progress[hidden]", { timeout: 5000 });
    ok("导出后进度条自动隐藏", true);

    // 8. 批量导出：ZIP + 进度条（追加两张凑满 3 张）
    await page.setInputFiles("#file-input", [
      path.join(fixtures, "网页截图.png"),
      path.join(fixtures, "深色模式.png"),
    ]);
    await page.waitForFunction(
      () => document.querySelectorAll("#image-list li").length === 3,
      { timeout: 8000 }
    );
    const progressShown2 = page.waitForSelector("#export-progress:not([hidden])", { timeout: 8000 })
      .then(() => true).catch(() => false);
    const [dl2] = await Promise.all([
      page.waitForEvent("download", { timeout: 25000 }),
      page.click("#btn-export"),
    ]);
    ok("多张导出仍是 ZIP", /\.zip$/i.test(dl2.suggestedFilename()), dl2.suggestedFilename());
    ok("批量导出时进度条曾显示", await progressShown2);
    await page.waitForSelector("#export-progress[hidden]", { timeout: 5000 });
    ok("批量导出后进度条自动隐藏", true);

    ok("页面无 JS 报错", pageErrors.length === 0, pageErrors[0] || "");
  } catch (err) {
    console.error("E2E 异常:", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }

  const failed = report.filter((r) => !r.pass);
  console.log("\n合计 " + report.length + " 项，失败 " + failed.length + " 项");
  if (failed.length) process.exitCode = 1;
})();
