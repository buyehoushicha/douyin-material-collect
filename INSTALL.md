# 安装与首次使用

> 这是一个 WorkBuddy 专用的 Skill：从抖音收藏夹读取视频 → 提取口播文案 → 提炼成创作素材。

## 一、依赖清单

| 依赖 | 是否需要自己装 | 说明 |
|---|---|---|
| **WorkBuddy** | 必须有 | 本 Skill 依赖它的 node / python / Chromium 环境 |
| **playwright-core + Chromium** | 可能要 | 若 WorkBuddy 未自带，见下方「装浏览器」 |
| **ffmpeg** | **不用管** | 脚本会自动探测；实在找不到会自动下载（约 80MB） |
| **Python 包** | **要装** | `requests` `openpyxl` `send2trash` |
| **硅基流动账号** | 要注册 | 用于语音转文字，**需要充值**（免费模型也要求账户有余额） |
| **抖音账号** | 要有 | 要扫码登录，且需要建一个收藏夹 |

### 装 Python 包

```bash
"C:/Users/<你的用户名>/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe" \
  -m pip install requests openpyxl send2trash -i https://mirrors.aliyun.com/pypi/simple/
```

> 如果 `envs/default` 不存在，先在 WorkBuddy 里任意跑一次 Python 任务，它会自动创建。

### 装浏览器（如果报「未找到 Chromium」）

```bash
cd "C:/Users/<你的用户名>/.workbuddy-ai/binaries/node/workspace"
"C:/Users/<你的用户名>/.workbuddy-ai/binaries/node/versions/<版本>/node.exe" \
  "$(npm root)/playwright-core/cli.js" install chromium
```

---

## 二、首次配置（三步）

### 第 1 步：在抖音建一个收藏夹

打开抖音 App → 我的 → 收藏 → 新建收藏夹，**名字必须精确叫「小说素材」**（脚本按名称查找，多一个字都找不到）。

把你想采集成素材的视频收藏进去。

### 第 2 步：扫码登录

```bash
cd "<你的 skill 目录>"
NODE_PATH="C:/Users/<你的用户名>/.workbuddy-ai/binaries/node/workspace/node_modules" \
  "C:/Users/<你的用户名>/.workbuddy-ai/binaries/node/versions/<版本>/node.exe" scripts/login.cjs
```

会弹出一个浏览器窗口，用抖音 App 扫码。登录态保存后**不用重复登录**（但会过期，见下方排查）。

### 第 3 步：配置 API Key 与素材库路径

**推荐用配置向导**（会逐项提问）：

```bash
cd "<你的 skill 目录>"
NODE_PATH="C:/Users/<你的用户名>/.workbuddy-ai/binaries/node/workspace/node_modules" \
  "C:/Users/<你的用户名>/.workbuddy-ai/binaries/node/versions/<版本>/node.exe" scripts/setup.cjs
```

它会问两件事：

1. **硅基流动 API Key** —— 到 [siliconflow.cn](https://siliconflow.cn) 注册并**充值**后创建，格式 `sk-` 开头
   > ⚠️ `SenseVoiceSmall` 虽然标价 Free，但账户**没有余额会返回 402**，所以必须充值。

2. **素材库保存路径** —— 直接回车用默认（素材库脚本同目录）

**也可以非交互式配置**（供 AI 助手调用）：

```bash
"$NODE" scripts/setup.cjs --key "sk-你的key" --lib "D:/你想放的位置/创作素材库.xlsx"
```

查看当前配置：`node scripts/setup.cjs --show`

> 配置保存在 `~/.workbuddy-ai/douyin-data/config.json`。

**手动配置（备用）**：直接把 key 写入 `~/.workbuddy-ai/douyin-data/siliconflow.key`。

---

## 三、日常使用

**只有两步：**

1. 在抖音，把想采集的视频收藏进「小说素材」收藏夹
2. 在 WorkBuddy 里说一句「**更新素材库**」

剩下全自动：采集 → 下载 → 提取文案 → 删视频 → 提炼素材 → 入库 → 删文案。

### 手动跑（备用）

```bash
cd "<你的 skill 目录>"

# 1) 采集收藏夹里的新视频
NODE_PATH="C:/Users/<你的用户名>/.workbuddy-ai/binaries/node/workspace/node_modules" \
  "C:/Users/<你的用户名>/.workbuddy-ai/binaries/node/versions/<版本>/node.exe" scripts/collect.cjs

# 2) 提取文案（默认提取后自动删视频）
"C:/Users/<你的用户名>/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe" scripts/extract_text.py
```

---

## 四、你最终得到什么

**只有一个文件：`创作素材库.xlsx`**

包含 5 张表：人设原型 / 情节模块 / 金句表达 / 冲突主题 / 来源索引。

**视频和文案都是中间产物，用完即删**，不会占你磁盘。

### 素材库脚本用法

包里的 `素材库/material_lib.py` 是素材库的管理工具：

```bash
cd "<你的素材库目录>"
PY="C:/Users/<你的用户名>/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe"

"$PY" material_lib.py init          # 首次运行，创建空的素材库
"$PY" material_lib.py add 条目.json  # 追加一批素材
"$PY" material_lib.py stat          # 查看统计
```

素材库 xlsx 会生成在**脚本同目录**。想放别处就设环境变量 `MATERIAL_LIB`。

> 正常使用时不用手动跑这些命令——直接跟 WorkBuddy 说「更新素材库」，它会自动完成采集、提取、提炼、入库。

---

## 五、环境变量（可选）

所有路径都可以覆盖，一般不用设：

| 变量 | 作用 |
|---|---|
| `DOUYIN_CHROME` | 指定 Chromium 可执行文件 |
| `DOUYIN_FFMPEG` | 指定 ffmpeg 可执行文件 |
| `DOUYIN_DATA_DIR` | 数据目录（登录态、记录文件） |
| `MATERIAL_LIB` | 素材库 xlsx 路径 |
| `SILICONFLOW_API_KEY` | API Key（优先于 key 文件） |

---

## 六、常见问题

**Q：报「未登录」或列表为空？**
登录态过期了。重跑第 2 步扫码。

**Q：报「未找到收藏夹」？**
收藏夹名字必须精确是「小说素材」。检查有没有多余空格。

**Q：报 `402 balance insufficient`？**
硅基流动账户余额不足。充值即可（即使模型标价 Free 也有这个门槛）。

**Q：抓不到视频流？**
短时间访问太频繁会触发风控。**等 10 分钟再试**。脚本已内置 4–12 秒限速，不要去掉。

**Q：ffmpeg 自动下载失败？**
手动装一个：`winget install Gyan.FFmpeg`，或到 [ffmpeg.org](https://ffmpeg.org/download.html) 下载后设环境变量 `DOUYIN_FFMPEG`。

---

## 七、合规提醒

- **仅用于备份/整理自己账号收藏的内容**
- 不要用于批量抓取他人作品
- 素材入库时**必须去 IP 化**（不记录具体角色名和专有设定），避免后续创作产生版权问题
