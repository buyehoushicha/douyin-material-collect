# 抖音收藏夹 → 创作素材库

> 把抖音收藏的视频，自动变成一双可以反复复用的**小说/剧本创作素材库**。

刷到一个好故事，收藏进抖音收藏夹 → 本工具自动下载视频、把口播转成文字、提炼出**去 IP 化**的故事结构（人设原型、情节模块、金句表达、冲突主题）→ 沉淀进一个长期积累的 Excel 素材库。

**视频和文案都是中间产物，用完即删。你最终只得到一个文件：`创作素材库.xlsx`。**

---

## 这是什么

一个 **WorkBuddy Agent Skill**。

WorkBuddy 的 Agent 能读懂 `SKILL.md` 里的说明，自动完成「采集 → 提取 → 提炼 → 入库」全流程。你只需要在 WorkBuddy 里说一句「**更新素材库**」。

里面的脚本（Node + Python）也完全可以脱离 WorkBuddy 单独跑，见下方「手动使用」。

## 它解决什么问题

大部分人刷抖音刷到好故事，只是「收藏了，再也没看过」。
这个工具把那堆收藏变成**可被检索、可被复用的创作资产**：

- 看完一个「废柴逆袭」的解说视频 → 得到一条抽象的「废柴逆袭」人设原型 + 对应的情节模块
- 素材**不记具体角色名和专有设定** → 你可以安全地套用到自己的故事里，不涉及版权
- 素材按类型分表沉淀，越用越厚

## 产出长什么样

`创作素材库.xlsx`，5 张表：

| 表名 | 内容 | 字段示例 |
|---|---|---|
| 人设原型 | 可复用的角色模板 | 原型名称 / 核心特征 / 内在矛盾 / 行为逻辑 / 弧光走向 / 适用题材 |
| 情节模块 | 可套用的情节结构 | 模块名称 / 结构描述 / 情绪效果 / 可套用场景 |
| 金句表达 | 值得借鉴的表达 | 金句 / 表达技巧 / 使用情境 |
| 冲突主题 | 故事冲突母题 | 冲突主题 / 描述 / 适用题材 |
| 来源索引 | 每条素材的出处 | 视频标题 / 类型 / 入库条目数 / 处理日期 |

---

## 快速开始

### 方式 A：作为 WorkBuddy Skill（推荐）

```bash
# 1. 把仓库克隆到 WorkBuddy 的 skills 目录
git clone https://github.com/<你的用户名>/douyin-material-collect.git \
  ~/.workbuddy-ai/skills/douyin-material-collect
```

然后在 WorkBuddy 里说一句「**更新素材库**」，AI 助手会：
1. 检查配置，缺 API Key 就主动问你要
2. 自动采集、下载、转文字、提炼、入库
3. 清理掉中间产物

首次使用详见 **[INSTALL.md](INSTALL.md)**。

### 方式 B：手动跑脚本

```bash
# 依赖
npm install playwright-core
# 首次装浏览器（若 WorkBuddy / 本地没有 Chromium）
npx playwright install chromium

pip install requests openpyxl send2trash

# 1) 扫码登录抖音
node scripts/login.cjs

# 2) 配置 API Key 与素材库路径
node scripts/setup.cjs

# 3) 采集收藏夹里的视频
node scripts/collect.cjs

# 4) 提取口播文案
python scripts/extract_text.py

# 5) 手动提炼素材并入库（这一步需要人/AI 来做）
python 素材库/material_lib.py add 条目.json
```

> `ffmpeg` 无需手动安装 —— 脚本会自动探测；实在找不到会**自动下载**静态版。

---

## 前置条件

| 依赖 | 说明 |
|---|---|
| Node.js | 脚本自动探测 |
| playwright-core + Chromium | 用于浏览器自动化 |
| **ffmpeg** | 自动探测 + 自动下载，**无需手动装** |
| Python 3.11+ | 需装 `requests` `openpyxl` `send2trash` |
| **硅基流动 API Key** | 用于语音转文字，需注册并**充值**（免费模型也要求账户有余额） |
| 抖音账号 | 需扫码登录，并建一个名为「小说素材」的收藏夹 |

所有路径**自动探测**（基于 `~` 和目录扫描），可用环境变量覆盖：
`DOUYIN_CHROME` / `DOUYIN_FFMPEG` / `DOUYIN_DATA_DIR` / `MATERIAL_LIB` / `SILICONFLOW_API_KEY`

---

## 工作原理

1. 带登录态打开 `douyin.com/user/self?showTab=favorite_collection`
2. 拦截 `/aweme/v1/web/collects/list/` 找到目标收藏夹 ID
   ⚠️ 必须用 `collects_id_str`，`collects_id` 是 int64，JS 解析会**丢精度**
3. 点击收藏夹，拦截 `/aweme/v1/web/collects/video/list/` 拿视频列表（滚动翻页）
4. 逐个下载（两种播放方式都要处理，见下）
5. 提取音频 → 调硅基流动 ASR（`FunAudioLLM/SenseVoiceSmall`）→ 得到文案
6. 提炼素材 → 写入素材库

### 一个关键坑：抖音有两种播放方式

| | DASH 分轨（主流） | progressive 直链（部分视频） |
|---|---|---|
| `currentSrc` | `blob:...`（不可下载） | `https://...douyinvod.com/...` |
| 抓取方式 | 拦截 `media-video` / `media-audio` 两条流 | 读 `<video>.currentSrc` 直链 |
| 处理 | ffmpeg `-c copy` 合并音视频轨 | 单文件直接下载（已含音轨） |

只处理 DASH 会导致 progressive 视频必然失败（等一个永远不出现的请求）。本项目两种都覆盖。

---

## 项目结构

```
douyin-material-collect/
├── SKILL.md              # WorkBuddy Agent 读的说明（含首次配置流程）
├── INSTALL.md            # 面向用户的安装与使用文档
├── scripts/
│   ├── env.cjs           # 环境探测（Chromium / ffmpeg / 数据目录）
│   ├── login.cjs         # 扫码登录
│   ├── setup.cjs         # 首次配置向导（API Key + 素材库路径）
│   ├── collect.cjs       # 采集收藏夹并下载视频
│   └── extract_text.py   # 音频切分 + ASR 转文字
└── 素材库/
    └── material_lib.py   # 素材库管理（init / add / stat）
```

---

## 注意事项

- **限速**：每条视频之间随机等 4–12 秒。**不要改成 0** —— 高频访问会触发风控。
- **登录态会过期**：报错提示未登录或列表为空时，重跑 `login.cjs` 重新扫码。
- **收藏夹名要精确匹配**：脚本按名称查找，默认「小说素材」，多一个字都找不到。
- **合规**：仅用于备份 / 整理**自己账号**收藏的内容。素材入库时**必须去 IP 化**（不记具体角色名和专有设定），避免后续创作产生版权问题。

## License

[MIT](LICENSE)
