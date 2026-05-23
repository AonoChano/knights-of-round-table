# 圆桌骑士 KORT

**K**nights **o**f the **R**ound **T**able — 多模型专家小组讨论系统

用户输入一个问题后，多个 AI 模型组成专家小组进行独立思考 → 互相审视 → 多轮讨论 → 最终合成答案。原始专家讨论过程对用户隐藏（Hidden CoT），仅展示 Summarizer 生成的结构化摘要，以第一人称思考链形式呈现。

## 快速启动

```bash
docker compose up --build
```

访问地址：
- 前端：http://localhost:3000
- 后端：http://localhost:8000
- 健康检查：http://localhost:8000/health

## 项目结构

```
kort/
├── apps/
│   ├── api/                          # FastAPI 后端
│   │   ├── src/kort_api/
│   │   │   ├── app.py                # API 端点定义
│   │   │   ├── agents.py             # 代理加载器 (CRUD)
│   │   │   ├── config.py             # 应用配置
│   │   │   ├── conversations.py      # 对话存储 & 可见对话服务
│   │   │   ├── main.py               # 应用入口
│   │   │   ├── model_client.py       # LLM 客户端
│   │   │   ├── orchestration.py      # LangGraph 编排引擎
│   │   │   ├── providers.py          # Provider 管理
│   │   │   ├── schemas.py            # Pydantic 数据模型
│   │   │   └── storage.py            # JSON 文件读写
│   │   ├── tests/
│   │   ├── Dockerfile
│   │   └── pyproject.toml
│   │
│   └── web/                          # Next.js 15 前端
│       ├── app/
│       │   ├── page.tsx              # 主页面（聊天/侧栏/设置）
│       │   ├── layout.tsx            # 根布局
│       │   └── globals.css           # 全局样式
│       ├── Dockerfile
│       ├── package.json
│       ├── tailwind.config.ts
│       └── tsconfig.json
│
├── packages/shared/                  # 跨应用共享契约（预留）
│
├── runtime/                          # 运行时数据（与代码分离）
│   ├── agents/                       # 专家配置（文件系统）
│   │   ├── creative-thinker/agent.yaml
│   │   ├── critic-main/agent.yaml
│   │   ├── logician-main/agent.yaml
│   │   ├── research-lead/agent.yaml
│   │   ├── summarizer-main/agent.yaml
│   │   ├── synthesizer-main/agent.yaml
│   │   └── How To Make A Agent.md    # 自定义 Agent 指南
│   ├── providers/
│   │   └── profiles.json             # Provider 元数据
│   ├── skills/                       # 全局 Skills
│   │   ├── evidence-grounding/
│   │   ├── final-answer-structure/
│   │   ├── gap-analysis/
│   │   ├── hidden-cot-guard/
│   │   ├── stage-summary-projection/
│   │   └── structured-analysis/
│   └── data/                         # 持久化数据
│       ├── conversations.json        # 对话历史
│       └── provider-secrets.local.json # API Key（本地）
│
└── docs/
    └── architecture-rules.md         # 架构规则
```

## 本地开发

### 后端

```bash
cd kort/apps/api
pip install -e ".[dev]"
python -m uvicorn kort_api.main:app --reload --port 8000
```

环境变量（可选 `.env`）：
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

默认运行在 http://localhost:3001（3000 被占用时自动切换）。

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端框架 | Python 3.12 + FastAPI + Uvicorn |
| 编排引擎 | LangGraph |
| LLM 统一调用 | LiteLLM |
| 数据验证 | Pydantic v2 |
| 持久化 | JSON 文件存储 |
| 前端框架 | Next.js 15 + React 19 |
| UI | Tailwind CSS 3 |
| Markdown | react-markdown + KaTeX |
| 部署 | Docker Compose |

## API 端点

### Provider 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/providers` | 列出所有 Provider |
| `PUT` | `/api/providers/:id` | 创建/更新 Provider |
| `POST` | `/api/providers/:id/test` | 测试 Provider 连通性 |
| `GET` | `/api/provider-secrets` | 查看 Secret 状态 |
| `PUT` | `/api/providers/:id/secret` | 保存 API Key |

Provider 配置结构：
```json
{
  "provider_id": "deepseek",
  "label": "DeepSeek",
  "provider_type": "deepseek",
  "base_url": "https://api.deepseek.com",
  "api_style": "openai",
  "default_model": "deepseek-v4-flash",
  "env_key_name": "DEEPSEEK_API_KEY",
  "enabled": true,
  "capabilities": ["chat", "reasoning"]
}
```

### Agent (专家) 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/agents` | 列出所有 Agent |
| `POST` | `/api/agents` | 创建 Agent (201) |
| `PUT` | `/api/agents/:name` | 更新 Agent |
| `DELETE` | `/api/agents/:name` | 删除 Agent (204) |

创建 Agent 示例：
```json
{
  "name": "science-expert",
  "nickname": "Science Expert",
  "role": "expert",
  "provider_profile": "deepseek",
  "model": "deepseek-chat",
  "system_prompt": "You are a science expert...",
  "allowed_global_skills": ["evidence-grounding"],
  "priority": 5
}
```

