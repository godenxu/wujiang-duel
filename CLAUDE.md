# 项目须知

## 每次交付必须同步升级版本号

任何一轮改动只要涉及 `index.html`/`css/style.css`/`js/*.js`/`data/generals.js`
等会被 Service Worker 缓存的文件，**提交前必须同步做两处修改**，缺一不可：

1. `sw.js` 顶部 `const CACHE = "wujiang-YYYYMMDDHHmm";`
2. `js/app.js` 顶部 `const APP_VERSION = "YYYYMMDDHHmm";`（在首页页脚 `#app-ver` 显示）

两处时间戳必须**完全一致**，取当前 **UTC+8（北京时间）** 的实际时间，格式
`YYYYMMDDHHmm`（年月日+时分，无分隔符）。这是缓存失效与用户端可见版本号的
唯一依据，漏更新会导致玩家看到旧版本号、Service Worker 也可能不刷新缓存。

不涉及上述可缓存文件的改动（例如只改 `DESIGN.md`/`BALANCE.md`/`README.md`
等文档）不需要跟着改版本号。
