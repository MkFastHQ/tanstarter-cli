# 已知问题与后续事项

更新时间：2026-07-29

## 低危遗留（已评估，暂不修复）

### 首次部署把 VITE_BASE_URL 烘成 localhost

deploy 步骤执行时 workers.dev 地址尚未产生，`.env.production` 里 `VITE_BASE_URL` 是兜底的 `http://localhost:3000`，Vite 在构建阶段把它静态内联进客户端产物。真实地址在部署完成后才解析出来回写 env 文件，但不会重新构建。

实际影响被最后一步的 push 抵消：CI 用 GitHub secret 里已更新的地址重新构建并覆盖部署。自愈依赖三个前提，push 成功、Actions 启用、Cloudflare 凭据有效。另外 `parseDeploymentUrl` 解析失败是静默的，那种情况下 GitHub secret 里存的也是 localhost，CI 同样救不回来。

若要修，两个方向：拿到地址回写 env 后再跑一次 deploy，或在部署前调 `GET /accounts/{id}/workers/subdomain` 预先拼出地址，一次构建到位。

补充事实：`createEnv` 在 `vite build` 期间不被求值，此问题与环境变量校验无关，纯粹是 Vite 内联时机。

### state.json 以 0644 保存明文 API token

`.tanstarter/state.json` 保存完整的 `cloudflareApiToken`，供 `--resume` 和 `delete` 使用，文件权限 0644。该目录已在 `.gitignore` 内，不进仓库也不上传云端，风险仅限本地文件被带出，例如打包分发、网盘同步、备份工具不遵守 gitignore。

若要收紧：写入时传 `mode: 0o600` 并补一次 `fs.chmodSync`。两个都需要，`mode` 只对新建文件生效，旧版本留下的 0644 文件要靠 chmod 才能降权。

更彻底的做法是不落盘 token，`--resume` 本来就从环境变量重新读取，只有 `delete` 依赖存储的值，把它也改成 `requireEnv` 即可。
