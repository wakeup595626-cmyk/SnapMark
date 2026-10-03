// 生成测试花名册：UTF-8(BOM) 与 GBK 两种编码，验证兼容性
const fs = require("fs");
const path = require("path");

const surnames = "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜";
const given = ["伟", "芳", "娜", "敏", "静", "磊", "洋", "强", "军", "杰", "娟", "涛", "明", "超", "秀英", "霞", "平", "刚", "桂英", "文轩"];

const rows = [];
rows.push(["姓名", "学号", "班级"]);
for (let i = 1; i <= 80; i++) {
  const s = surnames[i % surnames.length];
  const g = given[i % given.length];
  rows.push([`${s}${g}`, `2023${String(100000 + i)}`, "软件2301班"]);
}

const csv = rows.map((r) => r.join(",")).join("\r\n");
const outDir = path.join(__dirname, "fixtures");
fs.mkdirSync(outDir, { recursive: true });

// UTF-8 with BOM（Excel 的「CSV UTF-8」格式）
fs.writeFileSync(path.join(outDir, "花名册_80人_utf8.csv"), "\uFEFF" + csv, "utf8");

// TSV（模拟从 Excel 直接复制粘贴）
const tsv = rows.map((r) => r.join("\t")).join("\n");
fs.writeFileSync(path.join(outDir, "花名册_80人_粘贴用.tsv"), tsv, "utf8");

// GBK（Excel 的普通「CSV」格式）
// 用 Node 内置 TextEncoder 只能出 UTF-8，这里用 iconv-lite 的替代：手写一张 GBK 映射表太大，
// 改为用系统 PowerShell 的 Encoding 生成（见 gen_roster_gbk.ps1）

console.log("已生成:", fs.readdirSync(outDir).filter((f) => f.includes("花名册") || f.includes("粘贴")).join(", "));
