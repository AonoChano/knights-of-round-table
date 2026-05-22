# Knights of the Round Table 项目核心规则

## 项目目标

构建一个支持多模型专家小组讨论的 Web 聊天应用。用户输入一个问题后，多个模型组成专家小组进行独立思考 → 互相审视 → 多轮讨论 → 最终合成答案。

## 核心 Harness 要求

- 使用 LangGraph 作为核心编排引擎

- 所有专家原始对话必须隐藏（Hidden CoT）

- 必须使用独立 Summarizer 模型在每个阶段生成结构化摘要

- 只允许用户看到「分阶段思考过程」+「最终答案」

- 优先使用 LiteLLM 统一调用所有 API 和本地模型

## 专家角色定义

- Expert: 领域深度思考者

- Critic: 严格批判者和找茬者

- Summarizer: 专业分阶段摘要生成器（输出格式固定）

- Synthesizer: 最终答案整合者

## 输出要求
- 新建一个自文件夹叫做`kort`，实际软件代码放那里面，不要放到当前目录，当前目录为工作空间需要和产品隔离。

- 用户界面只能展示 Summarizer 生成的分阶段摘要（Timeline/Accordion 格式）

- 最终答案必须清晰、结构化、带置信度

- 所有内部讨论仅存在于 LangGraph State 中

## 技术栈要求

- Backend: Python + FastAPI + LangGraph + LiteLLM

- Frontend: Next.js 15 + Tailwind + shadcn/ui

- 部署: Docker Compose

## 最佳实践

- 每轮讨论后必须触发 Summarizer

- 使用 Pydantic 验证所有输出

- 支持 4~12 轮可配置讨论


