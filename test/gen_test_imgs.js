// 生成 3 张不同尺寸、不同配色的测试 PNG（无需原生依赖，纯 Node）
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
    raw[o++] = 0; // filter: none
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// 模拟手机竖屏截图
const img1 = makePng(720, 1440, (x, y, w, h) => {
  const t = y / h;
  const r = Math.round(30 + 60 * t);
  const g = Math.round(60 + 40 * t);
  const b = Math.round(120 + 80 * t);
  // 顶部状态栏
  if (y < 60) return [20, 20, 40, 255];
  // 底部导航
  if (y > h - 90) return [25, 28, 50, 255];
  // 模拟列表项分隔线
  if (y % 140 < 3 && y > 100 && y < h - 120) return [90, 100, 160, 255];
  return [r, g, b, 255];
});

// 模拟电脑网页截图
const img2 = makePng(1280, 800, (x, y, w, h) => {
  const t = x / w;
  const r = Math.round(240 - 80 * t);
  const g = Math.round(230 - 40 * t);
  const b = Math.round(220 - 20 * t);
  if (y < 70) return [245, 245, 247, 255]; // 浏览器顶栏
  if (x < 200) return [230, 232, 240, 255]; // 侧栏
  return [r, g, b, 255];
});

// 模拟深色模式截图
const img3 = makePng(1080, 1080, (x, y, w, h) => {
  const cx = w / 2, cy = h / 2;
  const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  const ring = Math.abs(Math.sin(d / 60)) * 60;
  const v = Math.round(18 + ring);
  return [v, v + 6, v + 14, 255];
});

const outDir = path.join(__dirname, "fixtures");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "手机截图.png"), img1);
fs.writeFileSync(path.join(outDir, "网页截图.png"), img2);
fs.writeFileSync(path.join(outDir, "深色模式.png"), img3);
console.log("OK:", fs.readdirSync(outDir).join(", "));
