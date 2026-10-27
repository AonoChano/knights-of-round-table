<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="kort/apps/web/public/kort-readme-logo-inverted.svg" />
    <img alt="KORT" src="kort/apps/web/public/kort-readme-logo.svg" width="300" height="96" />
  </picture>
</div>

<h1 align="center">圆桌骑士 KORT</h1>

<p align="center">
  KORT 是一个自托管的多模型对话应用：一个问题交给一组专家模型讨论，讨论过程可回放，最后只留一份答案。<br/>
  模型接口自备 API Key，支持 OpenAI、OpenAI Responses 与 Anthropic 三类协议。
</p>

<p align="center">
  <a href="README.md">English</a>
  ·
  <a href="#界面">界面</a>
  ·
  <a href="#架构">架构</a>
  ·
  <a href="#快速启动">快速启动</a>
  ·
  <a href="#api-接口">API</a>
  ·
  <a href="kort/docs/architecture-rules.md">架构规则</a>
</p>

<p align="center">
  <img alt="backend FastAPI" src="https://img.shields.io/badge/backend-FastAPI-009688?style=flat-square" />
  <img alt="frontend Next.js 15" src="https://img.shields.io/badge/frontend-Next.js_15-111111?style=flat-square" />
  <img alt="orchestration LangGraph" src="https://img.shields.io/badge/orchestration-LangGraph-2F6FEB?style=flat-square" />
  <img alt="python 3.12+" src="https://img.shields.io/badge/python-3.12%2B-F3D15F?style=flat-square&logo=python&logoColor=111" />
  <img alt="tests" src="https://img.shields.io/badge/tests-185%20passed-2f7d32?style=flat-square" />
  <img alt="hidden CoT" src="https://img.shields.io/badge/%E9%9A%90%E8%97%8F%E6%80%9D%E7%BB%B4%E9%93%BE-%E5%8F%AA%E5%AD%98%E5%90%8E%E7%AB%AF%E7%8A%B6%E6%80%81-6A5ACD?style=flat-square" />
  <img alt="界面语言" src="https://img.shields.io/badge/%E7%95%8C%E9%9D%A2%E8%AF%AD%E8%A8%80-%E4%B8%AD%E6%96%87%20%C2%B7%20English-6B7280?style=flat-square" />
</p>

<p align="center">
  <img src="screenshots/zh-01-home.webp" alt="空对话状态：左侧历史列表，底部输入框带附件、联网、专家与模型控件" width="900" />
</p>

---

## 项目简介

一个问题会进入三条路由之一：

| 路由 | 触发条件 | 行为 |
| --- | --- | --- |
| 专家小组 | 讨论档位 `auto` / `low` / `medium` / `high` | LangGraph 跑专家与批判者轮次，总结者投映阶段摘要，整合者产出最终答案 |
| 深度思考 | 关闭小组且开启深度思考 | 单个 agent 推理，复用同一套工具循环与事件契约 |
| 直答 | 关闭小组 | 无人设的 harness 席位单轮作答 |

三条路由共用同一套事件流、同一份消息树 schema、同一条持久化路径，因此界面、全文索引和记忆层都
不需要判断这次是谁答的。

产品边界：原始专家讨论和供应商 reasoning 内容只存在于后端运行时状态。被流出、被存下、被建索引的
只有阶段摘要、圆桌里可见的公开审议发言，以及最终答案。

## 界面

### 圆桌

小组开启时，每条回答下方带一排席位。点开即重放讨论：像素角色按与会席位围火而坐，一次显示一个气泡，
播放倍速 0.75×–2×，可展开讨论记录直接读，房间分夜间圆桌与白昼书房两套主题，播到最后一条即停，
不循环。

<table>
  <tr>
    <td width="50%"><img src="screenshots/zh-12-room-night.webp" alt="夜间圆桌，一位专家正在发言，底部为播放控制条" /></td>
    <td width="50%"><img src="screenshots/zh-14-room-day.webp" alt="同一间房间的白昼主题" /></td>
  </tr>
  <tr>
    <td colspan="2"><img src="screenshots/zh-13-room-transcript.webp" alt="讨论记录面板，逐条列出发言人" /></td>
  </tr>
