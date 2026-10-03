/* 测试公共小工具 */
const ONBOARD_KEY = "snapmark.onboarded.v1";

/** 让页面在加载时就把「新手引导」标记为已看过，避免弹层挡住点击 */
async function suppressOnboard(target) {
  await target.addInitScript((k) => {
    try {
      localStorage.setItem(k, "1");
    } catch (_) {}
  }, ONBOARD_KEY);
}

/** 展开页面上所有 <details>（高级选项默认是收起的） */
async function openAllDetails(page) {
  await page.evaluate(() => {
    document.querySelectorAll("details").forEach((d) => (d.open = true));
  });
}

module.exports = { suppressOnboard, openAllDetails, ONBOARD_KEY };
