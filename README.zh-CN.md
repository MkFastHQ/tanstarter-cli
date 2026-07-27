# TanStarter CLI

[English](README.md) | 简体中文

使用 TanStarter 模板创建一个生产可用的 SaaS 项目，并在大约 10 分钟内部署到 Cloudflare Workers。

## 快速开始

```bash
export CLOUDFLARE_ACCOUNT_ID="..."
export CLOUDFLARE_API_TOKEN="..."

npx tanstarter-cli@latest create
```

TanStarter CLI 会在真正创建资源之前询问项目名称和相关资源名称。

## 安装

不安装，直接运行：

```bash
npx tanstarter-cli@latest create
```

或者全局安装：

```bash
npm install -g tanstarter-cli
```

然后运行：

```bash
tanstarter create
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
- 一个 Cloudflare 账号，并在当前 shell 环境中设置 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN`。
- 一个已经通过 GitHub CLI 登录的 GitHub 账号。

CLI 会检查 `node`、`pnpm`、`git`、`gh`、GitHub CLI 登录状态和 Cloudflare 凭证。如果缺少 `pnpm`、`git` 或 `gh`，CLI 会尝试通过系统可用的包管理器自动安装。

## 它会做什么

初始化流程：

1. 克隆 TanStarter 模板并保留其 Git 历史。
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

生成的仓库使用 `origin` 指向新建的 GitHub 仓库，并使用 `upstream` 指向
`https://github.com/MkFastHQ/mkfast-template.git`。由于模板历史会被保留，
后续升级可以直接使用正常的 Git 合并，无需重新建立共同祖先。

模板 `.env.example` 中声明的环境变量，如果当前 shell 中已经存在，会被复制到生成的 `.env` 和 `.env.production` 文件中。CLI 自动生成的 Cloudflare、D1、KV、base URL 和 auth secret 等值会优先生效。

## 链接

- 官网：[tanstarter.dev](https://tanstarter.dev)
- CLI 文档：[docs.tanstarter.dev/docs/cli](https://docs.tanstarter.dev/docs/cli)
- CLI 视频教程：[youtu.be/HVwilCX6YSA](https://youtu.be/HVwilCX6YSA)

## 支持

如果你遇到问题，可以发送邮件到 [support@tanstarter.dev](mailto:support@tanstarter.dev)，或者加入 [Discord 社区](https://mksaas.link/discord) 寻求帮助。

## License

MIT
