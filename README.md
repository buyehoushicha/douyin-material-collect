# 抖音收藏夹 → 创作素材库

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-WorkBuddy%20Skill-6f42c1.svg)](#-快速开始)
[![Node](https://img.shields.io/badge/Node.js-%E2%89%A518-339933.svg)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB.svg)](https://python.org)

> **刷到好故事，收藏进抖音 → 自动变成可复用的创作素材。**
>
> 一个 WorkBuddy Skill：下载收藏夹视频 → 语音转文字 → 提炼人设原型 / 情节模块 / 金句表达 / 冲突主题 → 沉淀进长期积累的 Excel 素材库。

---

## 📖 目录

- [它能帮你做什么](#-它能帮你做什么)
- [产出长什么样](#-产出长什么样)
- [快速开始](#-快速开始)
- [使用说明](#-使用说明)
- [常见问题](#-常见问题)
- [免责声明](#-免责声明)
- [License](#-license)

---

## 💡 它能帮你做什么

大部分人刷抖音刷到好故事，只是「收藏了，再也没看过」。**这个工具把那堆吃灰的收藏变成可被检索、可复用的创作资产。**

| 你的困惑 | 它给出的答案 |
| --- | --- |
| 看了很多故事，但写的时候想不起来 | 抽象成人设原型 / 情节模块，随时翻 |
| 想借鉴但怕抄袭 | 素材**不记具体角色名和专有设定**，只留故事结构 |
| 素材散落各处，越攒越乱 | 按 4 个维度自动分类，沉淀进一张 Excel |

**你最终只得到一个文件：`创作素材库.xlsx`。** 视频和文案都是中间产物，用完即删。

## 📦 产出长什么样

`创作素材库.xlsx`，5 张表：

| 表名 | 内容 | 字段示例 |
| --- | --- | --- |
| 人设原型 | 可复用的角色模板 | 原型名称 / 核心特征 / 内在矛盾 / 行为逻辑 / 弧光走向 / 适用题材 |
| 情节模块 | 可套用的情节结构 | 模块名称 / 结构描述 / 情绪效果 / 可套用场景 |
| 金句表达 | 值得借鉴的表达 | 金句 / 表达技巧 / 使用情境 |
| 冲突主题 | 故事冲突母题 | 冲突主题 / 描述 / 适用题材 |
| 来源索引 | 每条素材的出处 | 视频标题 / 类型 / 入库条目数 / 处理日期 |

> 例：看完一个「废柴逆袭」的解说视频 → 得到一条抽象的「废柴逆袭」人设原型 + 对应情节模块，可以直接套进你自己的故事。

---

## 🚀 快速开始

### 作为 WorkBuddy Skill（推荐）

```bash
# 1. 克隆到 WorkBuddy 的 skills 目录
git clone https://github.com/buyehoushicha/douyin-material-collect.git \
  ~/.workbuddy-ai/skills/douyin-material-collect
```

**2. 在 WorkBuddy 里说一句：「更新素材库」**

剩下的全自动 —— AI 会检查配置、缺 API Key 主动问你要，然后采集 → 下载 → 转写 → 提炼 → 入库 → 清理中间产物。

首次使用详见 **[INSTALL.md](INSTALL.md)**。

### 手动跑脚本

<details>
<summary>点开查看完整命令（不想用 WorkBuddy 的话）</summary>

```bash
# 依赖
npm install playwright-core
npx playwright install chromium          # 首次装浏览器
pip install requests openpyxl send2trash

# 1) 扫码登录抖音
node scripts/login.cjs

# 2) 配置 API Key 与素材库路径
node scripts/setup.cjs

# 3) 采集收藏夹里的视频
node scripts/collect.cjs

# 4) 提取口播文案
python scripts/extract_text.py

# 5) 提炼素材并入库（这一步需要人 / AI 来做）
python 素材库/material_lib.py add 条目.json
```

</details>

> 💡 `ffmpeg` 无需手动安装 —— 脚本会自动探测；实在找不到会**自动下载**静态版。

### 前置条件

| 依赖 | 说明 |
| --- | --- |
| Node.js | 脚本自动探测 |
| playwright-core + Chromium | 用于浏览器自动化 |
| **ffmpeg** | 自动探测 + 自动下载，**无需手动装** |
| Python 3.11+ | 需装 `requests` `openpyxl` `send2trash` |
| **硅基流动 API Key** | 用于语音转文字，需有余额（第一次登录有送，免费模型也要求账户有余额） |
| 抖音账号 | 需扫码登录，并建一个名为「小说素材」的收藏夹 |

所有路径**自动探测**（基于 `~` 和目录扫描），可用环境变量覆盖：  
`DOUYIN_CHROME` / `DOUYIN_FFMPEG` / `DOUYIN_DATA_DIR` / `MATERIAL_LIB` / `SILICONFLOW_API_KEY`

---

## 🔧 使用说明

### 第一步：采集收藏夹

在抖音把视频收藏进「**小说素材**」收藏夹，然后：

```bash
node scripts/collect.cjs
```

| 参数 | 作用 |
| --- | --- |
| （无） | 采集全部未下载的项 |
| `--dry-run` | 只列出收藏夹内容，不下载 |
| `--limit N` | 最多下载 N 条 |
| `--folder NAME` | 指定收藏夹名（默认「小说素材」） |
| `--out DIR` | 指定输出目录 |

### 第二步：提取文案

```bash
python scripts/extract_text.py
```

| 参数 | 作用 |
| --- | --- |
| `--only <视频ID>` | 只处理指定视频（增量提取，逗号分隔） |
| `--keep-video` | 保留视频（默认提取成功后删除） |
| `--keep-table` | 文案表输出到视频目录并保留（默认写临时目录） |
| `--seg N` | 音频切片秒数，默认 30 |

### 第三步：提炼入库

这一步由 **AI 助手**完成：读文案 → 按四个维度提炼 → 写 `_batch/NN_xxx.json` → `material_lib.py add` 入库。

---

## ❓ 常见问题

<details>
<summary><b>报「未登录」或列表为空？</b></summary>

登录态过期了。重跑 `node scripts/login.cjs` 重新扫码。
</details>

<details>
<summary><b>报「未找到收藏夹」？</b></summary>

收藏夹名字必须精确是「小说素材」。检查有没有多余空格。
</details>

<details>
<summary><b>报 <code>402 balance insufficient</code>？</b></summary>

硅基流动账户余额不足。充值即可（即使模型标价 Free 也有这个门槛）。
</details>

<details>
<summary><b>抓不到视频流？</b></summary>

短时间访问太频繁会触发风控。**等 10 分钟再试**。脚本已内置 4–12 秒限速，不要去掉。
</details>

<details>
<summary><b>ffmpeg 自动下载失败？</b></summary>

手动装一个：`winget install Gyan.FFmpeg`，或到 [ffmpeg.org](https://ffmpeg.org/download.html) 下载后设环境变量 `DOUYIN_FFMPEG`。
</details>

---

## ⚖️ 免责声明

**本项目仅供个人学习、研究与技术交流使用，请在使用前仔细阅读以下内容：**

1. **使用范围**：本工具仅用于下载、备份、整理**使用者本人账号**中收藏的公开内容。请勿用于批量抓取、下载他人作品或任何侵犯他人合法权益的用途。

2. **账号风险**：本工具通过浏览器自动化访问抖音，自动化操作可能触发平台风控，存在账号被限制、封禁的风险。使用者应自行评估并承担该风险，建议合理控制访问频率。**因使用本工具导致的账号异常、数据丢失或其他损失，作者不承担任何责任。**

3. **版权声明**：通过本工具获取的视频、文案、音频等内容，其著作权均归原作者及相应权利人所有。本工具**不主张**对上述内容的任何权利，也不提供任何内容的分发与传播。使用者应在法律允许的范围内使用，不得将抓取的内容用于商业用途或公开发布。

4. **创作风险**：本工具提炼的素材**不记录具体角色名与专有设定**，仅供参考。**使用者需自行确保其后续创作不侵犯他人知识产权。** 因直接套用、改编他人作品而引发的任何版权纠纷或法律责任，由使用者自行承担。

5. **服务可用性**：本工具依赖抖音、硅基流动等第三方服务的接口与页面结构。上述服务可能随时变更或停止，本项目不保证长期可用，也不对因接口变更导致的失效承担责任。

6. **无担保**：本项目按「现状」提供，不附带任何明示或暗示的担保。使用本工具所产生的一切后果由使用者自行负责。

**继续使用本项目，即表示您已阅读、理解并同意上述全部条款。**

---

## 📄 License

[MIT](LICENSE) © 2026 buyehoushicha
