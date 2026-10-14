#!/usr/bin/env node
/**
 * 抖音「小说素材」收藏夹 · 视频采集
 *
 * 从抖音收藏里指定的收藏夹（默认「小说素材」）读取视频列表并下载到本地，
 * 供后续提取文案、转为创作素材。
 *
 * 用法：
 *   node collect.cjs --dry-run              只列出收藏夹内容，不下载
 *   node collect.cjs                        采集全部（跳过已下载的）
 *   node collect.cjs --limit 3              最多下载 3 条（测试用）
 *   node collect.cjs --folder 小说素材       指定收藏夹名（默认「小说素材」）
 *   node collect.cjs --out D:/videos        指定输出目录
 *
 * 依赖：playwright-core（通过 NODE_PATH 加载）、ffmpeg、本机 Chromium
 */

const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const env = require('./env.cjs');

const CHROME = env.CHROME;
let FFMPEG = env.FFMPEG;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DATA_DIR = env.DATA_DIR;
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
// 与旧 skill 的记录文件分开，互不干扰
const RECORD_FILE = path.join(DATA_DIR, 'material_downloaded.json');
const DEFAULT_OUT = path.join(os.homedir(), 'Downloads', '小说素材视频');
const DEFAULT_FOLDER = '小说素材';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const flag = (name) => argv.includes('--' + name);

const OUT_DIR = path.resolve(arg('out', DEFAULT_OUT));
const LIMIT = parseInt(arg('limit', '0'), 10) || 0;
const DRY = flag('dry-run');
const FOLDER = arg('folder', DEFAULT_FOLDER);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const log = (...a) => console.log('[' + new Date().toTimeString().slice(0, 8) + ']', ...a);

