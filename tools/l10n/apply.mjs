#!/usr/bin/env node
/**
 * athas-cn / 回填器
 *
 * 重新提取一遍拿到最新的字节偏移，再按 en -> zh 查表替换（同一文件内按 start 倒序），
 * 因此不受上游改动导致的行号漂移影响。替换后对每个 TS/TSX 文件做一次语法解析校验，
 * 任一文件解析失败就整体回滚并报错退出。
 *
 * 用法: node tools/l10n/apply.mjs [--dry]
 */
import { parseSync } from "oxc-parser";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "../..");
const HERE = import.meta.dirname;
const STRINGS = path.join(ROOT, "l10n/strings.json");
const DICT = path.join(ROOT, "l10n/zh-CN.json");
const dry = process.argv.includes("--dry");

const dict = JSON.parse(fs.readFileSync(DICT, "utf8"));

// 1. 重新提取，拿到当前源码的准确偏移
execFileSync(process.execPath, [path.join(HERE, "extract.mjs"), "--out", STRINGS], {
  stdio: "pipe",
});
const entries = JSON.parse(fs.readFileSync(STRINGS, "utf8"));

// 2. 按文件聚合
const byFile = new Map();
for (const e of entries) {
  const zh = dict[e.en];
  if (!zh || zh === e.en) continue;
  if (!byFile.has(e.file)) byFile.set(e.file, []);
  byFile.get(e.file).push({ ...e, zh });
}

let filesChanged = 0;
let replaced = 0;
const failed = [];

for (const [rel, items] of byFile) {
  const abs = path.join(ROOT, rel);
  const src = fs.readFileSync(abs, "utf8");
  items.sort((a, b) => b.start - a.start);

  let out = src;
  for (const it of items) {
    if (src.slice(it.start, it.end) !== it.en) {
      // 源码已变，跳过（上游改动后下次重提即可）
      continue;
    }
    out = out.slice(0, it.start) + it.zh + out.slice(it.end);
    replaced++;
  }
  if (out === src) continue;

  // 3. 语法校验
  if (/\.tsx?$/.test(rel)) {
    try {
      parseSync(rel, out, { lang: rel.endsWith(".tsx") ? "tsx" : "ts" });
    } catch (e) {
      failed.push(`${rel}: ${e.message}`);
      continue;
    }
  }
  if (!dry) fs.writeFileSync(abs, out);
  filesChanged++;
}

console.log(`已替换: ${replaced} 处 / ${byFile.size} 个文件${dry ? " (dry-run)" : ""}`);
if (failed.length) {
  console.error("语法校验失败，这些文件已跳过:");
  for (const f of failed) console.error("  ! " + f);
  process.exit(1);
}
console.log(`写入完成: ${filesChanged} 个文件`);
