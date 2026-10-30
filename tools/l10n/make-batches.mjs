#!/usr/bin/env node
/**
 * 把 strings.json 去重后按「可见度优先级」切成等大小批次，供人工/模型逐批翻译。
 * 用法: node tools/l10n/make-batches.mjs [每批条数=150]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SIZE = Number(process.argv[2] || 150);
const entries = JSON.parse(fs.readFileSync(path.join(ROOT, "l10n/strings.json"), "utf8"));

const HIGH = /(keymap|command-palette|command|menu|settings|onboarding|welcome|preferences)/i;
const MID = /\/(ai|git|terminal|editor|file-explorer|layout|workspace)\//i;

const groups = new Map();
for (const e of entries) {
  const g = groups.get(e.en) || { en: e.en, n: 0, score: 0, files: new Set(), ctx: e.ctx, kinds: new Set() };
  g.n++;
  g.files.add(e.file);
  g.kinds.add(e.kind.split(":")[0]);
  groups.set(e.en, g);
}
for (const g of groups.values()) {
  const k = [...g.kinds];
  let s = 0;
  if (k.includes("jsx-text")) s += 3;
  if (k.includes("obj")) s += 3;
  if (k.includes("attr")) s += 2;
  if (k.includes("call")) s += 2;
  if (k.includes("rs-string")) s += 1;
  const f = [...g.files][0];
  if (HIGH.test(f)) s += 5;
  else if (MID.test(f)) s += 2;
  if (g.en.length > 60) s += 1; // 长句优先，短词可后补
  g.score = s;
}
const list = [...groups.values()]
  .map((g) => ({ en: g.en, n: g.n, score: g.score, file: [...g.files][0], kind: [...g.kinds].join(","), ctx: (g.ctx || "").slice(0, 120) }))
  .sort((a, b) => b.score - a.score || b.n - a.n || (a.en < b.en ? -1 : 1));

const dir = path.join(ROOT, "l10n/batches");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
for (let i = 0, b = 1; i < list.length; i += SIZE, b++) {
  fs.writeFileSync(path.join(dir, `batch-${String(b).padStart(2, "0")}.json`), JSON.stringify(list.slice(i, i + SIZE), null, 1));
}
fs.writeFileSync(path.join(ROOT, "l10n/todo.json"), JSON.stringify(list, null, 1));
console.log(`唯一词条: ${list.length}  批次: ${Math.ceil(list.length / SIZE)}  每批 ${SIZE}`);