function loadRecord() {
  try {
    return JSON.parse(fs.readFileSync(RECORD_FILE, 'utf8'));
  } catch {
    return { done: {}, failed: {} };
  }
}
function saveRecord(rec) {
  fs.mkdirSync(path.dirname(RECORD_FILE), { recursive: true });
  fs.writeFileSync(RECORD_FILE, JSON.stringify(rec, null, 2), 'utf8');
}
function safeName(s, max = 50) {
  return (
    (s || '')
      .replace(/[\\/:*?"<>|\n\r\t#]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max) || 'untitled'
  );
}

async function fetchList(ctx, folderName) {
  const page = await ctx.newPage();
  const map = new Map();
  let folderId = null;
  let listCalls = 0;
  let videoCalls = 0;

  page.on('response', async (r) => {
    const u = r.url();
    // 收藏夹列表：找出目标收藏夹的 ID
    if (/collects\/list/.test(u) && !/video/.test(u)) {
      try {
        const j = await r.json();
        listCalls++;
        for (const c of j.collects_list || []) {
          const name = (c.collects_name || '').trim();
          if (name === folderName) {
            // collects_id 是 int64，JS 解析会丢精度，必须用 _str 版本
            folderId = c.collects_id_str || String(c.collects_id);
          }
        }
      } catch (e) { /* 非 JSON */ }
    }
    // 收藏夹内容
    if (/collects\/video\/list/.test(u)) {
      try {
        const j = await r.json();
        videoCalls++;
        for (const it of j.aweme_list || []) {
          if (it.aweme_id) {
            map.set(it.aweme_id, {
              desc: it.desc || '',
              create_time: it.create_time || 0,
            });
          }
        }
      } catch (e) { /* 非 JSON */ }
    }
  });

  await page.goto('https://www.douyin.com/user/self?showTab=favorite_collection', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await sleep(9000);

  // 切到「收藏夹」分类
  try {
    const tab = page.locator('text=收藏夹').first();
    if (await tab.count() > 0) {
      await tab.click({ timeout: 5000 });
      await sleep(6000);
    }
  } catch (e) { /* 可能已在收藏夹页 */ }

  if (!folderId) {
    log('   ⚠ 未在收藏夹列表中找到「' + folderName + '」');
  } else {
    log('   收藏夹「' + folderName + '」ID = ' + folderId);
    // 点击目标收藏夹，触发其内容加载
    try {
      const el = page.locator('text=' + folderName).first();
      if (await el.count() > 0) {
        await el.click({ timeout: 5000 });
        await sleep(6000);
      }
    } catch (e) { /* 可能已是默认打开的收藏夹 */ }
  }

  let stable = 0;
  let last = -1;
  for (let i = 0; i < 200; i++) {
    if (map.size === last) {
      stable++;
      if (stable >= 4) break;
    } else {
      stable = 0;
      last = map.size;
      log('   已发现 ' + map.size + ' 条');
    }
    await page.mouse.wheel(0, 2600);
    await sleep(rand(2200, 3200));
  }
  await page.close();

  log('收藏夹列表接口 ' + listCalls + ' 次，内容接口 ' + videoCalls + ' 次，去重后 ' + map.size + ' 条');
  return [...map.entries()].map(([id, v]) => ({ aweme_id: id, ...v }));
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runFfmpeg(v, a, out, srcUrl) {
  const args = ['-y', '-loglevel', 'error', '-i', v, '-i', a, '-c', 'copy'];
  if (/hvc1|hevc|h265/i.test(String(srcUrl || ''))) args.push('-tag:v', 'hvc1');
  args.push(out);
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      execFileSync(FFMPEG, args, { stdio: 'ignore' });
      return;
    } catch (e) {
      lastErr = e;
      if (!/EBUSY|EACCES|EPERM|ETXTBSY/.test(String(e.message))) throw e;
      log('   ffmpeg 被占用，重试 ' + (i + 1) + '/3 ...');
      sleepSync(1500);
    }
  }
  throw lastErr || new Error('ffmpeg 合并失败');
}

async function downloadOne(ctx, item, outDir) {
  const base = item.aweme_id + '_' + safeName(item.desc);
  const finalFile = path.join(outDir, base + '.mp4');
  // 已存在则直接跳过，连视频页都不访问（减少风控暴露）
  if (fs.existsSync(finalFile) && fs.statSync(finalFile).size > 10240) {
    return { ok: true, file: finalFile, skipped: true };
  }

  let vUrl = null;
  let aUrl = null;
  let directUrl = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    vUrl = null;
    aUrl = null;
    directUrl = null;
    const page = await ctx.newPage();
    page.on('response', (r) => {
      const u = r.url();
      if (u.includes('media-video') && !vUrl) vUrl = u;
      if (u.includes('media-audio') && !aUrl) aUrl = u;
    });
    try {
      await page.goto('https://www.douyin.com/video/' + item.aweme_id, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      // 轮询：优先等 DASH 分轨；同时读 video.currentSrc 作为兜底
      // （部分视频走 progressive 直接播放，不发 media-video 请求）
      for (let i = 0; i < 15 && !vUrl && !directUrl; i++) {
        await sleep(1000);
        if (!directUrl) {
          const cs = await page
            .evaluate(() => {
              const v = document.querySelector('video');
              return v ? (v.currentSrc || v.src || '') : '';
            })
            .catch(() => '');
          // blob: 是 MSE 流，不可直接下载；只认 http(s) 直链
          if (cs && /^https?:/i.test(cs)) directUrl = cs;
        }
      }
    } catch (e) {
      /* 加载异常按未捕获处理，走重试 */
    } finally {
      await page.close();
    }
    if (vUrl || directUrl) break;
    if (attempt < 3) {
      const wait = rand(25000, 45000);
      log('   未捕获媒体流，等待 ' + Math.round(wait / 1000) + 's 后重试 (' + attempt + '/3)');
      await sleep(wait);
    }
  }

  if (!vUrl && !directUrl) {
    return { ok: false, reason: '未捕获媒体流（重试 3 次仍失败，可能被风控限流，建议间隔一段时间再试）' };
  }

  const vTmp = path.join(outDir, '.' + item.aweme_id + '.v.mp4');
  const aTmp = path.join(outDir, '.' + item.aweme_id + '.a.mp4');

  const grab = async (url, file) => {
    if (fs.existsSync(file) && fs.statSync(file).size > 102400) {
      return fs.statSync(file).size;
    }
    const resp = await ctx.request.get(url, {
      headers: { Referer: 'https://www.douyin.com/', 'User-Agent': UA },
      timeout: 120000,
    });
    if (resp.status() !== 200) throw new Error('HTTP ' + resp.status());
    fs.writeFileSync(file, await resp.body());
    return fs.statSync(file).size;
  };

  if (vUrl) {
    // DASH 分轨：视频轨 + 音频轨分开，用 ffmpeg 合并
    await grab(vUrl, vTmp);

    let hasAudio = false;
    if (aUrl) {
      try {
        await grab(aUrl, aTmp);
        hasAudio = true;
      } catch (e) {
        log('   音频轨下载失败（将输出无声视频）: ' + e.message);
      }
    }

    if (hasAudio) {
      runFfmpeg(vTmp, aTmp, finalFile, vUrl);
      fs.rmSync(vTmp, { force: true });
      fs.rmSync(aTmp, { force: true });
    } else {
      fs.renameSync(vTmp, finalFile);
    }
  } else {
    // progressive 直链：单文件已含音轨，直接下载即可
    log('   走直链路径（progressive mp4）');
    await grab(directUrl, finalFile);
  }

  return { ok: true, file: finalFile, size: fs.statSync(finalFile).size };
}

(async () => {
  // 环境自检
  if (!CHROME) {
    console.error('✗ 未找到 Chromium，请确认已安装 playwright 浏览器');
    process.exit(1);
  }
  // ffmpeg 缺失时自动获取（无需用户手动安装）
  if (!FFMPEG) {
    FFMPEG = env.ensureFfmpeg((m) => log(m));
    if (!FFMPEG) {
      console.error('✗ ffmpeg 自动获取失败，请手动安装后重试');
      process.exit(1);
    }
  }
  if (!fs.existsSync(AUTH_FILE)) {
    console.error('✗ 缺少登录态 auth.json，请先运行: node login.cjs');
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const rec = loadRecord();
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    userAgent: UA,
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
    storageState: AUTH_FILE,
  });

  log('拉取收藏夹「' + FOLDER + '」');
  const all = await fetchList(ctx, FOLDER);
  log('列表共 ' + all.length + ' 条');

  const pending = all.filter((x) => !rec.done[x.aweme_id]);
  log('已导出 ' + (all.length - pending.length) + ' 条，待导出 ' + pending.length + ' 条');

  if (DRY) {
    pending.forEach((p, i) => console.log('  ' + (i + 1) + '. ' + p.aweme_id + '  ' + p.desc.slice(0, 50)));
    await browser.close();
    return;
  }

  const targets = LIMIT > 0 ? pending.slice(0, LIMIT) : pending;
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < targets.length; i++) {
    const item = targets[i];
    log('(' + (i + 1) + '/' + targets.length + ') ' + item.aweme_id + '  ' + item.desc.slice(0, 36));
    try {
      const r = await downloadOne(ctx, item, OUT_DIR);
      if (r.ok) {
        ok++;
        rec.done[item.aweme_id] = {
          desc: item.desc.slice(0, 100),
          file: path.basename(r.file),
          at: new Date().toISOString(),
        };
        delete rec.failed[item.aweme_id];
        log('   ✓ ' + (r.size ? (r.size / 1048576).toFixed(1) + ' MB' : 'ok'));
      } else {
        fail++;
        rec.failed[item.aweme_id] = r.reason;
        log('   ✗ ' + r.reason);
      }
    } catch (e) {
      fail++;
      rec.failed[item.aweme_id] = e.message;
      log('   ✗ ' + e.message);
    }
    saveRecord(rec);
    if (i < targets.length - 1) {
      const d = rand(4000, 12000);
      log('   限速等待 ' + (d / 1000).toFixed(1) + 's');
      await sleep(d);
    }
  }

  await browser.close();
  log('完成：成功 ' + ok + '，失败 ' + fail);
  log('输出目录：' + OUT_DIR);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
