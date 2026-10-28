# 通过 sub2api 发布桌面 App 更新

LSAGENT 的自动更新地址是 `{serverUrl}/api/v1/app/update/{target}`。其中 `serverUrl` 来自打包进 App 的 `src/shared/sub2api-defaults.json`。这个接口返回的版本信息，由管理员在 sub2api 后台「设置 → App → App 更新」中编辑。App 每 30 分钟检查一次，发现服务器上的版本比自己高时，会在后台下载、校验签名，然后提示用户「重启更新」。

架构与安全约束见 [`../tech_docs/auto_update.md`](../tech_docs/auto_update.md)。

## 签名密钥

| 文件 | 用途 | 能否公开 |
| --- | --- | --- |
| `~/.tauri/lsagent-updater.key` | 更新签名私钥（有密码保护） | **不能**。丢失后已发出的 App 将无法再收到更新 |
| `~/.tauri/lsagent-updater.password` | 私钥密码 | **不能** |
| `~/.tauri/lsagent-updater.key.pub` | 公钥，内容已写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` | 可以 |

- 已被 gitignore 的 `.env` 在构建时会读取上面这两个文件，生成 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。私钥本身不放进仓库。
- **把 `~/.tauri` 备份到密码管理器或离线介质。**
- 已安装的 App 只认打包时内置的公钥。如果更换密钥，旧版本 App 会拒绝新的安装包，只能让用户手动下载安装一次新版本。
- 如果要在另一台机器上构建（例如 Windows），把这三个文件复制到那台机器的 `~/.tauri/`。PowerShell 的 `.env` 解析不会执行 `$(cat …)`，所以在那台机器的 `.env` 里，直接把私钥文件的全文和密码填入这两个变量。

## 每次发布的步骤

1. **升级版本号**（`package.json` 是唯一数据源，会同步写入 `tauri.conf.json` 和 `Cargo.toml`）：

   ```bash
   npm version patch --no-git-tag-version
   ```

2. **打包**。构建过程会自动用 `.env` 中的私钥签名：
   - macOS：`./build_macos.sh`。产物在 `src-tauri/target/<arch>/release/bundle/macos/`，包括 `*.app.tar.gz` 和 `*.app.tar.gz.sig`。
   - Windows：`build_windows.ps1`。产物在 `bundle/nsis/`，包括 `*-setup.nsis.zip` 和 `*-setup.nsis.zip.sig`。配置项 `createUpdaterArtifacts: "v1Compatible"` 会生成 zip 格式的更新包。

3. **上传安装包**：把每个平台的 `.app.tar.gz` 或 `.nsis.zip` 上传到任意 https 地址（R2、OSS、CDN 等均可）。`.sig` 文件不需要上传。

4. **在 sub2api 后台发布**：打开「设置 → App → App 更新」：
   - 版本号：填写与第 1 步相同的版本，例如 `0.5.5`。
   - 更新说明：可选。
   - 发布时间：可留空，留空时使用当前时间。
   - 每个平台：填写安装包的下载地址，并把对应 `.sig` 文件的**完整内容**粘贴到签名框。没有打包的平台留空即可。
   - 打开「已发布」开关，然后点击「保存 App 更新」。

5. **验证**：

   ```bash
   curl -i https://api.lingsiai.cn/api/v1/app/update/darwin-aarch64
   ```

   返回 200 和包含新版本的 JSON 即为成功。返回 204 表示该平台目前没有可用更新。之后在旧版本 App 中点击「检查更新」，确认能下载、提示重启并安装成功。

## 平台标识

| target | 对应安装包 |
| --- | --- |
| `darwin-aarch64` | macOS Apple 芯片 `.app.tar.gz` |
| `darwin-x86_64` | macOS Intel `.app.tar.gz` |
| `windows-x86_64` | Windows x64 `.nsis.zip` |
| `windows-aarch64` | Windows ARM64 `.nsis.zip` |

Linux（deb）不支持自动更新，需要用户手动下载安装。

## 撤回与回滚

- 暂停推送：关闭「已发布」开关并保存。之后所有平台都会返回 204，但已经下载到用户本地的安装包不会被撤回。
- App 不会降级。如果需要修复有问题的版本，应发布一个版本号更高的修复版。
