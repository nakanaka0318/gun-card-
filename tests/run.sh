#!/bin/sh
# ver9 の検証をまとめて走らせる。Chromium と Playwright の場所は環境変数で差し替えられる。
#   例: PW=/opt/node22/lib/node_modules/playwright/index.js sh tests/run.sh
cd "$(dirname "$0")/.." || exit 1
tot=0; fail=0
for t in tests/t9*.mjs; do
  o=$(node "$t" 2>&1)
  a=$(echo "$o" | grep -c '^PASS'); b=$(echo "$o" | grep -c '^FAIL')
  tot=$((tot + a + b)); fail=$((fail + b))
  printf '%-16s %3d pass / %d fail\n' "$(basename "$t")" "$a" "$b"
  [ "$b" != "0" ] && echo "$o" | grep '^FAIL'
done
echo "==== 合計 $tot 項目 / 失敗 $fail ===="
[ "$fail" = "0" ]
