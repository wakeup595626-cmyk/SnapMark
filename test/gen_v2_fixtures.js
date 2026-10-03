// 生成新功能测试素材：多列花名册 + 一张小尺寸底图
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

function crc32(buf) {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function makePng(width, height, painter) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = painter(x, y, width, height);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, "fixtures");
fs.mkdirSync(outDir, { recursive: true });

// 小底图：批量 80 张导出时用，跑得快
const small = makePng(480, 320, (x, y, w, h) => {
  const t = y / h;
  return [Math.round(40 + 30 * t), Math.round(70 + 20 * t), Math.round(140 + 40 * t), 255];
});
fs.writeFileSync(path.join(outDir, "小图.png"), small);

// 多列花名册：验证任意列都能当模板变量
const surnames = "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜";
const given = ["伟", "芳", "娜", "敏", "静", "磊", "洋", "强", "军", "杰", "娟", "涛", "明", "超", "秀英", "霞", "平", "刚", "桂英", "文轩"];

const rows = [["姓名", "学号", "班级", "日期", "是否成功"]];
for (let i = 1; i <= 80; i++) {
  const s = surnames[i % surnames.length];
  const g = given[i % given.length];
  const id = `2023${String(100000 + i)}`;
  const day = String(((i - 1) % 28) + 1).padStart(2, "0");
  rows.push([`${s}${g}`, id, "软件2301班", `2026-03-${day}`, i % 3 === 0 ? "否" : "是"]);
}
const csv = rows.map((r) => r.join(",")).join("\r\n");
fs.writeFileSync(path.join(outDir, "花名册_80人_多列.csv"), "\uFEFF" + csv, "utf8");

console.log("OK:", fs.readdirSync(outDir).join(", "));
