---
name: douyin-material-collect
description: 从抖音收藏里指定的收藏夹（默认「小说素材」）读取视频，下载后提取口播文案，再提炼成可复用的创作素材（人设原型/情节模块/金句表达/冲突主题）写入素材库。当用户说「更新素材库」「采集小说素材」「把新收藏的视频加进素材库」「从小说素材收藏夹读取」「提取新视频的文案并入库」时使用。
---

# 抖音「小说素材」收藏夹 → 创作素材库

从抖音收藏里指定的收藏夹读取视频，下载 → 转文字 → 提炼素材 → 入库。

**首次使用请先看 [INSTALL.md](INSTALL.md)**（依赖安装、扫码登录、配 API Key）。

## 前置条件

| 依赖 | 说明 |
|---|---|
| Node.js | WorkBuddy 自带，脚本自动探测 |
| playwright-core + Chromium | WorkBuddy 自带，脚本自动探测 |
| **ffmpeg** | 脚本自动探测；找不到会**自动下载**，无需手动装 |
| Python 3.11+ | WorkBuddy 自带；需装 `requests` `openpyxl` `send2trash` |
| 硅基流动 API Key | 自己注册 + **充值**（免费模型也要求账户有余额） |
| 抖音账号 | 需扫码登录，并建一个名为「小说素材」的收藏夹 |

**所有路径自动探测**（基于 `~` 和目录扫描），可用环境变量覆盖：
`DOUYIN_CHROME` / `DOUYIN_FFMPEG` / `DOUYIN_DATA_DIR` / `MATERIAL_LIB` / `SILICONFLOW_API_KEY`

---

## 首次使用（AI 助手必读）

**第一次执行本 skill 时，AI 必须先检查配置；缺失时主动向用户索要，不要直接开跑。**

### 检查步骤

1. 运行 `node scripts/setup.cjs --show` 查看当前配置
2. 若 **API Key 显示「未配置」** → 必须询问用户要硅基流动的 API Key
3. 询问**素材库保存路径**（用户不指定就用默认）
4. 运行下面命令保存：

```bash
NODE_PATH="<WorkBuddy>/binaries/node/workspace/node_modules" \
  "<WorkBuddy>/binaries/node/versions/<版本>/node.exe" scripts/setup.cjs \
  --key "sk-用户的key" --lib "D:/用户想要的路径/创作素材库.xlsx"
```

> `--lib` 可省略，省略则素材库放在素材库脚本同目录。

### 向用户询问的话术（建议）

> 开始前需要你提供两样东西：
>
> **1. 硅基流动 API Key**（用于把语音转成文字）
> 到 [siliconflow.cn](https://siliconflow.cn) 注册并**充值**，然后在控制台创建 Key，格式是 `sk-` 开头。
> ⚠️ 注意：`SenseVoiceSmall` 虽然标价免费，但账户**没有余额会报 402**，所以必须充值。
>
> **2. 素材库保存位置**
> 不指定的话，默认放在 `<默认路径>`。想放别处就直接告诉我路径。

### 配置保存位置

`~/.workbuddy-ai/douyin-data/config.json`

---

## 目录约定

| 用途 | 默认路径 |
|---|---|
| 下载的视频 | `~/Downloads/小说素材视频/`（提取后自动删除） |
| 文案表 | 系统临时目录（用完即弃，不保留） |
| 登录态 / 记录 | `~/.workbuddy-ai/douyin-data/` |
| 素材库 | `material_lib.py` 同目录下的 `创作素材库.xlsx` |

**最终产物只有素材库。** 视频和文案都是中间产物，用完即删。

## 用法

### 第一步：采集收藏夹里的视频

```bash
cd "<skill 目录>"
NODE_PATH="<WorkBuddy>/binaries/node/workspace/node_modules" \
  "<WorkBuddy>/binaries/node/versions/<版本>/node.exe" scripts/collect.cjs
```

| 参数 | 作用 |
|---|---|
| （无） | 采集全部未下载的项 |
| `--dry-run` | 只列出收藏夹内容，不下载 |
| `--limit N` | 最多下载 N 条 |
| `--folder NAME` | 指定收藏夹名（默认「小说素材」） |
| `--out DIR` | 指定输出目录 |

### 第二步：提取口播文案

```bash
"<WorkBuddy>/binaries/python/envs/default/Scripts/python.exe" scripts/extract_text.py
```

| 参数 | 作用 |
|---|---|
| `--only <视频ID>` | 只处理指定视频（增量提取，多个用逗号分隔） |
| `--keep-video` | 保留视频文件（默认提取成功后删除） |
| `--keep-table` | 文案表输出到视频目录并保留（默认写系统临时目录） |
| `--seg N` | 音频切片秒数，默认 30 |

### 第三步：提炼素材并入库

**这一步由 AI 助手完成**（不是脚本）：
1. 读提取出的文案
2. 按四个维度提炼**去 IP 化**的素材
3. 写 `_batch/NN_xxx.json`
4. 跑 `material_lib.py add` 入库

## 工作原理

1. 带登录态打开 `douyin.com/user/self?showTab=favorite_collection`
2. 拦截 `/aweme/v1/web/collects/list/` 找到目标收藏夹的 ID
   ⚠️ **必须用 `collects_id_str`**，`collects_id` 是 int64，JS 解析会丢精度（实测末位被抹成 000）
3. 点击收藏夹，拦截 `/aweme/v1/web/collects/video/list/` 拿视频列表（滚动翻页）
4. 逐个下载（**两种播放方式都要处理**，见下）
5. 提取音频 → 调硅基流动 ASR → 得到文案
6. AI 提炼素材 → 写入素材库

## 关键坑（已修复）

**抖音有两种播放方式，缺一不可：**

| | DASH 分轨（主流） | progressive 直链（部分视频） |
|---|---|---|
| `currentSrc` | `blob:...`（不可下载） | `http(s)://...douyinvod.com/...` |
| 抓取方式 | 拦截 `media-video` / `media-audio` 两条流 | 读 `<video>.currentSrc` 直链 |
| 处理 | ffmpeg `-c copy` 合并音视频轨 | 单文件直接下载（已含音轨） |

只处理 DASH 会导致 progressive 视频必然失败（等一个永远不出现的请求）。

## 注意事项

- **限速**：每条之间随机等 4–12 秒。**不要改成 0** —— 高频访问会触发风控。
- **登录态会过期**：报错提示未登录或列表为空时，重跑 `login.cjs` 重新扫码。
- **收藏夹名要精确匹配**：脚本按名称查找，名称不符会提示找不到。
- **合规**：仅用于备份/整理自己账号收藏的内容。素材入库时**必须去 IP 化**（不记具体角色名和专有设定），避免后续创作产生版权问题。
