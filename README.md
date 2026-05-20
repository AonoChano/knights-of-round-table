
# 圆桌骑士 KORT

多模型专家小组讨论系统 - 隐藏真实 CoT + 分阶段思考过程展示

## 快速启动

```powershell
docker compose up --build
```

访问 http://localhost:3000 使用

API 健康检查地址为 http://localhost:8000/health

## 项目结构

产品代码隔离在 `kort/` 子目录中：

- `kort/apps/api`: FastAPI 后端
- `kort/apps/web`: Next.js 前端
- `kort/runtime/agents`: 文件系统专家配置
- `kort/runtime/skills`: 全局 Skills
- `kort/runtime/providers`: 非敏感 Provider profiles

后端只返回用户可见投影：阶段摘要、思考树节点、最终答案和安全元数据。原始专家讨论不得写入 API 响应或持久化数据。