### Skills

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/skills` | 列出全局 Skills |

### 对话

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/conversations` | 列出对话列表 |
| `GET` | `/api/conversations/:id` | 获取完整对话（含轮次） |
| `PATCH` | `/api/conversations/:id` | 重命名对话 |
| `DELETE` | `/api/conversations/:id` | 删除对话 |
| `POST` | `/api/conversations/stream` | 发起流式对话 (SSE) |

流式对话请求体：
```json
{
  "question": "什么是量子纠缠？",
  "level": "auto",
  "conversation_id": null
}
```

`conversation_id` 为 `null` 时创建新对话；传入已有 ID 则续写多轮对话。

SSE 事件类型：
- `summary_start` / `summary_delta` — 开始输出阶段摘要
- `thinking_node` — 思考树节点
- `final_start` / `final_delta` — 最终答案逐字流式输出
- `conversation_complete` — 对话结束，携带完整轮次数据

## Agent 配置

每个 Agent 位于 `runtime/agents/<name>/`，含 `agent.yaml`：

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
```

| 字段 | 说明 |
|------|------|
| `name` | 稳定标识符，小写字母+连字符，即文件夹名 |
| `nickname` | 界面显示名称 |
| `role` | `expert` / `critic` / `summarizer` / `synthesizer` |
| `provider_profile` | 关联的 Provider ID |
| `model` | 模型名称 |
| `system_prompt` | 系统提示词 |
| `allowed_global_skills` | 允许使用的全局 Skill |
| `disabled_global_skills` | 明确禁用的全局 Skill |

GUI 创建的 Agent 自动保存到对应目录。也可手动在文件夹内创建 Agent。

### 私有 Skills

Agent 可拥有私有 Skill，仅在 `runtime/agents/<name>/skills/` 下创建文件夹，放入 `SKILL.md` 即可。私有 Skill 不在 GUI 中配置，仅通过文件系统管理。

详见 [How To Make A Agent](kort/runtime/agents/How%20To%20Make%20A%20Agent.md)。

## Skills 系统

Skills 是可复用的能力模块，遵循 Agent Skills 协议（详见 `docs/`）。全局 Skills 对所有 Agent 可用，通过 `allowed_global_skills` / `disabled_global_skills` 控制权限。

当前内置 Skills：

| Skill | 说明 |
|-------|------|
| `structured-analysis` | 结构化分析框架 |
| `evidence-grounding` | 证据支撑与引用 |
| `gap-analysis` | 信息缺口检测 |
| `hidden-cot-guard` | 隐藏 CoT 守卫 |
| `stage-summary-projection` | 阶段摘要投影 |
| `final-answer-structure` | 最终答案结构化模板 |

## 核心架构规则

1. **Hidden CoT** — 原始专家讨论永不暴露给用户或持久化
2. **Summarizer 唯一可见输出** — 所有思考 UI 仅由 Summarizer 投影驱动
3. **代码与运行时分离** — 产品代码在 `apps/`，配置数据在 `runtime/`
4. **Secret 安全** — API Key 不写入 YAML/JSON/日志，仅通过加密存储
5. **Schema 先行** — 所有 API 载荷必须 Pydantic 验证

详见 [architecture-rules.md](kort/docs/architecture-rules.md)。

## 前端功能

- **聊天界面** — ChatGPT 风格，简约克制
  - 左侧对话历史侧栏
  - 多轮对话支持（连续上下文延续）
  - 思考过程以可折叠块展示，默认收起，点击展开到右侧思考树抽屉
  - Markdown + 数学公式 (KaTeX) 渲染
- **设置界面** — 左侧导航式布局
  - Provider 管理：配置多家 API，独立 API Key 输入框，连通性测试
  - 专家小组管理：新增/编辑/删除 Agent，配置提示词和 Skills
- **讨论级别** — 可配置展开深度（off / auto / low / medium / high）

## 默认专家小组

| Agent | 角色 | 模型 |
|-------|------|------|
| `research-lead` | 研究主管 (expert) | deepseek-chat |
| `creative-thinker` | 创意发散 (expert) | deepseek-chat |
| `logician-main` | 逻辑分析 (expert) | deepseek-chat |
| `critic-main` | 批判审查 (critic) | deepseek-chat |
| `summarizer-main` | 阶段总结 (summarizer) | deepseek-chat |
| `synthesizer-main` | 最终整合 (synthesizer) | deepseek-chat |

## 对话流程

```
用户提问 → 专家组独立思考（Hidden CoT）
         → 互相审视（Hidden CoT）
         → 多轮讨论（Hidden CoT）
         → Summarizer 生成阶段摘要 → 用户可见
         → Synthesizer 整合讨论结果
         → 选定的 Expert 生成最终答案 → 用户可见
```

## 环境要求

- Python ≥ 3.12
- Node.js ≥ 18
- pnpm（前端包管理）
- Docker & Docker Compose（可选）