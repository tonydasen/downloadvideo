import os
import re
import json
import time
import random
import html
import threading
import queue
import tempfile
import shutil
import glob
from urllib.parse import urljoin

from flask import Flask, render_template, request, jsonify, Response, send_file, after_this_request
import yt_dlp
import requests

app = Flask(__name__)

# 全局扫描更新队列（深度扫描用）
scan_update_queue = queue.Queue()

VIDEO_EXTS = ('.mp4', '.webm', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.m4v', '.3gp')


def is_valid_title(title, url=None):
    if not title:
        return False
    if title == 'Unknown Title':
        return False
    if url and title == url:
        return False
    return True


def truncate_title(title):
    if len(title) > 100:
        return title[:100] + "..."
    return title


def serialize_info(info):
    """将 yt_dlp info 转换为可 JSON 序列化的字典"""
    if isinstance(info, dict):
        result = {}
        for k, v in info.items():
            if k == 'entries':
                result[k] = [serialize_info(e) for e in v if e]
            elif isinstance(v, (str, int, float, bool, list, dict, type(None))):
                result[k] = v
            else:
                try:
                    json.dumps(v)
                    result[k] = v
                except:
                    result[k] = str(v)
        return result
    elif isinstance(info, list):
        return [serialize_info(i) for i in info]
    else:
        try:
            json.dumps(info)
            return info
        except:
            return str(info)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/fetch', methods=['POST'])
def fetch_info():
    url = request.json.get('url', '')
    if not url:
        return jsonify({'success': False, 'error': '请输入视频链接'})

    # 尝试转换 vkvideo.ru 链接
    if 'vkvideo.ru' in url:
        url = url.replace('vkvideo.ru/playlist', 'vk.com/video/playlist')
        url = url.replace('vkvideo.ru', 'vk.com/video')

    # 第一次尝试：快速获取
    ydl_opts_fast = {
        'extract_flat': 'in_playlist',
        'quiet': True,
        'ignoreerrors': True,
        'no_warnings': True,
    }

    info = None
    try:
        with yt_dlp.YoutubeDL(ydl_opts_fast) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        print(f"yt-dlp fast error: {e}")

    need_deep_scan = False
    use_manual = False

    if not info:
        use_manual = True
    elif 'entries' in info:
        entries = list(info['entries'])
        info['entries'] = entries

        unknown_count = 0
        total_count = len(entries)

        for entry in entries:
            if entry:
                title = entry.get('title')
                if not is_valid_title(title, entry.get('url')):
                    unknown_count += 1

        if total_count > 0 and (unknown_count / total_count) > 0.5:
            need_deep_scan = True

    if info:
        result = serialize_info(info)
        return jsonify({
            'success': True,
            'data': result,
            'need_deep_scan': need_deep_scan
        })
    elif use_manual:
        manual_info = manual_extract(url)
        if manual_info:
            return jsonify({
                'success': True,
                'data': manual_info,
                'need_deep_scan': False
            })
        else:
            return jsonify({
                'success': False,
                'error': '无法解析视频信息，请检查链接或网络。'
            })

    return jsonify({'success': False, 'error': '未知错误'})


def manual_extract(url):
    """当 yt-dlp 失败时，尝试手动解析页面提取标题"""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        }
        response = requests.get(url, headers=headers, timeout=15)
        response.encoding = response.apparent_encoding
        html_content = response.text

        entries = []
        seen_urls = set()

        a_tag_pattern = re.compile(r'<a\s+[^>]*?>', re.IGNORECASE)

        for tag in a_tag_pattern.findall(html_content):
            href_match = re.search(r'href=["\']\s*([^"\']+)\s*["\']', tag, re.IGNORECASE)
            title_match = re.search(r'title=["\']\s*([^"\']+)\s*["\']', tag, re.IGNORECASE)

            is_target = False
            if 'vkitVideoCardInfoLayout__titleLink' in tag:
                is_target = True
            elif href_match and '/video-' in href_match.group(1):
                is_target = True

            if is_target and href_match:
                video_url = href_match.group(1).strip()
                if not video_url.startswith('http'):
                    video_url = urljoin(url, video_url)

                if video_url in seen_urls:
                    continue

                title = "Unknown Title"
                if title_match:
                    title = html.unescape(title_match.group(1).strip())
                elif 'aria-label' in tag:
                    aria_match = re.search(r'aria-label=["\']\s*([^"\']+)\s*["\']', tag, re.IGNORECASE)
                    if aria_match:
                        title = html.unescape(aria_match.group(1).strip())

                seen_urls.add(video_url)
                entries.append({
                    'title': title,
                    'url': video_url,
                    'webpage_url': video_url
                })

        if len(entries) > 0:
            return {'entries': entries, 'title': '搜索结果列表'}

        title_search = re.search(r'<title>(.*?)</title>', html_content, re.IGNORECASE | re.DOTALL)
        page_title = html.unescape(title_search.group(1).strip()) if title_search else "未知页面标题"
        return {'title': page_title, 'url': url, 'webpage_url': url}

    except Exception as e:
        print(f"Manual extraction failed: {e}")
        return None


