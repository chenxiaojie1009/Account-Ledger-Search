const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const src = path.join(projectRoot, 'www');
const dest = path.join(projectRoot, 'harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'www');

if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error('[harmony:sync] 找不到 www/index.html,请在项目根目录运行');
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else files.push(full);
  }
})(dest);

console.log(`[harmony:sync] 已同步 ${files.length} 个文件 -> harmony/entry/src/main/resources/rawfile/www`);
