#!/usr/bin/env node
/**
 * 首次配置向导
 * ================================================================
 * 保存用户自己的 API Key 与素材库路径，避免每次手动改文件。
 *
 * 用法：
 *   node setup.cjs                                    交互式配置（会逐项提问）
 *   node setup.cjs --key sk-xxx --lib "D:/path"       非交互式（供 AI 调用）
 *   node setup.cjs --show                             查看当前配置
 *
 * 配置文件：~/.workbuddy-ai/douyin-data/config.json
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const env = require('./env.cjs');

const CONFIG_FILE = path.join(env.DATA_DIR, 'config.json');
const KEY_FILE = path.join(env.DATA_DIR, 'siliconflow.key');
// 默认：素材库脚本所在目录（与 material_lib.py 的默认保持一致）
const DEFAULT_LIB = path.join(__dirname, '..', '素材库', '创作素材库.xlsx');

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const flag = (name) => argv.includes('--' + name);

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(env.DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

function currentKey() {
  if (process.env.SILICONFLOW_API_KEY) return process.env.SILICONFLOW_API_KEY;
  const cfg = loadConfig();
  if (cfg.siliconflow_key) return cfg.siliconflow_key;
  if (fs.existsSync(KEY_FILE)) return fs.readFileSync(KEY_FILE, 'utf8').trim();
  return '';
}

function currentLib() {
  const cfg = loadConfig();
  if (cfg.material_lib) return cfg.material_lib;
  return DEFAULT_LIB;
}

function mask(k) {
  if (!k) return '(未配置)';
  if (k.length < 12) return k[0] + '***';
  return k.slice(0, 6) + '...' + k.slice(-4);
}

function show() {
  const key = currentKey();
  console.log('配置文件:', CONFIG_FILE);
  console.log('  API Key   :', mask(key), key ? '✓' : '✗ 未配置');
  console.log('  素材库路径 :', currentLib());
  console.log('  数据目录   :', env.DATA_DIR);
  console.log('  Chromium   :', env.CHROME || '✗ 未找到');
  console.log('  ffmpeg     :', env.FFMPEG || '✗ 未找到（首次运行会自动下载）');
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

(async () => {
  if (flag('show')) {
    show();
    return;
  }

  const cfg = loadConfig();
  const keyArg = arg('key', null);
  const libArg = arg('lib', null);

  // 非交互式（AI 调用）
  if (keyArg || libArg) {
    if (keyArg) cfg.siliconflow_key = keyArg;
    if (libArg) cfg.material_lib = libArg;
    cfg.configured_at = new Date().toISOString();
    saveConfig(cfg);
    // 同时写一份纯 key 文件，兼容旧脚本
    if (cfg.siliconflow_key) {
      fs.writeFileSync(KEY_FILE, cfg.siliconflow_key, 'utf8');
    }
    console.log('✓ 配置已保存');
    show();
    return;
  }

  // 交互式
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('=== 首次配置 ===');
  console.log('（直接回车 = 跳过该项 / 使用默认值）\n');

  const keyIn = await ask(rl, '硅基流动 API Key（sk- 开头）: ');
  if (keyIn) {
    cfg.siliconflow_key = keyIn;
    fs.writeFileSync(KEY_FILE, keyIn, 'utf8');
  }

  console.log('\n素材库保存路径');
  console.log('  默认: ' + DEFAULT_LIB);
  const libIn = await ask(rl, '自定义路径（回车用默认）: ');
  cfg.material_lib = libIn || cfg.material_lib || DEFAULT_LIB;

  cfg.configured_at = new Date().toISOString();
  saveConfig(cfg);
  rl.close();

  console.log('\n✓ 配置已保存');
  show();
})().catch((e) => {
  console.error('配置失败:', e.message);
  process.exit(1);
});