@app.route('/api/deep-scan', methods=['POST'])
def deep_scan():
    entries = request.json.get('entries', [])

    def scan_thread():
        total = len(entries)
        for i, entry in enumerate(entries):
            if not entry:
                continue

            current_title = entry.get('title')
            url = entry.get('url')

            if not is_valid_title(current_title, url):
                scan_update_queue.put({
                    'type': 'scan_progress',
                    'current': i + 1,
                    'total': total,
                    'message': f'正在深度解析第 {i+1}/{total} 个视频 (防封锁延迟中)...'
                })

                delay = random.uniform(2.0, 5.0)
                time.sleep(delay)

                new_title = None
                try:
                    ydl_opts = {
                        'quiet': True,
                        'ignoreerrors': True,
                        'no_warnings': True,
                    }
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                        video_info = ydl.extract_info(url, download=False)
                        if video_info and 'title' in video_info:
                            new_title = video_info['title']
                except Exception as e:
                    print(f"Error repairing title for {url}: {e}")

                scan_update_queue.put({
                    'type': 'scan_result',
                    'index': i,
                    'title': new_title or current_title or 'Unknown Title',
                    'url': url
                })
            else:
                scan_update_queue.put({
                    'type': 'scan_result',
                    'index': i,
                    'title': current_title,
                    'url': url
                })

        scan_update_queue.put({
            'type': 'scan_complete',
            'total': total
        })

    thread = threading.Thread(target=scan_thread, daemon=True)
    thread.start()

    return jsonify({'success': True, 'message': '深度扫描已启动'})


@app.route('/api/scan-progress')
def scan_progress():
    def event_stream():
        while True:
            try:
                data = scan_update_queue.get(timeout=30)
                yield f"data: {json.dumps(data)}\n\n"
                if data.get('type') == 'scan_complete':
                    break
            except queue.Empty:
                yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"

    return Response(event_stream(), mimetype='text/event-stream')


@app.route('/api/download-file')
def download_file():
    """下载单个视频到服务器临时目录，然后直接作为文件流返回给浏览器，请求结束后自动清理"""
    url = request.args.get('url')
    title = request.args.get('title', 'video')

    if not url:
        return jsonify({'success': False, 'error': '缺少视频链接'}), 400

    # 创建临时目录
    tmp_dir = tempfile.mkdtemp()

    @after_this_request
    def cleanup(response):
        """请求结束后删除临时文件和目录"""
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception as e:
            print(f"Cleanup error: {e}")
        return response

    try:
        # 使用 yt-dlp 下载到临时目录
        ydl_opts = {
            'outtmpl': os.path.join(tmp_dir, '%(title)s.%(ext)s'),
            'format': 'best',
            'quiet': True,
            'ignoreerrors': True,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            if not info:
                return jsonify({'success': False, 'error': '无法获取视频信息'}), 500

            # 找到下载的实际视频文件（过滤掉缩略图、字幕等非视频文件）
            files = [f for f in glob.glob(os.path.join(tmp_dir, '*'))
                     if os.path.splitext(f)[1].lower() in VIDEO_EXTS]

            if not files:
                # 如果没有匹配到视频扩展名，尝试取目录中最大的文件
                all_files = [f for f in glob.glob(os.path.join(tmp_dir, '*')) if os.path.isfile(f)]
                if all_files:
                    files = [max(all_files, key=os.path.getsize)]

            if not files:
                return jsonify({'success': False, 'error': '下载失败，未找到文件'}), 500

            actual_file = files[0]
            ext = os.path.splitext(actual_file)[1]
            # 清理文件名中的非法字符
            safe_title = re.sub(r'[\\/:*?"<>|]', '_', title)
            download_name = f"{safe_title}{ext}" if ext else f"{safe_title}.mp4"

            return send_file(
                actual_file,
                as_attachment=True,
                download_name=download_name
            )

    except Exception as e:
        print(f"Download error: {e}")
        return jsonify({'success': False, 'error': f'下载失败: {str(e)}'}), 500


@app.route('/api/save-list', methods=['POST'])
def save_list():
    data = request.json
    if not data or 'entries' not in data:
        return jsonify({'success': False, 'error': '没有可保存的数据'})

    try:
        return jsonify({
            'success': True,
            'data': data,
            'filename': f"list_{int(time.time())}.json"
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/load-list', methods=['POST'])
def load_list():
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': '请选择文件'})

    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': '未选择文件'})

    try:
        content = file.read().decode('utf-8')
        data = json.loads(content)
        if isinstance(data, dict) and 'entries' in data:
            return jsonify({
                'success': True,
                'data': data
            })
        else:
            return jsonify({'success': False, 'error': '文件格式不正确：缺少 entries 字段'})
    except Exception as e:
        return jsonify({'success': False, 'error': f'打开失败: {e}'})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=False, host='0.0.0.0', port=port, threaded=True)
