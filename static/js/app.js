let videoEntries = [];
let isFetching = false;
let isScanning = false;

function fetchInfo() {
    if (isFetching) return;

    const urlInput = document.getElementById('url');
    const url = urlInput ? urlInput.value.trim() : '';
    if (!url) {
        alert('请输入视频链接');
        return;
    }

    isFetching = true;
    document.getElementById('fetchBtn').disabled = true;
    document.getElementById('statusText').textContent = '正在获取视频信息，请稍候...';
    document.getElementById('statusText').style.color = '';
    document.getElementById('videoList').innerHTML = `
        <tr class="empty-row">
            <td colspan="3" style="text-align: center; color: #999; padding: 40px;">
                正在获取视频列表...
            </td>
        </tr>
    `;
    document.getElementById('downloadBtn').disabled = true;
    document.getElementById('deepScanBtn').style.display = 'none';
    document.getElementById('listCount').textContent = '0';
    videoEntries = [];

    fetch('/api/fetch', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({url: url})
    })
    .then(r => r.json())
    .then(data => {
        isFetching = false;
        document.getElementById('fetchBtn').disabled = false;

        if (!data.success) {
            document.getElementById('videoList').innerHTML = `
                <tr class="empty-row">
                    <td colspan="3" style="text-align: center; color: #e74c3c; padding: 40px;">
                        ${escapeHtml(data.error || '获取失败')}
                    </td>
                </tr>
            `;
            document.getElementById('statusText').textContent = data.error || '获取失败';
            return;
        }

        updateListUI(data.data);
        document.getElementById('statusText').textContent = '获取成功，请选择要下载的视频';

        if (data.need_deep_scan) {
            document.getElementById('deepScanBtn').style.display = 'inline-block';
            document.getElementById('statusText').textContent += ' (检测到缺失标题，建议点击"修复标题")';
        }
    })
    .catch(err => {
        isFetching = false;
        document.getElementById('fetchBtn').disabled = false;
        document.getElementById('videoList').innerHTML = `
            <tr class="empty-row">
                <td colspan="3" style="text-align: center; color: #e74c3c; padding: 40px;">
                    请求失败: ${escapeHtml(err.message)}
                </td>
            </tr>
        `;
        document.getElementById('statusText').textContent = '请求失败: ' + err.message;
    });
}

