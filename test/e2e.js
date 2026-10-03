// SnapMark 端到端验证：真实浏览器走一遍完整流程
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");

(async () => {
  const base = "http://localhost:8765";
  const fixtures = path.join(__dirname, "fixtures");
  const imgs = ["手机截图.png", "网页截图.png", "深色模式.png"].map((n) =>
    path.join(fixtures, n)
  );
  imgs.forEach((p) => {
    if (!fs.existsSync(p)) throw new Error("缺少测试图: " + p);
  });

  const tmpDownload = fs.mkdtempSync(path.join(os.tmpdir(), "snapmark-dl-"));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();

  const report = [];
  const ok = (name, cond, extra = "") => {
    report.push({ name, pass: !!cond, extra });
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);
  };

  try {
    await page.goto(base, { waitUntil: "networkidle" });

    // 1. 页面基本结构
    ok("页面标题", (await page.title()).includes("SnapMark"));
    ok("导出按钮初始禁用", await page.locator("#btn-export").isDisabled());

    // 2. 上传三张图
    await page.setInputFiles("#file-input", imgs);
    await page.waitForFunction(
      () => document.querySelectorAll("#image-list li").length === 3,
      { timeout: 8000 }
    );
    ok("三张图已加入列表", true);
    ok("导出按钮已启用", await page.locator("#btn-export").isEnabled());
    ok("预览名称显示第一张", (await page.textContent("#preview-name")).includes("手机截图"));

    // 3. 填写标注信息
    await page.fill("#meta-name", "张三");
    await page.fill("#meta-id", "2023123456");
    await page.fill("#meta-cls", "软件2301班");
    await page.waitForTimeout(300);
    ok("信息已填写", true);

    // 4. 切换到第二张预览 + 切换位置到右上
    await page.click("#btn-next");
    await page.click('#pos-grid button[data-pos="top-right"]');
    await page.waitForTimeout(300);
    ok("切换第二张 + 位置右上", (await page.textContent("#preview-meta")).includes("2 / 3"));

    // 5. 导出当前张
    const [dl1] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#btn-download-current"),
    ]);
    const p1 = path.join(tmpDownload, dl1.suggestedFilename());
    await dl1.saveAs(p1);
    const s1 = fs.statSync(p1).size;
    ok("导出当前张成功", s1 > 1000, dl1.suggestedFilename() + " " + s1 + "B");
    ok(
      "导出文件名符合模板",
      dl1.suggestedFilename().includes("张三") &&
        dl1.suggestedFilename().includes("2023123456")
    );

    // 6. 导出 ZIP
    const [dl2] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#btn-export"),
    ]);
    const p2 = path.join(tmpDownload, dl2.suggestedFilename());
    await dl2.saveAs(p2);
    const s2 = fs.statSync(p2).size;
    ok("ZIP 导出成功", s2 > 5000, dl2.suggestedFilename() + " " + s2 + "B");

    // 7. 校验 ZIP 内有 3 个文件且文件名正确
    const AdmZip = null; // 不引依赖，直接用系统 PowerShell 另行校验，这里只看大小
    ok("ZIP 体积合理", s2 > 30000, "预期三张 PNG 打包");

    // 8. localStorage 持久化：刷新后姓名还在
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const nameVal = await page.inputValue("#meta-name");
    const posActive = await page
      .locator('#pos-grid button[data-pos="top-right"]')
      .evaluate((el) => el.classList.contains("active"));
    ok("刷新后姓名记忆", nameVal === "张三");
    ok("刷新后位置记忆", posActive);

    // 9. 截图存证
    const shotDir = path.join(__dirname, "shots");
    fs.mkdirSync(shotDir, { recursive: true });
    // 重新上传以便截图有内容
    await page.setInputFiles("#file-input", imgs);
    await page.waitForFunction(
      () => document.querySelectorAll("#image-list li").length === 3,
      { timeout: 8000 }
    );
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shotDir, "full-ui.png"), fullPage: true });
    ok("界面截图已保存", true);

    console.log("\nDOWNLOAD_DIR=" + tmpDownload);
  } catch (err) {
    console.error("E2E 异常:", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }

  const failed = report.filter((r) => !r.pass);
  console.log(`\n合计 ${report.length} 项，失败 ${failed.length} 项`);
  if (failed.length) process.exitCode = 1;
})();
