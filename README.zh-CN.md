<div align="center">
  <img src="kort/apps/web/public/kort-readme-logo.svg" alt="KORT logo" width="300" height="96" />

  <h1>圆桌骑士 KORT</h1>

  <p>
    一个隐藏原始思维链的多模型专家小组讨论 Web 应用。
  </p>

  <p>
    <a href="README.md">English</a>
    ·
    <a href="#快速启动">快速启动</a>
    ·
    <a href="#api-接口">API</a>
    ·
    <a href="kort/docs/architecture-rules.md">架构规则</a>
  </p>

  <p>
    <img alt="Backend" src="https://img.shields.io/badge/backend-FastAPI-009688?style=flat-square" />
    <img alt="Frontend" src="https://img.shields.io/badge/frontend-Next.js_15-111111?style=flat-square" />
    <img alt="Orchestration" src="https://img.shields.io/badge/orchestration-LangGraph-2F6FEB?style=flat-square" />
    <img alt="Privacy boundary" src="https://img.shields.io/badge/Hidden_CoT-visible_summaries_only-6A5ACD?style=flat-square" />
  </p>
</div>

---

## 项目简介

KORT 让用户的问题进入一个可配置的 AI 专家小组：

1. 专家独立分析。
2. 批判者审视和找茬。
3. 图编排可进行多轮讨论。
4. 总结者只生成用户可见的阶段摘要。
5. 整合者输出最终答案。

产品边界非常明确：原始专家讨论、provider reasoning content、内部 transcript 只存在于后端运行时状态。用户只能看到 Summarizer 投影出来的阶段摘要和最终答案。

## 当前能力

| 模块 | 能力 |
| --- | --- |
| 聊天体验 | 类 ChatGPT 的主界面、侧栏历史、固定输入框、流式回答、Markdown/KaTeX |
| 思考体验 | 默认折叠的思考入口、右侧思考抽屉、完成态、结构化思考节点 |
| 编排 | LangGraph 专家/批判/总结/整合流程，支持可配置讨论深度 |
| 路由 | 简单问候等请求可跳过完整专家组，避免过度反应 |
| Agent | 文件系统 Agent，支持角色、提示词、provider、优先级和 Skill 权限 |
| Provider | 运行时 provider profiles、本地 key 状态、连通性检查、OpenAI-compatible 调用 |
| 持久化 | 只持久化用户可见投影，不暴露原始隐藏讨论 |

## 快速启动

```bash
docker compose up --build
```

启动后访问：

| 服务 | 地址 |
| --- | --- |
| 前端 | <http://localhost:3000> |
| 后端 | <http://localhost:8000> |
| 健康检查 | <http://localhost:8000/health> |

## 本地开发

### 后端

```bash
cd kort/apps/api
pip install -e ".[dev]"
python -m uvicorn kort_api.main:app --reload --port 8000
```

可选 `.env`：

```env
RUNTIME_ROOT=../../runtime
DATA_ROOT=../../runtime/data
PROVIDERS_FILE=../../runtime/providers/profiles.json
CONVERSATION_DB=../../runtime/data/conversations.json
```

### 前端

```bash
cd kort/apps/web
pnpm install
pnpm dev
```

前端通过 `NEXT_PUBLIC_API_BASE_URL` 连接后端。Docker Compose 默认设置为 `http://localhost:8000`。

## 项目结构

```text
kort/
├── apps/
│   ├── api/                    # FastAPI 后端
│   │   └── src/kort_api/
│   │       ├── app.py          # API 路由
│   │       ├── agents.py       # Agent 加载和 CRUD
│   │       ├── conversations.py # 可见对话存储和 SSE 服务
│   │       ├── model_client.py # OpenAI-compatible 模型客户端
│   │       ├── orchestration.py # LangGraph 编排
│   │       ├── providers.py    # Provider 和本地 key 状态
│   │       ├── request_router.py
│   │       └── schemas.py      # Pydantic 契约
│   └── web/                    # Next.js 15 前端
│       └── app/
│           ├── page.tsx        # 聊天、侧栏、设置、思考抽屉
│           ├── locale.ts       # 语言入口
│           └── globals.css     # 产品样式
├── runtime/
│   ├── agents/                 # Agent 文件夹和 agent.yaml
│   ├── providers/              # Provider 元数据
│   ├── skills/                 # 全局 Skills
│   └── data/                   # 本地运行时数据，不提交
└── docs/
    └── architecture-rules.md
```

## 架构规则

