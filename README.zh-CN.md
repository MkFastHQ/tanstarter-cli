# TanStarter CLI

[English](README.md) | 简体中文

使用 TanStarter 模板创建一个生产可用的 SaaS 项目，并在大约 10 分钟内部署到 Cloudflare Workers。

## 快速开始

本仓库从源码使用，不走 npm 发布。构建并链接一次即可：

```bash
git clone https://github.com/akfc58/tanstarter-cli.git
cd tanstarter-cli
pnpm install
pnpm build
npm link
```

然后进入你想创建新项目的目录，运行：

```bash
export CLOUDFLARE_ACCOUNT_ID="..."
export CLOUDFLARE_API_TOKEN="..."

tanstarter create
```

TanStarter CLI 会在**当前工作目录**下创建项目目录，所以要在你的项目根目录运行，不要在本仓库里运行。CLI 会在真正创建资源之前询问项目名称和相关资源名称。

## 安装

### 全局命令（推荐）

`npm link` 会把 `dist/index.js` 软链到 npm 全局 bin 目录，`tanstarter` 在任何位置都可用：

```bash
pnpm build
npm link

tanstarter --version
```

改动 `src/` 下的代码后，重新执行 `pnpm build` 即可。全局命令指向 `dist/`，不需要重新 link。

取消链接：

```bash
npm unlink -g tanstarter-cli
```

`pnpm link --global` 也可以，但在没执行过 `pnpm setup` 之前会报 `ERR_PNPM_NO_GLOBAL_BIN_DIR`。

### 直接跑源码

调试 CLI 本身时可以跳过构建：

```bash
pnpm dev create
pnpm dev --help
```

`pnpm dev` 实际执行 `tsx src/index.ts`。注意参数前**不要加 `--`**：`pnpm dev -- --help` 会把 `--` 原样传给 CLI，报 `Unknown option: --`。

### 直接跑构建产物

```bash
pnpm build
node /path/to/tanstarter-cli/dist/index.js create
```

## 命令

```bash
tanstarter create [options]
tanstarter create <project-name> --resume
tanstarter delete <project-name> [options]
```

参数：

- `--domain <domain>`：配置 Cloudflare 自定义域名路由。
- `--repo <owner/name>`：创建指定的 GitHub 仓库。如果省略，TanStarter CLI 会默认使用当前 GitHub CLI 登录账号和项目名，例如 `open-fox/my-app`。
- `--resume`：从 `.tanstarter/state.json` 继续一次失败的初始化流程。
- `-h, --help`：显示帮助信息。
- `-v, --version`：显示版本号。

示例：

```bash
tanstarter create --domain app.example.com --repo mkfasthq/my-app
```

如果项目目录已经创建但流程中途失败，修复问题后可以运行：

```bash
tanstarter create my-app --resume
```

如需删除 CLI 创建的 Cloudflare 和 GitHub 资源，运行：

```bash
tanstarter delete my-app
```

## 前置要求

- Node.js 20 或更高版本。
- pnpm，用于安装依赖和构建本仓库。
- 一个 Cloudflare 账号，并在当前 shell 环境中设置 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN`。
- 一个已经通过 GitHub CLI 登录的 GitHub 账号。

CLI 会检查 `node`、`pnpm`、`git`、`gh`、GitHub CLI 登录状态和 Cloudflare 凭证。如果缺少 `pnpm`、`git` 或 `gh`，CLI 会尝试通过系统可用的包管理器自动安装。

## 它会做什么

初始化流程：

1. 克隆 TanStarter 模板。
2. 使用 `pnpm install` 安装依赖。
3. 创建 Cloudflare D1、R2 和 KV 资源。
4. 更新 `wrangler.jsonc`。
5. 写入 `.env` 和 `.env.production`。
6. 执行数据库迁移。
7. 本地构建并部署。
8. 同步 Worker secrets。
9. 创建 GitHub 仓库。
10. 同步 GitHub Actions secrets。
11. 提交代码并推送到 `main` 分支。

模板 `.env.example` 中声明的环境变量，如果当前 shell 中已经存在，会被复制到生成的 `.env` 和 `.env.production` 文件中。CLI 自动生成的 Cloudflare、D1、KV、base URL 和 auth secret 等值会优先生效。

## 链接

- 官网：[tanstarter.dev](https://tanstarter.dev)
- CLI 文档：[docs.tanstarter.dev/docs/cli](https://docs.tanstarter.dev/docs/cli)
- CLI 视频教程：[youtu.be/HVwilCX6YSA](https://youtu.be/HVwilCX6YSA)

## 支持

如果你遇到问题，可以发送邮件到 [support@tanstarter.dev](mailto:support@tanstarter.dev)，或者加入 [Discord 社区](https://mksaas.link/discord) 寻求帮助。

## License

MIT
