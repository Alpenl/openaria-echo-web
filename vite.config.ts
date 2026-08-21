import { defineConfig, type Plugin } from "vite";

/**
 * 同源托管不需要 crossorigin：Conductor 的 gateway 只回 same-origin 资源，
 * 不发 Access-Control-Allow-Origin，多余的属性只会引入无谓的 CORS 语义。
 */
function stripCrossOrigin(): Plugin {
  return {
    name: "echo-strip-crossorigin",
    enforce: "post",
    transformIndexHtml: (html) => html.replace(/ crossorigin(=("|')[^"']*\2)?/g, ""),
  };
}

/**
 * Conductor 托管 Echo / Web 的静态制品：gateway 只按登记的扁平文件名提供资源，
 * 并以 `script-src 'self'; style-src 'self'` 的 CSP 交付，因此构建产物必须是
 * 固定的三件套 index.html / app.js / styles.css，没有内联脚本、内联样式、
 * hash 文件名、代码分割或 modulepreload polyfill。
 */
const DEVICE = process.env.ECHO_DEVICE ?? "http://192.168.110.36:8080";

export default defineConfig({
  base: "/",
  plugins: [stripCrossOrigin()],
  // 开发时把 Device API、事件流和预览代理到真机，前端不持有第二套契约实现。
  server: {
    proxy: {
      "/api": { target: DEVICE, changeOrigin: true, ws: false },
    },
  },
  preview: {
    proxy: {
      "/api": { target: DEVICE, changeOrigin: true, ws: false },
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
  build: {
    target: "es2022",
    outDir: "dist",
    assetsDir: ".",
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: false,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "app.js",
        assetFileNames: (asset) =>
          asset.names?.some((name) => name.endsWith(".css")) ? "styles.css" : "[name][extname]",
      },
    },
  },
});
