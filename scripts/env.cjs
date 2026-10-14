/**
 * 环境探测模块
 * ================================================================
 * 自动找到 Chromium / ffmpeg / 数据目录，适配任意 WorkBuddy 用户。
 * 所有路径都可以用环境变量覆盖：
 *   DOUYIN_CHROME     Chromium 可执行文件
 *   DOUYIN_FFMPEG     ffmpeg 可执行文件
 *   DOUYIN_DATA_DIR   数据目录（登录态、记录文件）
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const HOME = os.homedir();
const WB = path.join(HOME, '.workbuddy-ai');
const LOCAL_APP = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const MS_PLAYWRIGHT = path.join(LOCAL_APP, 'ms-playwright');

function firstExisting(cands) {
  for (const c of cands) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

/** 列出 baseDir 下匹配 pattern 的子目录，按名称倒序（取最新版本） */
function matchDirs(baseDir, pattern) {
  if (!fs.existsSync(baseDir)) return [];
  let names;
  try {
    names = fs.readdirSync(baseDir);
  } catch (e) {
    return [];
  }
  const re = new RegExp(pattern);
  return names
    .filter((n) => re.test(n))
    .sort()
    .reverse()
    .map((n) => path.join(baseDir, n));
}

/** 在目录树里按文件名递归查找（默认向下 3 层） */
function findFileRecursive(dir, fileName, depth = 3) {
  if (depth < 0 || !fs.existsSync(dir)) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return null;
  }
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase() === fileName.toLowerCase()) {
      return path.join(dir, e.name);
    }
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const r = findFileRecursive(path.join(dir, e.name), fileName, depth - 1);
      if (r) return r;
    }
  }
  return null;
}

/** Chromium：环境变量 → ms-playwright 各版本 */
function findChromium() {
  if (process.env.DOUYIN_CHROME && fs.existsSync(process.env.DOUYIN_CHROME)) {
    return process.env.DOUYIN_CHROME;
  }
  for (const dir of matchDirs(MS_PLAYWRIGHT, '^chromium(-headless-shell)?-\\d+$')) {
    const exe = firstExisting([
      path.join(dir, 'chrome-win64', 'chrome.exe'),
      path.join(dir, 'chrome-win', 'chrome.exe'),
      path.join(dir, 'chrome-linux', 'chrome'),
    ]);
    if (exe) return exe;
  }
  // 常见系统安装位置
  return firstExisting([
    path.join(LOCAL_APP, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ]);
}

/** ffmpeg：环境变量 → 系统 PATH → ms-playwright 自带 → WinGet 安装 */
function findFfmpeg() {
  if (process.env.DOUYIN_FFMPEG && fs.existsSync(process.env.DOUYIN_FFMPEG)) {
    return process.env.DOUYIN_FFMPEG;
  }
  // 系统 PATH
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 10000 });
    return 'ffmpeg';
  } catch (e) {
    /* 未安装或不可用 */
  }
  // ms-playwright 自带（随 playwright 安装，通常可用）
  for (const dir of matchDirs(MS_PLAYWRIGHT, '^ffmpeg-\\d+$')) {
    const exe = firstExisting([
      path.join(dir, 'ffmpeg-win64.exe'),
      path.join(dir, 'ffmpeg.exe'),
    ]);
    if (exe) return exe;
  }
  // WinGet / 常见安装目录
  const wingetPkgs = path.join(LOCAL_APP, 'Microsoft', 'WinGet', 'Packages');
  if (fs.existsSync(wingetPkgs)) {
    for (const d of fs.readdirSync(wingetPkgs)) {
      if (!/ffmpeg/i.test(d)) continue;
      const f = findFileRecursive(path.join(wingetPkgs, d), 'ffmpeg.exe', 4);
      if (f) return f;
    }
  }
  return firstExisting([
    'C:/ffmpeg/bin/ffmpeg.exe',
    'C:/Program Files/ffmpeg/bin/ffmpeg.exe',
    path.join(HOME, 'scoop', 'shims', 'ffmpeg.exe'),
  ]);
}

/** 由 ffmpeg 路径推导同目录的 ffprobe */
function ffprobeOf(ffmpeg) {
  if (!ffmpeg || ffmpeg === 'ffmpeg') return 'ffprobe';
  const guess = path.join(path.dirname(ffmpeg), path.basename(ffmpeg).replace(/ffmpeg/i, 'ffprobe'));
  return fs.existsSync(guess) ? guess : null;
}

const CHROME = findChromium();
const FFMPEG = findFfmpeg();
const FFPROBE = ffprobeOf(FFMPEG);
const DATA_DIR = process.env.DOUYIN_DATA_DIR || path.join(WB, 'douyin-data');

/** 检查关键依赖，返回问题列表（空数组 = 全部就绪） */
function checkEnv() {
  const problems = [];
  if (!CHROME) problems.push('未找到 Chromium（请确认已安装 playwright 浏览器）');
  if (!FFMPEG) problems.push('未找到 ffmpeg（请安装，或设置环境变量 DOUYIN_FFMPEG）');
  return problems;
}

/**
 * ffmpeg 自动获取：探测不到时，自动下载静态版到 ~/.workbuddy-ai/tools/ffmpeg/
 * 这样用户无需手动安装。
 */
const FFMPEG_URLS = [
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
  'https://ghproxy.net/https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
];

function ensureFfmpeg(onLog) {
  const log = onLog || (() => {});
  const found = findFfmpeg();
  if (found) return found;

  const dir = path.join(WB, 'tools', 'ffmpeg');
  const exe = path.join(dir, 'ffmpeg.exe');
  if (fs.existsSync(exe)) return exe;

  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, 'ffmpeg.zip');

  for (const url of FFMPEG_URLS) {
    try {
      log('   未找到 ffmpeg，正在下载（约 80MB）...');
      execFileSync('curl', ['-L', '--max-time', '600', '-o', zip, url], { stdio: 'ignore' });
      if (!fs.existsSync(zip) || fs.statSync(zip).size < 1024 * 1024) continue;

      log('   解压中...');
      // Windows 自带 tar（bsdtar）可直接解压 zip
      execFileSync('tar', ['-xf', zip, '-C', dir], { stdio: 'ignore' });

      // 在解压结果里找 ffmpeg.exe
      const found2 = findFileRecursive(dir, 'ffmpeg.exe', 4);
      if (found2) {
        // 统一放到 dir 根目录，方便下次直接命中
        if (path.dirname(found2) !== dir) {
          fs.copyFileSync(found2, exe);
        }
        try { fs.unlinkSync(zip); } catch (e) { /* ignore */ }
        log('   ffmpeg 已就绪: ' + exe);
        return exe;
      }
    } catch (e) {
      log('   下载失败，换源重试...');
    }
  }
  return null;
}

module.exports = {
  HOME, WB, LOCAL_APP, MS_PLAYWRIGHT,
  CHROME, FFMPEG, FFPROBE, DATA_DIR,
  findChromium, findFfmpeg, ffprobeOf, checkEnv, ensureFfmpeg,
  firstExisting, matchDirs, findFileRecursive,
};
