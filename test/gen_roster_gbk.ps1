# 生成 GBK 编码的测试花名册（模拟 Excel 直接另存的 CSV），用于验证乱码回退解码
$ErrorActionPreference = "Stop"

$surnames = "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜".ToCharArray()
$given = @("伟","芳","娜","敏","静","磊","洋","强","军","杰","娟","涛","明","超","秀英","霞","平","刚","桂英","文轩")

$rows = New-Object System.Collections.Generic.List[string]
$rows.Add("姓名,学号,班级")
for ($i = 1; $i -le 80; $i++) {
  $s = $surnames[$i % $surnames.Length]
  $g = $given[$i % $given.Length]
  $id = "2023" + (100000 + $i).ToString()
  $rows.Add("$s$g,$id,软件2301班")
}

$outDir = Join-Path $PSScriptRoot "fixtures"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir "花名册_80人_gbk.csv"
[System.IO.File]::WriteAllBytes($out, [System.Text.Encoding]::GetEncoding("GB2312").GetBytes(($rows -join "`r`n")))
Write-Output "OK: $out"
