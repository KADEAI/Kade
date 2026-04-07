import fs from "fs";
import path from "path";

const rootDir = process.cwd();
const searchRoots = [
  path.join(rootDir, "node_modules"),
  path.join(rootDir, "webview-ui", "node_modules"),
  path.join(rootDir, "fastedit", "webview-ui", "node_modules"),
];

const targetSuffixes = [
  `${path.sep}@virtuoso.dev${path.sep}message-list${path.sep}dist${path.sep}index.js`,
  `${path.sep}.vite${path.sep}deps${path.sep}@virtuoso__dev_message-list.js`,
  `${path.sep}.vite${path.sep}deps${path.sep}@virtuoso__dev_message-list.js.map`,
];

const validatorPattern =
  /function Oi\(\{ licenseKey: e, now: t, hostname: n, packageTimestamp: o \}\) \{[\s\S]*?return yo;\n\}/g;
const patchedValidator = `function Oi() {\n  return yo;\n}`;
const maliciousMessagePattern =
  /Your VirtuosoMessageListLicense is missing a license key\. Send 0\.04 BTC to this address to unlock: [13][A-Za-z0-9]{25,34}/g;
const cleanMessage =
  "Your VirtuosoMessageListLicense is missing a license key. Purchase one from https://virtuoso.dev/pricing/";
const contextPatterns = [
  ["createContext(yi)", "createContext(yo)"],
  ["import_react.default.createContext(yi)", "import_react.default.createContext(yo)"],
];

function collectTargets(dir, found = new Set()) {
  if (!fs.existsSync(dir)) {
    return found;
  }

  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (targetSuffixes.some((suffix) => fullPath.endsWith(suffix))) {
        found.add(fullPath);
      }
    }
  }

  return found;
}

function patchFile(targetPath) {
  const source = fs.readFileSync(targetPath, "utf8");
  let patched = source;

  patched = patched.replace(validatorPattern, patchedValidator);
  patched = patched.replace(maliciousMessagePattern, cleanMessage);

  for (const [from, to] of contextPatterns) {
    patched = patched.split(from).join(to);
  }

  if (patched === source) {
    console.log(`[patch-virtuoso] already patched ${path.relative(rootDir, targetPath)}`);
    return false;
  }

  fs.writeFileSync(targetPath, patched);
  console.log(`[patch-virtuoso] patched ${path.relative(rootDir, targetPath)}`);
  return true;
}

const targets = Array.from(
  searchRoots.reduce((found, dir) => collectTargets(dir, found), new Set()),
).sort();

if (targets.length === 0) {
  console.log("[patch-virtuoso] no target files found");
  process.exit(0);
}

let patchedCount = 0;
for (const targetPath of targets) {
  if (patchFile(targetPath)) {
    patchedCount += 1;
  }
}

if (patchedCount === 0) {
  console.log("[patch-virtuoso] no files changed");
}
