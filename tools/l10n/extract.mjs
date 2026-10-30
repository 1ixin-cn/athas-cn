#!/usr/bin/env node
/**
 * athas-cn / 字符串提取器
 *
 * 用 oxc-parser 做真 AST 解析，记录每个候选字符串的「字节偏移区间」。
 * 回填时按偏移量倒序替换，完全不依赖正则匹配，因此不会误伤同名字符串。
 *
 * 用法: node tools/l10n/extract.mjs [--out l10n/strings.json]
 */
import { parseSync } from "oxc-parser";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

const UI_ATTRS = new Set([
  "title", "placeholder", "aria-label", "aria-description", "alt", "label",
  "description", "tooltip", "helperText", "hint", "message", "summary",
  "emptyMessage", "errorMessage", "emptyState", "subtitle", "caption",
  "legend", "prompt", "warning", "note", "confirmText", "cancelText",
  "header", "sectionTitle", "displayName", "text", "content", "body",
  "name", "heading", "instructions", "shortDescription", "longDescription",
  "successMessage", "failureMessage", "statusMessage", "info",
]);

const UI_OBJ_KEYS = new Set([
  "label", "title", "description", "placeholder", "text", "tooltip",
  "hint", "message", "summary", "caption", "subtitle", "displayName",
  "name", "emptyMessage", "errorMessage", "sectionTitle", "heading",
]);

const UI_CALLS = new Set([
  "toast", "notify", "showToast", "showNotification", "showError",
  "showSuccess", "showInfo", "showWarning", "confirm", "alert",
  "showConfirm", "showDialog", "setStatus", "showMessage", "error",
  "success", "info", "warning",
]);

// 看起来像文案，而不是 key / class / 路径 / 颜色
function looksLikeProse(s) {
  const t = s.trim();
  if (t.length < 2 || t.length > 200) return false;
  if (!/[A-Za-z一-鿿]/.test(t)) return false;
  if (/[\n\r\t]/.test(t)) return false;
  if (t.includes("${") || t.includes("\\")) return false;
  if (/^https?:\/\//i.test(t) || t.startsWith("#")) return false;
  // 路径 / 文件名 / 扩展名
  if (/^\.{0,2}\//.test(t) || (t.includes("/") && !t.includes(" "))) return false;
  if (/^\.[a-z0-9]{1,5}$/.test(t)) return false;
  if (/\.(json|toml|ya?ml|md|ts|tsx|js|jsx|rs|svg|png|gif|lock|sh|ps1|exe|dmg|deb|rpm)$/i.test(t) && !t.includes(" ")) return false;
  if (/^[a-z][a-zA-Z0-9]*$/.test(t)) return false;           // camelCase key
  if (/^[\w.-]+$/.test(t)) return false;                     // 标识符 / 点号键
  if (/^-/.test(t)) return false;                             // CLI 参数
  if (/^[a-z0-9]+([-_.:/][a-z0-9]+)+$/.test(t)) return false; // kebab/snake/path/select
  if (/^[A-Z][a-zA-Z0-9]*$/.test(t) && !t.includes(" ")) {
    // 单个首字母大写词：只有当它是常见词时才收（由 UI_ATTRS/UI_CALLS 上下文决定）
    return false;
  }
  if (/^(flex|grid|absolute|relative|hidden|block|inline)/.test(t) && !/[一-鿿]/.test(t)) {
    const words = t.split(/\s+/);
    const tail = /^(items|justify|gap|px|py|pt|pb|pl|pr|mt|mb|ml|mr|w|h|text|bg|border|rounded|font|leading|tracking|opacity|z|top|bottom|left|right|min|max|space|overflow|cursor|select|transition|shadow|ring|outline|truncate|whitespace|antialiased|backdrop|object|inset|shrink|grow|basis|order|self|content|place|col|row|auto|none|full|screen|fit|center|start|end|between|around|evenly|stretch|wrap|nowrap|uppercase|lowercase|capitalize|italic|underline|bold|medium|semibold|thin|light|extrabold|sm|md|lg|xl)(-|$)/;
    if (words.every((w) => tail.test(w) || /^[a-z]+(-[a-z0-9]+)*(\[[^\]]+\])?$/.test(w))) return false;
  }
  return true;
}

const SKIP_FILE = (p) =>
  /(^|\/)(tests?|__tests__|__mocks__|fixtures|mocks|storybook|stories)(\/|$)/.test(p) ||
  /\.(test|spec|bench|stories)\.[tj]sx?$/.test(p) ||
  /\/extensions\/official\//.test(p) ||
  /\/languages?\//.test(p) ||
  p.endsWith(".d.ts");

function walkTs(file, src) {
  const rel = path.relative(ROOT, file);
  const out = [];
  let ast;
  try {
    ast = parseSync(rel, src, { lang: file.endsWith(".tsx") ? "tsx" : "ts" });
  } catch (e) {
    console.error(`  ! parse failed: ${rel}: ${e.message}`);
    return out;
  }

  const isStr = (n) =>
    !!n && (n.type === "Literal" || n.type === "StringLiteral") && typeof n.value === "string";

  const push = (node, kind, ctx) => {
    if (!node || typeof node.start !== "number") return;
    let raw = src.slice(node.start, node.end);
    let s0 = node.start;
    let e0 = node.end;
    if (raw.length >= 2 && /^["'`]/.test(raw) && raw.at(-1) === raw[0]) {
      raw = raw.slice(1, -1);
      s0 += 1;
      e0 -= 1;
    }
    const en = raw.trim();
    if (!looksLikeProse(en)) return;
    out.push({
      id: `${rel}:${s0}`,
      file: rel,
      start: s0,
      end: e0,
      kind,
      en,
      ctx,
    });
  };

  const ctxOf = (node) => {
    const a = Math.max(0, node.start - 90);
    return src.slice(a, Math.min(src.length, node.end + 40)).replace(/\s+/g, " ");
  };

  // 通用递归遍历
  const seen = new WeakSet();
  const visit = (n, parent) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const c of n) visit(c, parent);
      return;
    }
    if (typeof n.type !== "string") {
      for (const k of Object.keys(n)) {
        if (k === "start" || k === "end" || k === "loc") continue;
        visit(n[k], n);
      }
      return;
    }
    if (seen.has(n)) return;
    seen.add(n);

    switch (n.type) {
      case "JSXText": {
        const t = n.value.trim();
        if (t && /[A-Za-z一-鿿]/.test(t) && looksLikeProse(t)) {
          // JSXText 的 start/end 含空白，收窄到实际文字
          const lead = n.value.length - n.value.trimStart().length;
          const trail = n.value.length - n.value.trimEnd().length;
          push({ start: n.start + lead, end: n.end - trail }, "jsx-text", ctxOf(n));
        }
        break;
      }
      case "JSXAttribute": {
        const an = n.name?.name ?? n.name?.value;
        if (an && UI_ATTRS.has(an)) {
          const v = n.value;
          if (isStr(v)) push(v, `attr:${an}`, ctxOf(n));
          else if (v?.type === "JSXExpressionContainer" && isStr(v.expression))
            push(v.expression, `attr:${an}`, ctxOf(n));
        }
        break;
      }
      case "CallExpression": {
        let callee = "";
        const c = n.callee;
        if (c?.type === "Identifier") callee = c.name;
        else if (c?.type === "MemberExpression") callee = c.property?.name ?? "";
        if (callee && UI_CALLS.has(callee)) {
          const a0 = n.arguments?.[0];
          if (isStr(a0)) push(a0, `call:${callee}`, ctxOf(n));
        }
        break;
      }
      case "Property":
      case "ObjectProperty": {
        const k = n.key?.name ?? n.key?.value;
        if (k && UI_OBJ_KEYS.has(k)) {
          const v = n.value;
          if (isStr(v)) push(v, `obj:${k}`, ctxOf(n));
        }
        break;
      }
      default:
        break;
    }

    for (const key of Object.keys(n)) {
      if (key === "start" || key === "end" || key === "loc" || key === "parent") continue;
      visit(n[key], n);
    }
  };
  visit(ast.program, null);

  // 去重（同一偏移）
  const map = new Map();
  for (const s of out) if (!map.has(s.id)) map.set(s.id, s);
  return [...map.values()];
}

