# TanStarter CLI

[English](README.md) | 简体中文

使用 TanStarter 模板创建一个生产可用的 SaaS 项目，并在大约 10 分钟内部署到 Cloudflare Workers。

## 快速开始

```bash
export CLOUDFLARE_ACCOUNT_ID="..."
export CLOUDFLARE_API_TOKEN="..."

# 可选：在初始化时启用 Waffo 支付
export WAFFO_MERCHANT_ID="MER_..."
export WAFFO_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."

npx tanstarter-cli@latest create
```

TanStarter CLI 会在真正创建资源之前询问项目名称、资源名称和支付方式。选择 Waffo 后，它会自动创建 Waffo 门店、模板内置的三个产品和 Webhook。

若希望保留支付方式提问、但自动接受其余默认值（域名、D1/R2/KV 名称、GitHub 仓库与最终确认），传入 `--yes`：

```bash
npx tanstarter-cli@latest create my-app --yes
```

## 安装

### Agent Skill

为 Codex、Claude Code 或其他支持的 Agent 安装 TanStarter 创建技能：

```bash
npx skills add MkFastHQ/tanstarter-cli --skill tanstarter-create
```

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
tanstarter delete <project-name> [options]
tanstarter create <project-name> --resume
```

参数：

- `--domain <domain>`：配置 Cloudflare 自定义域名路由。
- `--payment <none|waffo>`：生成项目的支付方式。选择 `waffo` 时，CLI 使用模板内置的月付、年付和一次性产品，并在初始化过程中自动创建 Waffo 门店、产品和 Webhook。
- `-y, --yes`：自动接受默认域名、资源名称、GitHub 仓库和最终确认。除非已传入 `--payment`，否则仍会询问支付方式。
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
- （仅 Waffo）在 Waffo 控制台（API & Development → API Keys）创建 Test API Key。将 `MER_...` 商户 ID 设置为 `WAFFO_MERCHANT_ID`，将 Waffo 提供的 private key 字符串设置为 `WAFFO_PRIVATE_KEY`，CLI 会原样传递该值。CLI 始终使用 Waffo 测试模式；没有自定义域名时会使用部署后的 `workers.dev` 地址注册 Webhook。

CLI 会检查 `node`、`pnpm`、`git`、`gh`、GitHub CLI 登录状态和 Cloudflare 凭证。如果缺少 `pnpm`、`git` 或 `gh`，CLI 会尝试通过系统可用的包管理器自动安装。

### 非交互式 Waffo 配置

在没有 TTY 的环境中，请传入 `--payment waffo`。不需要再提供门店名、产品名、价格或额外的 Waffo 环境变量，CLI 会直接使用模板内置定价。`--domain` 是可选的：

```bash
npx tanstarter-cli@latest create my-app --payment waffo
```

CLI 会创建一个以项目名命名的门店，并创建模板内置的三个产品：Pro 月付 `$9.90`、Pro 年付 `$99.00`、Lifetime 一次性 `$199.00`。三个产品 ID 分别写入 `VITE_WAFFO_PRODUCT_PRO_MONTHLY`、`VITE_WAFFO_PRODUCT_PRO_YEARLY` 和 `VITE_WAFFO_PRODUCT_LIFETIME`，然后部署网站、同步 Worker secrets、验证公网地址，最后注册 `https://<域名>/api/webhooks/waffo`（没有自定义域名时使用部署后的 `workers.dev` 地址）。线上 Worker 会保留 `WAFFO_DEBUG=true`，因此上线后的站点走 Waffo 测试支付流程。

CLI 初始化始终使用 Waffo 测试模式，正式产品发布不属于这个初始化流程。

Waffo 仍可能要求在控制台完成商户验证、企业资料和收款账户等流程。

## 它会做什么

初始化流程：

1. 克隆 TanStarter 模板并保留其 Git 历史。
2. 使用 `pnpm install` 安装依赖。
3. 验证 Cloudflare 认证。
4. （仅 Waffo）创建 Waffo 门店和模板内置的三个产品。
5. 创建 Cloudflare D1、R2 和 KV 资源。
6. 更新 `wrangler.jsonc` 并写入 `.env`/`.env.production`。
7. 执行数据库迁移。
8. 本地构建并部署。
9. 同步 Worker secrets。
10. 验证公网部署地址。
11. （仅 Waffo）确认部署路由可访问后注册 Webhook。
12. 创建 GitHub 仓库。
13. 同步 GitHub Actions secrets。
14. 提交代码并推送到 `main` 分支。

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
