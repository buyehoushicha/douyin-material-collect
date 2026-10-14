#!/usr/bin/env node
/**
 * 抖音登录（扫码/验证码），保存登录态供 export.cjs 使用。
 * 有头浏览器打开，由用户手动完成登录，脚本轮询检测 sessionid。
 *
 * 用法：node login.cjs
 */

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const env = require('./env.cjs');

const CHROME = env.CHROME;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DATA_DIR = env.DATA_DIR;
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const WAIT_MIN = 8;

(async () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!CHROME) {
    console.error('✗ 未找到 Chromium，请确认已安装 playwright 浏览器');
    process.exit(1);
  }

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
  });
  const ctx = await browser.newContext({ userAgent: UA, locale: 'zh-CN', viewport: null });
  const page = await ctx.newPage();

  console.log('==============================================');
  console.log(' 浏览器已打开，请在这个窗口里完成登录：');
  console.log('   1) 点右上角「登录」');
  console.log('   2) 用抖音 App 扫码（或手机号验证码）');
  console.log(' 登录成功后脚本会自动保存登录态并关闭窗口。');
  console.log(' 最长等待 ' + WAIT_MIN + ' 分钟。');
  console.log('==============================================');

  try {
    await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    console.log('首页加载异常（可忽略）:', e.message);
  }

  const deadline = Date.now() + WAIT_MIN * 60 * 1000;
  let logged = false;

  while (Date.now() < deadline) {
    let cookies = [];
    try {
      cookies = await ctx.cookies();
    } catch (e) {
      break;
    }
    if (cookies.some((c) => c.name === 'sessionid' && c.value)) {
      logged = true;
      break;
    }
    await page.waitForTimeout(2000);
  }

  if (logged) {
    await page.waitForTimeout(3000);
    await ctx.storageState({ path: AUTH_FILE });
    const cookies = await ctx.cookies();
    const names = cookies
      .filter((c) => /sessionid|uid_tt|sid_tt|passport|odin_tt/i.test(c.name))
      .map((c) => c.name);
    console.log('✅ 登录成功！');
    console.log('   登录态文件:', AUTH_FILE);
    console.log('   关键 cookie:', names.join(', ') || '(未匹配到已知名称)');
  } else {
    console.log('❌ 未检测到登录（超时或窗口被关闭）');
    process.exitCode = 1;
  }

  await browser.close();
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
