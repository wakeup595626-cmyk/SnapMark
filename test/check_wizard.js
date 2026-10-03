/* 向导式界面快速检查：
 * 1. 新手引导出现且可关闭
 * 2. 4 个步骤卡片齐全
 * 3. 默认单张模式：显示手动字段、隐藏名单区
 * 4. 打开批量开关 → 名单区出现、手动字段隐藏
 * 5. 放一张图 → 第 1 步徽标变化、导出按钮可用
 * 6. 无 JS 报错
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const BASE = "http://localhost:8765/";
const SHOT_DIR = path.join(__dirname, "shots");
fs.mkdirSync(SHOT_DIR, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); }
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  // 清掉 localStorage，模拟全新用户
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(400);

  console.log("== 新手引导 ==");
  ok("引导弹层出现", await page.isVisible("#onboard"));
  await page.click("#btn-onboard-close");
  await page.waitForTimeout(200);
  ok("关闭后消失", !(await page.isVisible("#onboard")));
  await page.reload();
  await page.waitForTimeout(400);
  ok("刷新后不再出现", !(await page.isVisible("#onboard")));

  console.log("== 步骤结构 ==");
  for (const id of ["#step-1", "#step-2", "#step-3", "#step-4"]) {
    ok(`步骤卡片 ${id}`, await page.$(id) !== null);
  }
  ok("第 1 步徽标：还没放图", (await page.textContent("#step1-badge")).includes("还没放图"));
  ok("图片列表默认隐藏", !(await page.isVisible("#image-list-wrap")));

  console.log("== 默认单张模式 ==");
  ok("手动字段区可见", await page.isVisible("#meta-section"));
  ok("名单区隐藏", !(await page.isVisible("#roster-body")));
  ok("批量开关未勾选", !(await page.isChecked("#roster-toggle")));
  ok("批量开关有小白说明", (await page.textContent("#roster-toggle-hint")).length > 0);

  console.log("== 打开批量开关 ==");
  // 拦截弹出的文件选择框
  const fcPromise = page.waitForEvent("filechooser", { timeout: 2000 }).catch(() => null);
  await page.check("#roster-toggle");
  await page.waitForTimeout(300);
  const fc = await fcPromise;
  ok("自动弹出文件选择框", fc !== null);
  if (fc) await fc.setFiles(path.join(__dirname, "fixtures", "花名册_80人_多列.csv"));
  await page.waitForTimeout(800);
  ok("名单区展开", await page.isVisible("#roster-body"));
  ok("手动字段区隐藏", !(await page.isVisible("#meta-section")));
  ok("识别到 80 人", (await page.textContent("#roster-badge")).includes("80"));
  ok("名单详情出现", await page.isVisible("#roster-detail"));
  ok("默认选中「同一张图」", await page.isChecked('input[name="batch-mode"][value="one-to-many"]'));

  console.log("== 关闭批量开关 ==");
  await page.uncheck("#roster-toggle");
  await page.waitForTimeout(200);
  ok("名单区收起", !(await page.isVisible("#roster-body")));
  ok("手动字段区回来", await page.isVisible("#meta-section"));

  console.log("== 放图 ==");
  const fc2 = page.waitForEvent("filechooser");
  await page.click("#dropzone");
  (await fc2).setFiles(path.join(__dirname, "fixtures", "小图.png"));
  await page.waitForTimeout(800);
  ok("第 1 步徽标更新", (await page.textContent("#step1-badge")).includes("1"));
  ok("图片列表出现", await page.isVisible("#image-list-wrap"));
  ok("导出按钮可用", await page.isEnabled("#btn-export"));
  ok("显示「将生成 1 张」", (await page.textContent("#export-count")).includes("1"));

  console.log("== 高级选项默认收起 ==");
  ok("更多样式折叠", !(await page.isVisible("#font-weight")));
  ok("批量随机折叠", !(await page.isVisible("#random-size")));

  console.log("== 无 JS 报错 ==");
  ok("无 pageerror/console.error", errors.length === 0);
  if (errors.length) console.log("  错误:", errors.slice(0, 5));

  await page.screenshot({ path: path.join(SHOT_DIR, "wizard_desktop.png"), fullPage: true });

  // 手机端
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mob.goto(BASE);
  await mob.waitForTimeout(400);
  ok("手机端引导弹层出现", await mob.isVisible("#onboard"));
  await mob.click("#btn-onboard-close");
  await mob.waitForTimeout(200);
  await mob.screenshot({ path: path.join(SHOT_DIR, "wizard_mobile.png"), fullPage: true });

  await browser.close();
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