## 界面要求：
- 参见本目录下的`C:\Users\CYcha\Documents\MyCodes\kort\界面示例.png`文件，尽可能一比一还原。
	- 模仿ChatGPT风格：简约，克制
	- 点击界面左侧栏下方的`专家小组状态`的小卡片或是从设置中（左下角角落里的用户名片 - 更多(···)-设置 ）可配置多家API，也可自定义。配制时APIKey设置框互不串扰。可测连通性，符合人类习惯,配置便利。
	- 设置界面模仿ChatGPT，左边一个竖着的那种导航栏，右边是具体的配置界面。
	- 有一个菜单就叫做专家小组。里面默认会有一个模型，点击专家卡片进入他的配置界面，可以点击添加按钮新增。会依次要用户填入专家名字（限英文小写和连字符）和显示的昵称（无太多限制，不影响代码即可），API的配置。然后是填写这个专家的提示词，和允许的独特的Skills配置（从配置的全局Skills中选取或禁止）（见`C:\Users\CYcha\Documents\MyCodes\kort\docs\Introduce to Skills.md`以了解该协议）。
	- 另一种方式可以导入Agent，那就是在这个项目某个目录里会有一个`agents`文件夹，里面会有一个`How To Make A Agent.md`（要你帮用户写的）。用户在软件内GUI用按钮创建的Agents其实就是分文件夹（以专家名字命名）保存在里面的。里面会有一个yaml文档。文档中记录了该专家的名字，昵称，系统提示词。和从与`agents`文件夹同父文件夹下的`skills`文件夹里的skills中选中的名单（一行一个）。该目录中还可以 存放单独的skills，意为只有这个Agent可以读取到的Skill。所以用户可以手动在文件夹内创建Agents目录以被软件自动读取。
	-`skills`文件夹：分为agents内部和全局。全局的skills所有ai可以访问和通过自己的yaml配置访问权限。这些skills位于与`agents`文件夹同父文件夹下的`skills`。而agents内部，全局不可见，仅存在于agent自己的文件夹下的skills文件夹内，且一旦有必然配置。agents内部skills不支持在GUI中配置以免界面繁琐，让懂行的开发者按需根据`How To Make A Agent.md`的说明自行配置使用。
	- 思考过程：
		- 思考过程总结模型被设计出来的目的是不暴露专家们的讨论过程，当一轮讨论被标记为结束。总结模型读取当前会话并总结为第一人称为视角的思考链。连`存在多个模型在讨论`这一事实也被隐藏。用户只能看到类似：
		```CoT
		• I'm considering ways to pause certain functions like renderUserMessages and sanitizeSidebar during scrolling or
		  collapsing actions. I notice that renderUserMessages processes quickly, but a virtual list can cause repeated nodes
		  during scrolling. The user pointed out there's still lag, especially when folding blocks. If I add a check like
		  isViewportSettled(), I may be able to skip heavy operations during this time. This might improve the user experience
		  by reducing flicker from new nodes appearing.

		  **Inspecting code for improvements**

		• I need to check the current patch for any syntax errors. I could implement a gating system within the tick function to
		  handle heavy tasks based on whether scrolling is stable. A global helper, possibly named isViewportBusy(), could help
		  here. This would assess both scroll stability and collapse status. Additionally, applying dialog width changes every
		  tick might cause unnecessary recalculations. However, if we're careful with managing the target ID, it could still
		  work effectively.

		  **Evaluating boot processes**

		• I’m looking into the boot calls, like initCollapseFeature and tick. The lines between 5172-5182 show functions like
		  initTooltipSystem and applyCollapseState. It seems like the order matters here, especially with markScrollActivity
		  being initialized before the first tick, which might set isScrollStable to false and skip some heavy tasks—that's not
		  ideal. I could call schedulePostScrollTick soon to address any issues, but I need to think this through a bit more.

		  **Considering function timing**

		• I'm thinking about how this function alters text and might cause a layout shift. It seems like it would be better to
		  execute it only once when the system is idle. That way, we can avoid any unnecessary disruptions or shifts while the
		  user is trying to work with the layout. It's definitely something I'd like to consider for better performance!

		  **Considering runtime adjustments**

		• I’m thinking maybe the width runtime should skip when scrolling is unstable. That might not be necessary, but if width
		  changes affect the layout during scrolling, it could be a concern — especially in the composer area with the fixed
		  bottom. It doesn’t seem like a big issue, but I need to ensure that scheduleIdleHeavyTick isn’t recursive through the
		  tick wrapper. Okay, let's patch that up!
		 ```
		这样的思考链条被折叠在思考块内。并且思考过程默认不展开，只轮替显示粗体标题以及小段的前20词左右。除非用户手动点击带有呼吸效果的思考文本才以右侧栏的形式以思考树（可参考`C:\Users\CYcha\Documents\MyCodes\kort\ThinkingTree.png`）的右侧的链条形式展开给用户看。当大家都觉得讨论得差不多了，会进行让谁输出的环节，判定标准只有一个──量才而用。简单的日常回复啥的，只需要让便宜的模型输出即可。相对复杂的，让比较便宜的但是稍微强悍的思考模型去做即可。
		最后推出一个专家的名字和讨论终止标志。那就解散专家组。然后留下总结者面相用户输出结果。
	- 输出结果：
		结果的输出如同普通的模型输出，这一边并不发生过多的改变，类似与任何一个模型的思考后的输出即可。专家们在讨论的最后会指派一个模型进行输出，这个模型会带着众人讨论的内容的上下文，进行对讨论结果的输出的请求，这次的输出请求的思考过程不会被请求并展现给用户。只向用户展示最后的正文结果。
	
---
# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.


---

## Codex 八荣八耻

* 以瞎猜接口为耻，以认真查询为荣。
* 以模糊执行为耻，以寻求确认为荣。
* 以臆想业务为耻，以人类确认为荣。
* 以创造接口为耻，以复用现有为荣。
* 以跳过验证为耻，以主动测试为荣。
* 以破坏架构为耻，以遵循规范为荣。
* 以假装理解为耻，以诚实无知为荣。
* 以盲目修改为耻，以谨慎重构为荣。

---
