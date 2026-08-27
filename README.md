# openaria-echo-web

**Open Aria Echo / Web** — 浏览器客户端，用于 Open Aria Conductor 所在设备的预览、
录制控制和会话查阅。

Echo / Web 可独立构建。构建产物是一组静态制品，由 **Conductor** 固定版本、内嵌进
安装包并在设备本地托管；Echo 自身不部署运行时服务，也不持有第二套设备状态权威。

- 设备状态、会话生命周期与所有可变设备资源的唯一权威是 Conductor 的 capture daemon。
- 本客户端只投影 daemon 的权威快照，不产生任何本地乐观状态；浏览器状态永远不是恢复依据。
- 页面通过 Device API v4 的 `/api/v4` 与设备通信：HTTP 快照、SSE 事件流、JPEG 预览、
  以及不可变快照的 Range 数据面。

## 构建

```bash
npm install
npm run build          # 类型检查 → vite 构建 → 生成制品清单
```

产物固定为三件，落在 `dist/`：

| 文件 | 用途 |
|---|---|
| `index.html` | 页面外壳，只引用同源的 `/app.js` 与 `/styles.css` |
| `app.js` | 单一 ES module bundle，无代码分割、无 modulepreload polyfill |
| `styles.css` | 单一样式表 |
| `assets.json` | 制品清单：托管闭集、逐文件 sha256、内容类型和版本 |

`assets.json` 不参与托管，它是 Conductor 打包侧的输入：Conductor 按它决定托管哪些
文件、用什么 Content-Type，并在交付前逐文件核对 size 与 sha256，不一致即 fail closed。

### 为什么产物形态被固定死

Conductor 的 gateway 以

```
default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'
```

交付页面，并且只按登记的扁平文件名提供静态资源。因此构建必须满足：

- 没有内联 `<script>` 与 `<style>`；
- 没有 hash 文件名、没有额外 chunk、没有 `crossorigin` 属性；
- 没有公网 CDN 依赖，字体与图标全部随包离线交付。

`npm run build` 的最后一步会检查这几条，违反即构建失败。

## 开发

```bash
npm run dev                                   # 默认代理到设备热点网关 http://10.42.0.1:8080
ECHO_DEVICE=http://<设备地址>:8080 npm run dev  # 设备接在别的网络上时覆盖
```

默认值是设备自身热点的网关地址：连上设备热点就能直接开发。**不要把具体环境的地址提交进仓库**——
用 `ECHO_DEVICE` 覆盖。

`/api` 被代理到真机，因此开发时消费的是真实 Device API，前端不维护第二套契约实现。

## 结构

```
src/
  api/      Device API v4 的类型、客户端、SSE 事件流与预览传输
  state/    权威快照的 reducer 与编排 store（幂等命令、事件流快路径）
  ui/       取景器、命令条、会话台账与详情、设备面板
  styles/   单一样式表与设计令牌
```

### 几条不能动的语义

- **快照单调**：同一 `authority_epoch` 内 `source_revision` 严格递增，倒退的快照直接丢弃。
- **SSE 只是传输**：`sse_delivery_id` 不是修订号；只有严格 +1 的快照走快路径，其余一律
  回到 HTTP 权威快照重取。
- **D-049 固定存储边界**：当前网页不提供可移除介质、存储选择或安全换盘，不请求
  `/capture/safe-swap`，也不投影 frozen safe-swap SSE。API 类型与 client method 只为 exact wire
  compatibility 保留，不能据此恢复产品入口。
- **生产方声明与消费方判断分开显示**：`producer_outcome = sealed` 只证明生产方自洽；
  能否消费由 gateway 对当前字节独立判定。只有判为 usable 的不可变快照才出现下载入口。
- **持久历史不当新告警**：只有本页亲眼看到活动录制转入未成功终态时才播报它的诊断，
  刷新页面不会把旧失败重放一遍。

## 许可

见 [LICENSE](LICENSE)。
