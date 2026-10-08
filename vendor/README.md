# vendor 说明

## jszip.min.js

- 来源：https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
- 版本：3.10.1
- 许可：MIT or GPLv3（双协议，本项目按 MIT 使用）
- 用途：在浏览器本地把多张处理后的图片打包成 ZIP

之所以把 JSZip 放在仓库里而不是用 CDN，是为了让这个工具**完全离线可用**——
下载后双击 `index.html` 就能跑，不需要联网，也不会有第三方请求。

如需升级，请从上述来源重新下载对应版本，并同步更新本文件。

## xlsx.full.min.js

- 来源：https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
- 版本：0.20.3
- 许可：Apache-2.0（见 `xlsx-LICENSE.txt`）
- 用途：解析导入的 Excel（.xlsx / .xls）花名册
- 版本核实：已于 2026-10 与官方 `xlsx-latest` 通道比对 SHA-256 一致（当前最新 standalone 即 0.20.3）

同样为了离线可用而放入仓库。如果不导入 Excel、只用 CSV 或粘贴，
这个文件理论上可以删掉（但要同时去掉 `index.html` 里的 script 引用）。
