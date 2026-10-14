#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
抖音收藏 · 视频文案（口播）提取 —— 硅基流动 API 版
================================================================
从已下载的 MP4 中抽取音频，调用硅基流动语音转文字 API，
把「视频里说过的话」转成文字，可选再用 LLM 做校对纠错，
最后汇总成一份表格。

不依赖任何本地语音模型（无需下载权重、无需 GPU）。

用法：
  python extract_text.py                     # 处理默认目录（~/Downloads/抖音收藏）全部视频
  python extract_text.py --dir D:/videos     # 指定视频目录
  python extract_text.py --limit 1           # 只处理 1 条（测试用）
  python extract_text.py --seg 30            # 每段切片秒数（默认 30）
  python extract_text.py --refine            # 额外调用硅基流动 LLM 校对（需账户余额）
  python extract_text.py --out D:/文案.xlsx  # 指定输出表格路径

API Key 读取顺序：
  1) 环境变量 SILICONFLOW_API_KEY
  2) 文件 <DOUYIN_DATA_DIR>/siliconflow.key

输出：默认在视频目录生成「口播文案_YYYYMMDD.xlsx」与同名 .csv
"""
import os
import re
import csv
import sys
import json
import time
import shutil
import argparse
import subprocess
import tempfile
from pathlib import Path

import requests

# ------------------------------------------------------------------ 环境探测
# 所有路径自动探测，可用环境变量覆盖：
#   DOUYIN_FFMPEG / DOUYIN_DATA_DIR / SILICONFLOW_API_KEY
HOME = os.path.expanduser('~')
WB_DIR = os.path.join(HOME, '.workbuddy-ai')
LOCAL_APP = os.environ.get('LOCALAPPDATA') or os.path.join(HOME, 'AppData', 'Local')
MS_PLAYWRIGHT = os.path.join(LOCAL_APP, 'ms-playwright')


def _first_existing(paths):
    for p in paths:
        if p and os.path.exists(p):
            return p
    return None


def _match_dirs(base, pattern):
    """列出 base 下匹配 pattern 的子目录，按名称倒序（取最新版本）"""
    if not os.path.isdir(base):
        return []
    import re as _re
    rx = _re.compile(pattern)
    try:
        names = os.listdir(base)
    except OSError:
        return []
    return sorted((os.path.join(base, d) for d in names if rx.match(d)), reverse=True)


def _find_file_recursive(directory, filename, depth=3):
    if depth < 0 or not os.path.isdir(directory):
        return None
    try:
        entries = os.listdir(directory)
    except OSError:
        return None
    for name in entries:
        full = os.path.join(directory, name)
        if os.path.isfile(full) and name.lower() == filename.lower():
            return full
    for name in entries:
        full = os.path.join(directory, name)
        if os.path.isdir(full):
            r = _find_file_recursive(full, filename, depth - 1)
            if r:
                return r
    return None


def find_ffmpeg():
    """按优先级探测 ffmpeg：环境变量 → 系统 PATH → playwright 自带 → WinGet → 常见位置"""
    env_path = os.environ.get('DOUYIN_FFMPEG')
    if env_path and os.path.exists(env_path):
        return env_path
    from shutil import which
    w = which('ffmpeg')
    if w:
        return w
    for d in _match_dirs(MS_PLAYWRIGHT, r'^ffmpeg-\d+$'):
        p = _first_existing([os.path.join(d, 'ffmpeg-win64.exe'),
                             os.path.join(d, 'ffmpeg.exe')])
        if p:
            return p
    winget = os.path.join(LOCAL_APP, 'Microsoft', 'WinGet', 'Packages')
    if os.path.isdir(winget):
        try:
            for name in os.listdir(winget):
                if 'ffmpeg' not in name.lower():
                    continue
                p = _find_file_recursive(os.path.join(winget, name), 'ffmpeg.exe', 4)
                if p:
                    return p
        except OSError:
            pass
    return _first_existing([
        'C:/ffmpeg/bin/ffmpeg.exe',
        'C:/Program Files/ffmpeg/bin/ffmpeg.exe',
        os.path.join(HOME, 'scoop', 'shims', 'ffmpeg.exe'),
    ])


FFMPEG = find_ffmpeg()
if FFMPEG and FFMPEG != 'ffmpeg':
    _fp = os.path.join(os.path.dirname(FFMPEG),
                       os.path.basename(FFMPEG).replace('ffmpeg', 'ffprobe'))
    FFPROBE = _fp if os.path.exists(_fp) else 'ffprobe'
else:
    FFPROBE = 'ffprobe'
DATA_DIR = os.environ.get('DOUYIN_DATA_DIR') or os.path.join(WB_DIR, 'douyin-data')
DEFAULT_DIR = os.path.join(HOME, 'Downloads', '小说素材视频')

API_URL = os.environ.get('SILICONFLOW_API_URL',
                         'https://api.siliconflow.cn/v1/audio/transcriptions')
CHAT_URL = os.environ.get('SILICONFLOW_CHAT_URL',
                          'https://api.siliconflow.cn/v1/chat/completions')
MODEL = os.environ.get('SILICONFLOW_ASR_MODEL', 'FunAudioLLM/SenseVoiceSmall')
REFINE_MODEL = os.environ.get('SILICONFLOW_REFINE_MODEL', 'deepseek-ai/DeepSeek-V3')
KEY_FILE = os.path.join(DATA_DIR, 'siliconflow.key')
CONFIG_FILE = os.path.join(DATA_DIR, 'config.json')

REFINE_SYS = '你是专业的中文文本校对员，负责修正语音识别结果中的错误。'
REFINE_PROMPT = """下面是一段抖音视频的语音识别原文，存在同音字错误、专有名词错误、标点缺失、语句被切断等问题。