function walkRs(file, src) {
  const rel = path.relative(ROOT, file);
  if (/(^|\/)(tests?|examples?|benches)(\/|$)/.test(rel) || /tests\.rs$/.test(rel)) return [];
  const out = [];
  const lines = src.split("\n");
  let inTest = false;
  let off = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#\[cfg\(test\)\]/.test(line)) inTest = true;
    else if (/^\s*}\s*$/.test(line) && inTest) inTest = false;
    if (inTest) { off += line.length + 1; continue; }
    // 跳过日志/调试宏
    if (/\b(log|debug|trace|warn|error|info)!\s*\(|println!|eprintln!|dbg!/.test(line)) {
      off += line.length + 1;
      continue;
    }
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(line))) {
      const inner = m[1];
      const start = off + m.index + 1;
      const end = start + inner.length;
      if (looksLikeProse(inner) && !/\{\s*\w*\s*[:}]/.test(inner)) {
        out.push({
          id: `${rel}:${start}`,
          file: rel,
          start,
          end,
          kind: "rs-string",
          en: inner.trim(),
          ctx: line.trim().slice(0, 130),
        });
      }
    }
    off += line.length + 1;
  }
  return out;
}

function main() {
  const outArg = process.argv.indexOf("--out");
  const outFile = outArg > -1 ? process.argv[outArg + 1] : path.join(ROOT, "l10n/strings.json");

  const files = [];
  const scan = (dir, exts) => {
    if (!fs.existsSync(dir)) return;
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (["node_modules", "target", "dist", ".git", "build"].includes(e.name)) continue;
          stack.push(p);
        } else if (exts.some((x) => p.endsWith(x))) {
          const rel = path.relative(ROOT, p);
          if (!SKIP_FILE(rel)) files.push(p);
        }
      }
    }
  };
  scan(path.join(ROOT, "src"), [".ts", ".tsx"]);
  scan(path.join(ROOT, "src-tauri"), [".rs"]);
  scan(path.join(ROOT, "crates"), [".rs"]);

  const all = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    all.push(...(f.endsWith(".rs") ? walkRs(f, src) : walkTs(f, src)));
  }
  all.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.start - b.start));

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(all, null, 1));

  const byKind = {};
  for (const s of all) byKind[s.kind.split(":")[0]] = (byKind[s.kind.split(":")[0]] || 0) + 1;
  const uniq = new Set(all.map((s) => s.en));
  console.log(`文件: ${files.length}`);
  console.log(`条目: ${all.length}  去重后(按英文原文): ${uniq.size}`);
  console.log("分类:", JSON.stringify(byKind));
  console.log(`输出: ${path.relative(ROOT, outFile)}`);
}

main();
