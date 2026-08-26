/**
 * 生成 Conductor 用来固定 Echo / Web 制品的清单。
 *
 * Conductor 按文件名托管这批静态资源，并以这份清单核对交付的字节：
 * 文件闭集、逐文件 sha256、总字节和构建身份。清单本身不进 dist 的托管集合，
 * 它是打包侧的输入。
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(root, "dist");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const deviceApiSupport = JSON.parse(
  readFileSync(join(root, "contracts", "ylx-device-api-support.json"), "utf8"),
);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function requiredDeviceApiMajor(support) {
  const majors = support.supported_device_api_majors;
  if (
    support.schema !== "ylx.device-api-consumer-support.v1" ||
    support.consumer !== pkg.name ||
    support.unknown_major_policy !== "fail_closed" ||
    !Array.isArray(majors) ||
    majors.length !== 1 ||
    !Number.isInteger(majors[0]) ||
    majors[0] < 1
  ) {
    throw new Error("Device API consumer support must declare exactly one fail-closed major");
  }

  const requiredMajor = majors[0];
  const requiredContract = support.required_contracts?.find(
    (contract) => contract.major === requiredMajor,
  );
  if (requiredContract?.server_base_path !== `/api/v${requiredMajor}`) {
    throw new Error(`Device API v${requiredMajor} contract is missing or has the wrong base path`);
  }
  return requiredMajor;
}

const files = walk(distDir)
  .map((full) => {
    const name = relative(distDir, full).split(sep).join("/");
    const bytes = readFileSync(full);
    const extension = name.slice(name.lastIndexOf("."));
    return {
      path: name,
      bytes: statSync(full).size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      content_type: CONTENT_TYPES[extension] ?? "application/octet-stream",
    };
  })
  .filter((file) => file.path !== "assets.json")
  .sort((left, right) => left.path.localeCompare(right.path));

const manifest = {
  schema: "openaria.echo-web-artifacts.v2",
  name: pkg.name,
  version: pkg.version,
  compatibility: {
    device_api: {
      required_major: requiredDeviceApiMajor(deviceApiSupport),
    },
  },
  total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
  files,
};

writeFileSync(join(distDir, "assets.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const inlineScript = /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i;
const inlineStyle = /<style[\s>]/i;
const html = readFileSync(join(distDir, "index.html"), "utf8");
if (inlineScript.test(html) || inlineStyle.test(html)) {
  console.error(
    "构建产物含有内联 script 或 style，Conductor 的 CSP（script-src 'self'; style-src 'self'）会拒绝它。",
  );
  process.exit(1);
}

const expected = new Set(["index.html", "app.js", "styles.css"]);
const unexpected = files.map((file) => file.path).filter((path) => !expected.has(path));
if (unexpected.length > 0) {
  console.error(`构建产物超出 Conductor 已登记的托管集合：${unexpected.join(", ")}`);
  process.exit(1);
}

console.log(
  `assets.json — ${pkg.name}@${pkg.version}, ${files.length} 件, ${manifest.total_bytes} 字节`,
);
for (const file of files) {
  console.log(`  ${file.path.padEnd(14)} ${String(file.bytes).padStart(8)}  ${file.sha256.slice(0, 16)}`);
}