视频标题（含话题标签）是：{title}

请完成：
1. 纠正同音字、错别字
2. 依据标题与上下文纠正专有名词（人名、地名、游戏/动漫术语）
3. 补全并规范标点符号，按语义合理分段
4. 修复因分段造成的断句错误，使语句连贯
5. 删除明显的乱码或非中文噪声片段
6. 保持原意与口语风格，不增删实质内容，不添加解释

原文：
{text}

只输出校对后的文本。"""


def log(*a):
    print('[' + time.strftime('%H:%M:%S') + ']', *a, flush=True)


def get_key():
    """API Key 读取顺序：环境变量 → config.json → siliconflow.key 文件"""
    k = os.environ.get('SILICONFLOW_API_KEY', '').strip()
    if k:
        return k
    try:
        cfg = json.load(open(CONFIG_FILE, encoding='utf-8'))
        if cfg.get('siliconflow_key'):
            return str(cfg['siliconflow_key']).strip()
    except Exception:
        pass
    if os.path.exists(KEY_FILE):
        return open(KEY_FILE, encoding='utf-8').read().strip()
    return ''


def run(cmd, timeout=1800):
    return subprocess.run(cmd, capture_output=True, text=True,
                          encoding='utf-8', errors='replace', timeout=timeout)


def dur_sec(path):
    r = run([FFPROBE, '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'default=noprint_wrappers=1:nokey=1', path])
    try:
        return float(r.stdout.strip())
    except Exception:
        return 0.0


def fmt_ts(sec):
    m, s = divmod(int(sec), 60)
    return f'{m:02d}:{s:02d}'


# SenseVoice 会输出 emoji 标注（🎼 表示背景音乐、😊 表示情感等），需清除
_EMOJI = re.compile(
    '[\U0001F000-\U0001FAFF'      # 各类 emoji / 象形符号
    '\U00002600-\U000027BF'       # 杂项符号、装饰符号
    '\U0001F1E6-\U0001F1FF'       # 区域指示符（国旗）
    '\uFE0F\u200d\u20e3'          # 变体选择符、零宽连接符、组合键帽
    ']'
)


def clean_text(t):
    """去掉 SenseVoice 返回的特殊标记与 emoji 标注，并规整标点空白。"""
    t = re.sub(r'<\|[^|]*\|>', '', t or '')
    t = _EMOJI.sub('', t)
    t = re.sub(r'[ \t\u3000]+', ' ', t)
    t = re.sub(r'\s+([，。！？；：、])', r'\1', t)
    t = re.sub(r'([，。！？；：、])\1+', r'\1', t)
    return t.strip()


def extract_audio(video, out_dir, seg_sec):
    """抽音频并按 seg_sec 秒切片，返回 [(起始秒, 文件路径), ...]。"""
    os.makedirs(out_dir, exist_ok=True)
    pattern = os.path.join(out_dir, 'chunk_%04d.mp3')
    run([FFMPEG, '-y', '-loglevel', 'error', '-i', video,
         '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k',
         '-f', 'segment', '-segment_time', str(seg_sec),
         '-reset_timestamps', '1', pattern])
    files = sorted(Path(out_dir).glob('chunk_*.mp3'))
    return [(i * seg_sec, str(f)) for i, f in enumerate(files)]


def transcribe_file(path, key, retries=3):
    last = None
    for i in range(retries):
        try:
            with open(path, 'rb') as fh:
                r = requests.post(
                    API_URL,
                    headers={'Authorization': 'Bearer ' + key},
                    files={'file': (os.path.basename(path), fh, 'audio/mpeg')},
                    data={'model': MODEL},
                    timeout=300,
                )
            if r.status_code == 200:
                return clean_text(r.json().get('text', ''))
            last = f'HTTP {r.status_code}: {r.text[:200]}'
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(3 * (i + 1))
                continue
            raise RuntimeError(last)
        except requests.RequestException as e:
            last = str(e)[:200]
            time.sleep(3 * (i + 1))
    raise RuntimeError(last or '未知错误')


def refine_text(text, title, key, retries=2):
    """用 LLM 对 ASR 原文做纠错、补标点、修复断句。失败则返回空串。"""
    if not text.strip():
        return ''
    prompt = REFINE_PROMPT.format(title=title, text=text)
    for i in range(retries):
        try:
            r = requests.post(
                CHAT_URL,
                headers={'Authorization': 'Bearer ' + key,
                         'Content-Type': 'application/json'},
                json={'model': REFINE_MODEL,
                      'messages': [{'role': 'system', 'content': REFINE_SYS},
                                   {'role': 'user', 'content': prompt}],
                      'temperature': 0.2, 'max_tokens': 4096},
                timeout=300,
            )
            if r.status_code == 200:
                return r.json()['choices'][0]['message']['content'].strip()
            log(f'   校对失败 HTTP {r.status_code}: {r.text[:150]}')
            time.sleep(3 * (i + 1))
        except (requests.RequestException, KeyError) as e:
            log(f'   校对异常: {str(e)[:150]}')
            time.sleep(3 * (i + 1))
    return ''


def parse_title(name, desc_map):
    stem = os.path.splitext(name)[0]
    m = re.match(r'^(\d{15,25})_(.*)$', stem)
    if m:
        aid, title = m.group(1), m.group(2)
    else:
        aid, title = '', stem
    if aid in desc_map:
        title = desc_map[aid]
    return aid, title


COLS = ['序号', '视频ID', '标题', '时长(秒)', '文案(校对后)',
        '文案(原始识别)', '分段(带时间戳)', '视频文件']


def write_table(rows, out_path):
    csv_path = os.path.splitext(out_path)[0] + '.csv'
    with open(csv_path, 'w', newline='', encoding='utf-8-sig') as fh:
        w = csv.writer(fh)
        w.writerow(COLS)
        for r in rows:
            w.writerow([r.get(c, '') for c in COLS])
    log('已写入 CSV: ' + csv_path)

    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, Alignment, PatternFill
        wb = Workbook()
        ws = wb.active
        ws.title = '口播文案'
        ws.append(COLS)
        fill = PatternFill('solid', fgColor='DDEBF7')
        for c in ws[1]:
            c.font = Font(bold=True)
            c.fill = fill
            c.alignment = Alignment(horizontal='center', vertical='center')
        for r in rows:
            ws.append([r.get(c, '') for c in COLS])
        for col, wd in zip('ABCDEFGH', [6, 22, 34, 9, 70, 70, 70, 34]):
            ws.column_dimensions[col].width = wd
        for row in ws.iter_rows(min_row=2):
            for c in row:
                c.alignment = Alignment(wrap_text=True, vertical='top')
        xlsx_path = os.path.splitext(out_path)[0] + '.xlsx'
        wb.save(xlsx_path)
        log('已写入 XLSX: ' + xlsx_path)
        return xlsx_path
    except ImportError:
        log('（未装 openpyxl，仅输出 CSV）')
        return csv_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default=DEFAULT_DIR)
    ap.add_argument('--out', default=None)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--only', default=None,
                    help='只处理指定视频ID（多个用逗号分隔），用于增量提取')
    ap.add_argument('--keep-video', action='store_true',
                    help='保留视频文件（默认：成功提取文案后自动删除视频，只留文案）')
    ap.add_argument('--keep-table', action='store_true',
                    help='把文案表输出到视频目录并保留（默认：输出到系统临时目录，用完即弃）')
    ap.add_argument('--seg', type=int, default=30, help='切片秒数，默认 30')
    ap.add_argument('--refine', action='store_true',
                    help='额外调用硅基流动 LLM 校对（需账户余额；默认关闭，'
                         '改由 AI 助手在对话中完成校对）')
    ap.add_argument('--keep-temp', action='store_true')
    args = ap.parse_args()

    key = get_key()
    if not key:
        log('✗ 未找到 API Key。请设置环境变量 SILICONFLOW_API_KEY，'
            f'或写入文件 {KEY_FILE}')
        sys.exit(1)

    vdir = Path(args.dir)
    videos = sorted(vdir.glob('*.mp4'))
    if args.only:
        ids = [x.strip() for x in args.only.split(',') if x.strip()]
        videos = [v for v in videos if any(i in v.name for i in ids)]
    if args.limit > 0:
        videos = videos[:args.limit]
    if not videos:
        log('未找到视频: ' + str(vdir))
        return

    desc_map = {}
    try:
        rec = json.load(open(os.path.join(DATA_DIR, 'downloaded.json'), encoding='utf-8'))
        desc_map = {k: v.get('desc', '') for k, v in rec.get('done', {}).items()}
    except Exception:
        pass

    do_refine = args.refine
    log(f'待处理 {len(videos)} 条 | ASR {MODEL} | 切片 {args.seg}s | '
        f'校对 {"开(" + REFINE_MODEL + ")" if do_refine else "关"}')

    tmp_root = Path(tempfile.mkdtemp(prefix='douyin_asr_'))
    rows = []
    t_all = time.time()
    total_chunks = 0

    for idx, v in enumerate(videos, start=1):
        log(f'({idx}/{len(videos)}) {v.name[:60]}')
        aid, title = parse_title(v.name, desc_map)
        total = dur_sec(str(v))
        row = {'序号': idx, '视频ID': aid, '标题': title,
               '时长(秒)': round(total, 1), '视频文件': v.name,
               '文案(校对后)': '', '文案(原始识别)': '', '分段(带时间戳)': ''}

        adir = tmp_root / f'a{idx}'
        chunks = extract_audio(str(v), str(adir), args.seg)
        if not chunks:
            log('   ✗ 抽音频失败')
            rows.append(row)
            continue

        texts = []
        t0 = time.time()
        for start, cpath in chunks:
            try:
                txt = transcribe_file(cpath, key)
                if txt:
                    texts.append((start, txt))
            except Exception as e:
                log(f'   片 {fmt_ts(start)} 失败: {str(e)[:120]}')
                texts.append((start, ''))
            time.sleep(0.4)

        total_chunks += len(chunks)
        raw = ''.join(t for _, t in texts)
        row['文案(原始识别)'] = raw
        row['分段(带时间戳)'] = '\n'.join(
            f'[{fmt_ts(s)}] {t}' for s, t in texts if t)
        log(f'   ASR: {len(chunks)} 片 → {len(raw)} 字, {time.time()-t0:.1f}s')

        if do_refine:
            t1 = time.time()
            refined = refine_text(raw, title, key)
            row['文案(校对后)'] = refined or raw
            log(f'   校对: {len(refined)} 字, {time.time()-t1:.1f}s'
                + ('' if refined else ' (失败，保留原文)'))

        if not args.keep_temp:
            shutil.rmtree(adir, ignore_errors=True)

        # 默认只留文案：成功提取后删除视频文件（提取失败则保留，便于排查）
        if not args.keep_video and row['文案(原始识别)']:
            try:
                os.remove(str(v))
                log('   已删除视频（只留文案）')
            except OSError as e:
                log('   删除视频失败: ' + str(e)[:80])

        rows.append(row)

    if not args.keep_temp:
        shutil.rmtree(tmp_root, ignore_errors=True)

    if args.out:
        out = args.out
    elif args.keep_table:
        out = str(vdir / f'口播文案_{time.strftime("%Y%m%d")}.xlsx')
    else:
        # 默认写到系统临时目录：文案只是提炼素材的中间产物，用完即弃
        out = os.path.join(tempfile.gettempdir(),
                           f'douyin_asr_{time.strftime("%Y%m%d_%H%M%S")}.xlsx')
    write_table(rows, out)
    log(f'全部完成：{len(rows)} 条视频 / {total_chunks} 个音频片，'
        f'耗时 {time.time()-t_all:.1f}s')


if __name__ == '__main__':
    main()
