#!/bin/bash
set -e
cd "/g/Account Ledger Search v 1.1"

CRED=$(printf "protocol=https\nhost=github.com\n\n" | GIT_TERMINAL_PROMPT=0 git credential fill | grep '^password=')
TOKEN=${CRED#password=}
if [ -z "$TOKEN" ]; then echo "NO_CREDENTIAL"; exit 1; fi
echo "cred captured: yes"

git tag -f v1.1.0
git push -f origin v1.1.0 2>&1 | tail -2

echo "=== create release ==="
RELEASE=$(curl -s -X POST https://api.github.com/repos/chenxiaojie1009/Account-Ledger-Search/releases \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d '{"tag_name":"v1.1.0","name":"台账查找 v1.1.0","body":"台账查找系统 v1.1\\n- APK（平板查看版）：dist/台账查找-v1.1-debug.apk\\n- 后端 EXE（Windows 部署）：TaizhangBackend.exe（数据与后台管理 10600，后台管理 http://IP:10600/admin）\\n- 默认管理员 admin / 123456","draft":false,"prerelease":false}')
echo "$RELEASE" | head -c 300
echo
UPLOAD_URL=$(echo "$RELEASE" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(j.upload_url||'')}catch(e){console.log('')}})")
if [ -z "$UPLOAD_URL" ]; then echo "RELEASE_CREATE_FAILED"; exit 1; fi
BASE_URL="${UPLOAD_URL%%{*}"

echo "=== upload assets ==="
up() {
  local file="$1" name="$2"
  local enc=$(node -e "console.log(encodeURIComponent('$name'))")
  local res=$(curl -s -X POST "$BASE_URL?name=$enc" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/octet-stream" --data-binary @"$file")
  echo "$res" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log('asset:',j.name,'id:',j.id,'size:',j.size)}catch(e){console.log('asset upload failed:',d.slice(0,150))}})"
}
up "dist/台账查找-v1.1-debug.apk" "台账查找-v1.1-debug.apk"
up "dist/taizhang-v1.1-debug.apk" "taizhang-v1.1-debug.apk"
up "deploy/TaizhangBackend.exe" "TaizhangBackend.exe"
echo DONE
