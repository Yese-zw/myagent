# sub2api 账号接入

当前只接入桌面 App 内的邮箱密码登录、注册、注册邮箱验证码、登录恢复和退出。
模型 API Key 自动绑定、Space 和 AgentNet 身份互通不属于这次接入。

## Owner 与配置

- `src-tauri/src/sub2api/` 是应用级账户 owner。Token 不交给 Session Sidecar 或主 Renderer。
- `src/shared/sub2api-defaults.json` 是发行配置唯一服务 origin，后续更换域名只改此文件并重新构建。
- App 内不展示地址配置，也不提供修改地址的 command；忽略旧用户配置中的 `sub2apiServerUrl`。
- 发行地址变化后不同 origin 不复用本地凭据文件中的 Token。
- App Shell 的账号入口挂载时就加载公开配置并恢复账号；弹窗只消费该投影，反复打开不会重复连接。失败可显式重试。
- Access/Refresh Token 与最小用户投影保存到 `~/.myagents/credentials/sub2api.json`，
  文件权限为 0600（目录 0700），Windows 侧额外收紧 ACL。写入走临时文件 + rename 原子替换。
  密码仅用于当次请求。
- Rust operation gate 串行化刷新、登录、注册和退出。瞬时网络错误不清除已登录投影。
- `sub2api-account:changed` 只通知主窗口重新读取，不携带 Token。

## 接口

固定相对路径为 `/api/v1/settings/public`、`auth/login`、`auth/register`、
`auth/send-verify-code`、`auth/me`、`auth/refresh`、`auth/logout`。
使用自定义 sub2api 的 `{ code, data, reason }` 响应契约；只有 `code=0` 视为成功。
认证响应上限为 256 KiB；公开配置因包含站点内嵌图片，单独允许最多 4 MiB。
认证后再次请求 `auth/me`，以服务端验证后的用户为准。刷新收到新 Token 对后先持久化，再读取用户。
不提供普通账号表单以外的二步验证流程；服务器明确要求二步验证时不能伪报登录成功。

## 服务器安全验证码

表单本身为原生 React/Tauri 组件，不打开外部浏览器或 sub2api 登录网页。
服务器启用 Turnstile 时，需要在 App 内完成验证码。隔离 WebView 加载服务的公开 JSON
端点，在真实 HTTPS origin 下只渲染验证组件，以满足服务端现有 site key 的域名校验。
该窗口不接收邮箱、密码或账户 Token；使用临时会话，不复用登录 Cookie。

内联 `sub2api-captcha` 插件仅声明 `complete` 命令。每次验证动态授予该随机窗口与
精确公开 URL 单一权限，原生回调再次检查 URL、窗口、随机 nonce、大小和单次消费。
不向远程内容开放主窗口权限、文件权限或应用账户命令。超时或关闭后销毁验证关联。
腾讯/阿里验证码尚未适配时明确报错，不跳过服务端验证。

## 验证

- `Sub2apiAccountEntry.test.tsx`：启动连接、弹窗复用配置、隐藏地址设置、原生登录注册、协议同意、重复提交、错误恢复及退出。
- Rust `sub2api::tests`：origin 约束、非敏感投影、真实 loopback 请求、响应校验和禁止重定向。
- 自动测试不访问真实账号、不读取真实凭据文件、不创建生产用户。
- 可显式设置 `SUB2API_TEST_ORIGIN` 并运行忽略的公开配置兼容测试；该测试只读取公开配置。
- macOS 的 Rust 测试可执行文件若缺少 Swift runtime 搜索路径，可显式使用
  `DYLD_FALLBACK_LIBRARY_PATH=/usr/lib/swift` 运行测试；不更改项目编译参数。
- Rust `sub2api::store`：凭据文件往返、登出删文件、0600 权限、损坏文件隔离与 schema 版本校验。