```text
用户问题
  -> 请求路由器
  -> 直接回答 | 单模型思考 | 专家小组
  -> LangGraph 专家/批判多轮讨论
  -> Summarizer 可见投影
  -> Synthesizer 最终答案
  -> SSE 流式返回前端
```

核心规则：

- Hidden CoT 是产品边界，不是 UI 文案。
- 用户只能看到 Summarizer 阶段摘要和最终答案。
- 产品代码在 `kort/apps`，运行时数据在 `kort/runtime`。
- API Key 只写入本地 runtime data 或环境变量，不提交到仓库。
- API 载荷必须经 Pydantic 验证。

详见 [architecture-rules.md](kort/docs/architecture-rules.md)。

## API 接口

### Providers

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/providers` | 列出 provider profiles |
| `PUT` | `/api/providers/{provider_id}` | 创建或更新 provider |
| `POST` | `/api/providers/{provider_id}/test` | 检查 profile 和 key 状态 |
| `GET` | `/api/provider-secrets` | 返回 key 是否已配置 |
| `PUT` | `/api/providers/{provider_id}/secret` | 保存本地运行时 API Key |

### Agents

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/agents` | 列出 Agent |
| `POST` | `/api/agents` | 创建 Agent |
| `PUT` | `/api/agents/{name}` | 更新 Agent |
| `DELETE` | `/api/agents/{name}` | 删除 Agent |
| `GET` | `/api/skills` | 列出全局 Skills |

每个 Agent 位于 `kort/runtime/agents/{name}/agent.yaml`：

```yaml
name: research-lead
nickname: Research Lead
role: expert
provider_profile: deepseek
model: deepseek-chat
system_prompt: |
  You are the lead research expert...
allowed_global_skills:
  - structured-analysis
  - evidence-grounding
disabled_global_skills:
  - stage-summary-projection
priority: 20
```

文件协议见 [How To Make A Agent](kort/runtime/agents/How%20To%20Make%20A%20Agent.md)。

### Conversations

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/conversations` | 列出可见对话记录 |
| `GET` | `/api/conversations/{conversation_id}` | 加载一个已持久化对话 |
| `GET` | `/api/conversations/{conversation_id}/stream` | 重新连接正在运行的对话流 |
| `PATCH` | `/api/conversations/{conversation_id}` | 重命名对话 |
| `DELETE` | `/api/conversations/{conversation_id}` | 删除对话 |
| `POST` | `/api/conversations/stream` | 创建或续写 SSE 对话 |

请求示例：

```json
{
  "question": "什么是量子纠缠？",
  "level": "auto",
  "conversation_id": null,
  "deep_think": false
}
```

## 内置 Agent

| Agent | 角色 | 默认模型 |
| --- | --- | --- |
| `research-lead` | expert | `deepseek-chat` |
| `creative-thinker` | expert | `deepseek-chat` |
| `logician-main` | expert | `deepseek-chat` |
| `critic-main` | critic | `deepseek-chat` |
| `summarizer-main` | summarizer | `deepseek-chat` |
| `synthesizer-main` | synthesizer | `deepseek-chat` |

系统 Agent 在 GUI 中受保护，不能随意编辑或删除。

## 内置 Skills

| Skill | 用途 |
| --- | --- |
| `structured-analysis` | 结构化分析框架 |
| `evidence-grounding` | 证据和引用纪律 |
| `gap-analysis` | 信息缺口检测 |
| `hidden-cot-guard` | Hidden-CoT 边界守卫 |
| `stage-summary-projection` | 用户可见阶段摘要格式 |
| `final-answer-structure` | 最终答案结构模板 |

全局 Skills 可共享。Agent 私有 Skills 可以放在 `kort/runtime/agents/{name}/skills/` 下，通过文件系统管理。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Python 3.12, FastAPI, Uvicorn |
| 编排 | LangGraph |
| 当前模型客户端 | OpenAI-compatible HTTP client |
| 计划中的 provider 统一层 | LiteLLM |
| 验证 | Pydantic v2 |
| 前端 | Next.js 15, React 19, Tailwind CSS 3 |
| 渲染 | react-markdown, KaTeX |
| 部署 | Docker Compose |

## 验证命令

```bash
cd kort/apps/api
python -m pytest tests
```

```bash
pnpm --dir kort/apps/web exec tsc --noEmit
pnpm --dir kort/apps/web build
```

## 仓库说明

- `kort/runtime/data/` 是本地运行时状态，不应提交。
- `.trae/`、`.codex/`、`.claude/`、`AGENTS.md`、`HARNESS.md` 是本地 agent 上下文文件，已按规则 ignored。
- 公开 README 只描述产品和仓库公共表面，不记录本地 agent 操作细节。