function updateListUI(info) {
    videoEntries = [];
    const tbody = document.getElementById('videoList');
    tbody.innerHTML = '';

    if (info.entries && info.entries.length > 0) {
        info.entries.forEach((entry, idx) => {
            if (!entry) return;
            videoEntries.push(entry);
            const title = entry.title || 'Unknown Title';
            const url = entry.webpage_url || entry.url || '';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input type="checkbox" class="video-check" data-index="${idx}" checked></td>
                <td class="title-cell" id="title-${idx}">${escapeHtml(truncateTitle(title))}</td>
                <td class="url-cell"><a href="${escapeHtml(url)}" target="_blank">${escapeHtml(truncateUrl(url))}</a></td>
            `;
            tbody.appendChild(tr);
        });
    } else if (info.title) {
        videoEntries.push(info);
        const title = info.title || 'Unknown Title';
        const url = info.webpage_url || info.url || '';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="checkbox" class="video-check" data-index="0" checked></td>
            <td class="title-cell">${escapeHtml(truncateTitle(title))}</td>
            <td class="url-cell"><a href="${escapeHtml(url)}" target="_blank">${escapeHtml(truncateUrl(url))}</a></td>
        `;
        tbody.appendChild(tr);
    } else {
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="3" style="text-align: center; color: #999; padding: 40px;">
                    未找到视频
                </td>
            </tr>
        `;
    }

    document.getElementById('listCount').textContent = videoEntries.length;
    document.getElementById('downloadBtn').disabled = videoEntries.length === 0;
    document.getElementById('selectAll').checked = true;
}

function startDeepScan() {
    if (isScanning) return;
    isScanning = true;
    document.getElementById('deepScanBtn').disabled = true;
    document.getElementById('deepScanBtn').textContent = '🔧 修复中...';
    document.getElementById('statusText').textContent = '正在启动深度扫描...';

    fetch('/api/deep-scan', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({entries: videoEntries})
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            listenScanProgress();
        } else {
            isScanning = false;
            document.getElementById('deepScanBtn').disabled = false;
            document.getElementById('deepScanBtn').textContent = '🔧 修复标题';
            alert(data.error);
        }
    })
    .catch(err => {
        isScanning = false;
        document.getElementById('deepScanBtn').disabled = false;
        document.getElementById('deepScanBtn').textContent = '🔧 修复标题';
        alert('启动失败: ' + err.message);
    });
}

function listenScanProgress() {
    const evtSource = new EventSource('/api/scan-progress');

    evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'heartbeat') return;

        if (data.type === 'scan_progress') {
            document.getElementById('statusText').textContent = data.message;
        } else if (data.type === 'scan_result') {
            if (data.index < videoEntries.length) {
                videoEntries[data.index].title = data.title;
                const cell = document.getElementById(`title-${data.index}`);
                if (cell) {
                    cell.textContent = truncateTitle(data.title);
                    cell.style.background = '#fff3cd';
                    setTimeout(() => {
                        cell.style.background = '';
                        cell.style.transition = 'background 0.5s';
                    }, 500);
                }
            }
        } else if (data.type === 'scan_complete') {
            evtSource.close();
            isScanning = false;
            document.getElementById('deepScanBtn').disabled = false;
            document.getElementById('deepScanBtn').textContent = '🔧 修复标题';
            document.getElementById('deepScanBtn').style.display = 'none';
            document.getElementById('statusText').textContent = `解析完成，共 ${data.total} 个视频`;
        }
    };

    evtSource.onerror = () => {
        evtSource.close();
        isScanning = false;
        document.getElementById('deepScanBtn').disabled = false;
        document.getElementById('deepScanBtn').textContent = '🔧 修复标题';
    };
}

function startDownload() {
    const checks = document.querySelectorAll('.video-check:checked');
    const indices = Array.from(checks).map(c => parseInt(c.dataset.index));

    if (indices.length === 0) {
        alert('请先选择要下载的视频');
        return;
    }

    const statusText = document.getElementById('statusText');
    const downloadBtn = document.getElementById('downloadBtn');

    downloadBtn.disabled = true;
    downloadBtn.textContent = '⬇️ 下载中...';
    statusText.textContent = `正在准备下载 ${indices.length} 个视频，请稍候...`;
    statusText.style.color = '#667eea';

    // 逐个触发下载，间隔 2 秒
    indices.forEach((idx, i) => {
        const item = videoEntries[idx];
        const url = item.webpage_url || item.url;
        const title = item.title || 'video';
        const downloadUrl = `/api/download-file?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;

        setTimeout(() => {
            statusText.textContent = `正在下载第 ${i+1}/${indices.length} 个: ${truncateTitle(title)}...`;

            // 使用 fetch 先检查是否成功，再触发下载
            fetch(downloadUrl)
                .then(response => {
                    if (!response.ok) {
                        return response.json().then(errData => {
                            throw new Error(errData.error || `HTTP ${response.status}`);
                        }).catch(() => {
                            throw new Error(`下载失败: HTTP ${response.status}`);
                        });
                    }
                    // 成功，获取 blob 并触发下载
                    return response.blob();
                })
                .then(blob => {
                    const blobUrl = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = blobUrl;
                    // 从响应头获取文件名，或构造一个
                    const ext = '.mp4';
                    const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_');
                    a.download = `${safeTitle}${ext}`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(blobUrl);

                    statusText.textContent = `第 ${i+1}/${indices.length} 个下载完成: ${truncateTitle(title)}`;
                })
                .catch(err => {
                    console.error('Download error:', err);
                    statusText.textContent = `第 ${i+1} 个下载失败: ${err.message}`;
                    statusText.style.color = '#e74c3c';
                });

        }, i * 2500);
    });

    // 全部完成后恢复按钮
    setTimeout(() => {
        downloadBtn.disabled = false;
        downloadBtn.textContent = '⬇️ 下载选中的视频';
        statusText.textContent = `全部 ${indices.length} 个视频处理完毕，请查看浏览器下载栏`;
        statusText.style.color = '#27ae60';
    }, indices.length * 2500 + 1000);
}

function toggleSelectAll() {
    const checked = document.getElementById('selectAll').checked;
    document.querySelectorAll('.video-check').forEach(c => c.checked = checked);
}

function saveList() {
    if (videoEntries.length === 0) {
        alert('当前没有可保存的列表');
        return;
    }

    const urlInput = document.getElementById('url');
    const data = {
        source_url: urlInput ? urlInput.value : '',
        entries: videoEntries
    };

    fetch('/api/save-list', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    })
    .then(r => r.json())
    .then(res => {
        if (res.success) {
            const blob = new Blob([JSON.stringify(res.data, null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = res.filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } else {
            alert(res.error);
        }
    })
    .catch(err => {
        alert('保存失败: ' + err.message);
    });
}

function loadList() {
    const fileInput = document.getElementById('loadFile');
    const file = fileInput.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    fetch('/api/load-list', {
        method: 'POST',
        body: formData
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            if (data.data.source_url) {
                const urlInput = document.getElementById('url');
                if (urlInput) urlInput.value = data.data.source_url;
            }
            updateListUI(data.data);
            document.getElementById('statusText').textContent = '已从本地文件载入列表';
        } else {
            alert(data.error);
        }
    })
    .catch(err => {
        alert('加载失败: ' + err.message);
    });

    fileInput.value = '';
}

function truncateTitle(title) {
    if (title && title.length > 100) {
        return title.substring(0, 100) + '...';
    }
    return title || '';
}

function truncateUrl(url) {
    if (url && url.length > 50) {
        return url.substring(0, 50) + '...';
    }
    return url || '';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 监听复选框变化，更新全选状态
document.addEventListener('change', function(e) {
    if (e.target.classList.contains('video-check')) {
        const allChecks = document.querySelectorAll('.video-check');
        const checkedChecks = document.querySelectorAll('.video-check:checked');
        document.getElementById('selectAll').checked = allChecks.length === checkedChecks.length;
    }
});