</table>

席位形象是对 Anthropic 吉祥物 Clawd 的手工复刻，出处与致谢见[商标与致谢](#商标与致谢)。

自带专家是中文人设，因此小组输出不随提问语言切换；单一模型路由跟随提问语言。名称、人设、角色和
优先级都在设置里可改。

### 思考带与思考抽屉

每条回答下方是一条折叠的思考带：当前阶段、委派了哪些专家、耗时、每一次联网检索与网页抓取。展开
后右侧抽屉显示完整树——阶段摘要、带参数的工具调用、讨论结构。

<img src="screenshots/zh-10-thinking-drawer.webp" alt="左侧回答，右侧展开的思考抽屉含阶段节点与工具调用" width="900" />

### 模型与档位选择

输入框上的开关在「专家小组」和「单一模型」之间切换。切到单一模型后，选择器改为供应商优先：一行
一个供应商并配品牌图标，模型列表向右侧飞出，供应商和模型数量再多也不会撑破菜单。支持图片的模型
带眼睛标记。

<table>
  <tr>
    <td width="50%"><img src="screenshots/zh-04-model-menu.webp" alt="供应商行向右展开模型子菜单，支持图片的模型带眼睛标记" /></td>
    <td width="50%"><img src="screenshots/zh-07-level-menu.webp" alt="讨论档位菜单：自动、低、中、高" /></td>
  </tr>
</table>

讨论深度是档位而非布尔值：`auto` 交给路由判断，`low` 保持简短交锋，`medium` 与 `high` 放开席位，
最多轮次可在 1–12 之间指定。关闭小组时，同一位置换成「深度思考」开关。

### 附件

「+」弹出两项菜单——图片、文本文件——而不是直接打开文件选择器。图片在浏览器端解码、按 EXIF 转正、
最长边压到 1600px、转质量 0.86 的 JPEG；12MB 的手机照片通常只剩一两百 KB。附件卡片显示真实尺寸与
压缩后大小。

<table>
  <tr>
    <td width="50%"><img src="screenshots/zh-03-attach-menu.webp" alt="附件菜单：图片与文件两行" /></td>
    <td width="50%"><img src="screenshots/zh-06-image-chip.webp" alt="输入框内已挂图片附件卡片并写了问题" /></td>
  </tr>
  <tr>
    <td colspan="2"><img src="screenshots/zh-15-image-answer.webp" alt="对话中显示的截图，以及模型给出的控件清单" /></td>
  </tr>
  <tr>
    <td width="50%"><img src="screenshots/zh-16-file-answer.webp" alt="带文本附件的一轮对话，模型指出脚本问题" /></td>
    <td width="50%"><img src="screenshots/zh-02-composer.webp" alt="输入框：附件、联网、专家、模型四组控件排在文字框下方" /></td>
  </tr>
</table>

图片输入要求模型具备 vision 且讨论档位为 `off`。两条限制各校验一次：输入框在发送前禁用并给出
原因，后端在写盘之前返回 422。文本附件（代码、Markdown、日志）三条路由通用，带字符数进入提示词。
麦克风按钮走浏览器 `SpeechRecognition` 做听写。

### 排版渲染

回答按 Markdown 渲染：GFM 表格、KaTeX 公式、高亮代码块。流式输出按句子落地，而不是每来一个 token
就重绘整条消息，长回答因此不会抖动或跳位。

<img src="screenshots/zh-09-answer-code.webp" alt="回答中渲染出的代码块与表格" width="900" />

### 联网检索

联网是三态控件——`auto`、`required`、`disabled`——作用范围覆盖整个推理循环，不只是第一轮：模型可以
先想、再查、抓一页、接着想。调用过程在思考带里逐行显示，回答中的引用以序号标注来源。

<table>
  <tr>
    <td width="40%"><img src="screenshots/zh-05-search-menu.webp" alt="联网菜单：自动、必须联网、关闭" /></td>
    <td width="60%"><img src="screenshots/zh-18-websearch-tools.webp" alt="展开的工具行，逐条显示检索词与抓取的页面" /></td>
  </tr>
  <tr>
    <td colspan="2"><img src="screenshots/zh-17-websearch.webp" alt="带引用序号的回答，下方是检索工具条" /></td>
  </tr>
</table>

### 分支

消息是树而不是列表。修改问题或触发「重新生成」会新建一个兄弟分支，不覆盖历史，用
`< 2 / 2 >` 在兄弟之间切换。后续追问接在当前选中的分支上，所以一段对话可以真正分叉。

<table>
  <tr>
    <td width="50%"><img src="screenshots/zh-11-branches.webp" alt="分支导航显示 2/2，旁边是复制与重新生成" /></td>
    <td width="50%"><img src="screenshots/zh-30-multi-turn.webp" alt="多轮对话，含代码块与标题层级" /></td>
  </tr>
</table>

### 搜索与历史地图

<kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> 打开对话搜索，范围是所有存过的标题与正文，底层是
SQLite 全文索引，命中按字节安全高亮，回车直接跳到那条消息。对话内左侧轨道把每一轮画成一个刻度，
悬停预览、点击跳转。

<table>
  <tr>
    <td width="50%"><img src="screenshots/zh-20-search-dialog.webp" alt="搜索弹窗：范围按钮与高亮结果" /></td>
    <td width="50%"><img src="screenshots/zh-27-map.webp" alt="对话地图轨道与悬停预览卡片" /></td>
  </tr>
</table>

### 设置

七个标签页：通用（语言、开发者模式、日志级别）、模型（供应商、密钥、接口）、专家小组（角色、提示
词、优先级、Skill 权限）、记忆、Skills、数据、开发者。

<table>
  <tr>
    <td width="50%"><img src="screenshots/zh-22-settings-providers.webp" alt="模型页：供应商配置列表，带品牌图标与密钥状态" /></td>
    <td width="50%"><img src="screenshots/zh-26-add-model.webp" alt="添加模型弹窗：供应商、类型、模型、密钥四步" /></td>
  </tr>
  <tr>
    <td width="50%"><img src="screenshots/zh-23-settings-experts.webp" alt="专家小组页，列出角色与优先级" /></td>
    <td width="50%"><img src="screenshots/zh-24-settings-memory.webp" alt="记忆页：事实、直觉、情景与梦境日志" /></td>
  </tr>
  <tr>
    <td width="50%"><img src="screenshots/zh-21-settings-general.webp" alt="通用页：语言、开发者模式、日志级别" /></td>
    <td width="50%"><img src="screenshots/zh-25-settings-skills.webp" alt="Skills 页，列出全局能力模块" /></td>
  </tr>
</table>

新增供应商是四步弹窗（供应商 → 接口类型 → 模型 → 密钥）。目录预置十四个入口：DeepSeek、阿里云百炼、
千问 AI 平台、智谱 GLM、豆包·火山方舟、Kimi、MiniMax、小米 MiMo、Anthropic、OpenAI、OpenRouter、
Microsoft Copilot、Ollama 本地，以及任意 OpenAI 兼容的自定义端点。密钥写入本地文件，接口只回一个
「已配置」布尔值。

### 记忆与做梦

每位专家维护私有事实、直觉与情景，另有一份全体共享的池子。取用受 token 预算约束。「做梦」是一次
巩固：提出新事实、合并或归档旧条目、把值得共享的晋升上去；可以先试运行读日志，确认后才写入，写入
前会为专家目录拍快照。做梦的输入范围只有用户可见内容——问题、阶段摘要、最终答案。

### 窄屏

移动端宽度下布局收成单列，侧栏改为抽屉，模型选择器改为整屏列表并带返回头。

<table>
  <tr>
    <td width="50%"><img src="screenshots/zh-28-mobile-chat.webp" alt="390px 宽度下的对话" /></td>
    <td width="50%"><img src="screenshots/zh-29-mobile-sidebar.webp" alt="移动端抽屉式侧栏" /></td>
  </tr>
</table>

## 架构

```mermaid
flowchart LR
  Q[问题] --> R{路由}
  R -- "档位 off" --> D[直答]
  R -- "深度思考" --> S[单人推理循环]
  R -- "auto / low / medium / high" --> P[LangGraph 轮次]
  P --> E[专家] --> C[批判者] --> P
  P --> M[总结者：可见阶段摘要] --> Y[整合者：最终答案]
  D --> O[SSE 流 + JSON 树]
  S --> O
  Y --> O
  T[web_search / web_fetch] -.-> S
  T -.-> P
  T -.-> D
```

核心约束：

- 隐藏思维链不发给前端、不持久化、不写日志。
- 讨论编排只以 `kort_api/orchestration.py` 的 LangGraph 为事实来源；直答与深度思考复用同一套事件和
  节点结构，不再写第二套循环。
- 跨边界的数据全部经 Pydantic 校验；前端类型镜像后端 schema，校验失败即安全失败。
- Provider 密钥只走本地密钥文件或环境变量，不进 YAML、SQLite、API 响应和日志。
- 产品代码在 `kort/apps`，专家、Skill、供应商配置与数据在 `kort/runtime`。

详见 [architecture-rules.md](kort/docs/architecture-rules.md)。

## 快速启动

### Docker

```bash
docker compose up --build
```

| 服务 | 地址 |
| --- | --- |
| Web | <http://localhost:3000> |
| API | <http://localhost:8000> |
| 接口文档 | <http://localhost:8000/docs> |
| 健康检查 | <http://localhost:8000/health> |

### Windows 启动器

仓库根目录的 `start-dev.cmd`：检查 Node 与 pnpm，缺 `.venv` 则创建，缺依赖则安装，然后同时拉起两个
服务并打开浏览器。设 `KORT_OPEN_BROWSER=0` 可跳过开浏览器。

### 手动

```bash
# 后端
py -3.13 -m venv .venv
.venv\Scripts\activate
cd kort/apps/api
pip install -e ".[dev]"
python -m uvicorn kort_api.main:app --app-dir src --reload --port 8000

# 前端
cd kort/apps/web
pnpm install
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 pnpm dev
```

仓库根目录的 `pnpm dev` 会先停掉残留服务再同时启动两端。供应商在 **设置 → 模型** 里运行时配置，密钥
落在 `kort/runtime/data/provider-secrets.local.json`，该文件已被 git 忽略。

## 配置项

`apps/api/src/kort_api/config.py` 读取的环境变量（全部可选，括号为默认值）：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `RUNTIME_ROOT` | `kort/runtime` | 专家、Skill、供应商配置、记忆 |
| `DATA_ROOT` | `kort/runtime/data` | 对话、搜索索引、本地密钥 |
| `PROVIDERS_FILE` | `runtime/providers/profiles.json` | 供应商配置 |
| `CONVERSATION_DB` | `runtime/data/conversations.json` | 消息树存储 |
| `SECRETS_FILE` | `runtime/data/provider-secrets.local.json` | 本地 API Key |
| `MEMORY_BUDGET_TOKENS` | `320` | 单次回忆的 token 预算 |
| `MEMORY_AUTO_DREAM` | `true` | 空闲时自动巩固 |
| `MEMORY_DREAM_MIN_EPISODES` / `_HOURS` | `6` / `24` | 做梦阈值 |
| `AGENT_MAX_ROUNDS` | `6` | 未指定时的讨论轮次 |
| `AGENT_MAX_TOOL_CALLS` / `_SEARCHES` / `_FETCHES` | `8` / `5` / `4` | 单轮工具预算 |
| `AGENT_MAX_SECONDS` | `180` | 单轮墙钟上限 |
| `WEB_SEARCH_MAX_RESULTS` / `WEB_FETCH_MAX_CHARS` | `8` / `4000` | 工具输出规模 |
| `CORS_ORIGINS` | localhost 的 `:3000`/`:3001` | 允许跨域的来源 |

## API 接口

<details>
<summary><b>供应商与模型</b></summary>

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/providers` | 列出供应商配置（不含密钥） |
| `POST` / `PUT` | `/api/providers/{id}` | 新建 / 更新配置 |
| `DELETE` | `/api/providers/{id}` | 删除配置及其本地密钥 |
| `POST` | `/api/model-probes` | 保存前探测端点与模型列表 |
| `GET` | `/api/provider-secrets` | 每个供应商的密钥配置状态 |
| `PUT` | `/api/providers/{id}/secret` | 写入本地密钥文件 |

</details>

<details>
<summary><b>对话与流式</b></summary>

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/conversations/{id}/branches` | 提交一轮，SSE 流式并落一个节点 |
| `GET` | `/api/conversations/{id}/stream` | 重新接上运行中的任务 |
| `GET` | `/api/conversations` | 对话列表 |
| `GET` | `/api/conversations/{id}` | 读取完整消息树 |
| `GET` | `/api/conversations/search` | 全文检索（`scope=all|title|message`，游标分页） |
| `POST` | `/api/conversations/{id}/active-path` | 切换到兄弟分支 |
| `POST` | `/api/conversations/{id}/cancel` | 取消运行中的任务 |
| `PATCH` / `DELETE` | `/api/conversations/{id}` | 改名 / 删除 |

分支请求字段：`parent_id`、`role`、`content`、`level`、`deep_think`、`custom_max_rounds`、
`web_search`、`preferred_agent`、`model_override`，以及最多四个附件。图片要求 `level: "off"`、模型
具备 vision、且不开深度思考，不满足时在写盘前返回 422。

</details>

<details>
<summary><b>专家、Skill 与记忆</b></summary>

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` / `POST` | `/api/agents` | 列出 / 新建专家 |
| `PUT` / `DELETE` | `/api/agents/{name}` | 更新 / 删除（系统专家返回 403） |
| `GET` | `/api/skills` | 列出全局 Skill |
| `GET` | `/api/memory` | 每位专家的记忆状态 |
| `GET` | `/api/memory/{agent}/detail` | 事实、直觉、情景、梦境日志 |
| `POST` | `/api/memory/{agent}/remember` | 写入记忆（私有 / 共享 / 固定） |
| `PATCH` / `DELETE` | `/api/memory/{agent}/facts/{id}` | 编辑 / 归档 |
| `POST` | `/api/memory/{agent}/facts/{id}/promote` | 晋升为共享记忆 |
| `POST` | `/api/memory/{agent}/dream` | 试运行（`apply: false`）或真正巩固 |

</details>

## 内置专家

`kort/runtime/agents` 下十个专家，默认全部绑定 `deepseek-flash`：

| 专家 | 角色 | 优先级 |
| --- | --- | --- |
| `research-lead` | expert | 0 |
| `creative-thinker` | expert | 0 |
| `logician-main` | expert | 0 |
| `dream-weaver` | expert | 15 |
| `archivist` | expert | 20 |
| `field-scribe` | expert | 25 |
| `critic-main` | critic | 0 |
| `gardener` | critic | 30 |
| `summarizer-main` | summarizer | 10 |
| `synthesizer-main` | synthesizer | 0 |

`summarizer-main` 与 `synthesizer-main` 为系统专家：拒绝删除和改角色，「只投映可见摘要」的契约依赖
它们。

专家目录遵循 [How To Make A Agent](kort/runtime/agents/How%20To%20Make%20A%20Agent.md) 的文件协议：

```yaml
name: archivist
nickname: 档案员
role: expert
provider_profile: deepseek
model: deepseek-flash
priority: 20
allowed_global_skills:
  - structured-analysis
  - evidence-grounding
disabled_global_skills: []
```

## 内置 Skills

`kort/runtime/skills` 下十个全局 Skill 是能力模块，由专家在 `agent.yaml` 里授权或禁用：

| Skill | 用途 |
| --- | --- |
| `expert` | 专家发言框架 |
| `critic` | 审查与质疑纪律 |
| `summarizer` | 阶段摘要投映 |
| `synthesizer` | 最终答案组装 |
| `structured-analysis` | 结构化推理框架 |
| `evidence-grounding` | 证据与引用纪律 |
| `gap-analysis` | 缺失信息识别 |
| `hidden-cot-guard` | 隐藏思维链边界守卫 |
| `stage-summary-projection` | 用户可见阶段摘要格式 |
| `final-answer-structure` | 最终答案结构模板 |

私有 Skill 放在 `kort/runtime/agents/{name}/skills/`。四个带人设的专家各含一个私有 Skill，并附
`persona.md`、`self_seed.md` 与 `memory_seed.jsonl`。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 后端 | Python 3.12/3.13、FastAPI、Uvicorn |
| 编排 | LangGraph |
| 校验 | Pydantic v2 |
| 模型接入 | OpenAI chat、OpenAI Responses、Anthropic messages |
| 前端 | Next.js 15.5、React 19、TypeScript 5.8 |
| 样式 | 手写 CSS，拆成十二个带编号样式表，另有 `discussion.css` 与 `models.css`；Tailwind 只保留少量 token |
| 渲染 | react-markdown、remark-gfm、remark-math、rehype-katex |
| 持久化 | 对话/专家/供应商为 JSON，记忆为 JSONL，检索为 SQLite FTS |
| 部署 | Docker Compose |

## 目录结构

```text
kort/
├── apps/
│   ├── api/src/kort_api/
│   │   ├── app.py             # 路由
│   │   ├── orchestration.py   # LangGraph 讨论图，编排的唯一事实来源
│   │   ├── agent_loop.py      # 推理与工具循环
│   │   ├── conversations.py   # 消息树、SSE 任务、持久化
│   │   ├── model_client.py    # OpenAI / Responses / Anthropic 三种载荷
│   │   ├── web_research.py    # web_search、web_fetch
│   │   ├── memory.py          # 回忆、事实、做梦
│   │   ├── search_index.py    # SQLite 全文索引
│   │   └── schemas.py         # Pydantic 契约
│   └── web/
│       ├── app/               # 页面外壳、语言包、按编号拆分的样式
│       └── components/        # 输入框、圆桌、思考带、模型管理、记忆、搜索
├── runtime/                   # 专家、Skill、供应商配置、数据、记忆
├── screenshots/               # README 配图（webp，宽 1600，中英各一套）
└── docs/architecture-rules.md
```

## 商标与致谢

- **Anthropic / Claude / Clawd** 为 Anthropic 的商标。讨论圆桌里的像素小人是对 Anthropic 吉祥物
  Clawd 的手工复刻，源码在
  [`components/discussion/characters/Clawd.tsx`](kort/apps/web/components/discussion/characters/Clawd.tsx)，
  按网格逐格画成 SVG，用于本项目的席位形象。
- 本项目与 Anthropic 无关联，未获其赞助、背书或授权；对模型接口的调用遵循各供应商自己的服务条款。
- 供应商品牌图标来自 [simple-icons](https://simple-icons.github.io/simple-icons-website/)（CC0），
  各图标对应的标志仍归其权利人所有。界面图标来自 [lucide-react](https://lucide.dev/)（ISC）。
- 上述第三方权利均不因本仓库而授予使用者。新增或替换席位形象只需向
  [`characters/registry.ts`](kort/apps/web/components/discussion/characters/registry.ts) 注册一个新的
  `CharacterDefinition`，不需要改动讨论视图。

## 自检

```bash
# 后端 —— 在 kort/apps/api 下
../../../.venv/Scripts/python.exe -m pytest tests -q     # 185 passed

# 前端类型 —— 在 git 根目录
pnpm --dir kort/apps/web exec tsc --noEmit

# 生产构建（先停 dev，两者共用 .next）
cd kort && pnpm dev:stop && pnpm build:web
```

`.github/workflows/ci.yml` 在每次推送到 `main` 和每个 PR 上跑两项：Python 3.12 的 pytest，Node 22
的 `tsc --noEmit`。

> [!NOTE]
> 本文截图来自一次本机运行：临时 runtime、临时对话数据，是为截图现造的演示问题。回答为模型真实输出，
> 只挑了排版清晰的，不代表结论正确。
