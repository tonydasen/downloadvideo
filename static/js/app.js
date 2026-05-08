let videoEntries = [];
let isFetching = false;
let isDownloading = false;
let isScanning = false;

function fetchInfo() {
    if (isFetching) return;

    const url = document.getElementById('url').value.trim();
    if (!url) {
        alert('请输入视频链接');
        return;
    }

    isFetching = true;
    document.getElementById('fetchBtn').disabled = true;
    document.getElementById('statusText').textContent = '正在获取视频信息，请稍候...';
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
                    // 添加高亮效果
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
    if (isDownloading) return;

    const checks = document.querySelectorAll('.video-check:checked');
    const indices = Array.from(checks).map(c => parseInt(c.dataset.index));

    if (indices.length === 0) {
        alert('请先选择要下载的视频');
        return;
    }

    const saveDir = document.getElementById('saveDir').value.trim();
    if (!saveDir) {
        alert('请输入保存目录');
        return;
    }

    const items = indices.map(i => videoEntries[i]);

    isDownloading = true;
    document.getElementById('downloadBtn').disabled = true;
    document.getElementById('downloadBtn').textContent = '⬇️ 下载中...';
    document.getElementById('statusText').textContent = '准备下载...';
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('progressPercent').textContent = '0%';

    fetch('/api/download', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({items: items, save_dir: saveDir})
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            listenProgress();
        } else {
            isDownloading = false;
            document.getElementById('downloadBtn').disabled = false;
            document.getElementById('downloadBtn').textContent = '⬇️ 下载选中的视频';
            alert(data.error);
            document.getElementById('statusText').textContent = data.error;
        }
    })
    .catch(err => {
        isDownloading = false;
        document.getElementById('downloadBtn').disabled = false;
        document.getElementById('downloadBtn').textContent = '⬇️ 下载选中的视频';
        alert('启动失败: ' + err.message);
    });
}

function listenProgress() {
    const evtSource = new EventSource('/api/progress');

    evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.status === 'heartbeat') return;

        if (data.status === 'item_start' || data.status === 'downloading') {
            document.getElementById('statusText').textContent = data.message;
            const percentStr = (data.percent_str || '0%').replace('%', '');
            const percent = parseFloat(percentStr) || 0;
            document.getElementById('progressFill').style.width = percent + '%';
            document.getElementById('progressPercent').textContent = Math.round(percent) + '%';
        } else if (data.status === 'finished') {
            document.getElementById('progressFill').style.width = '100%';
            document.getElementById('progressPercent').textContent = '100%';
            document.getElementById('statusText').textContent = data.message;
        } else if (data.status === 'error') {
            document.getElementById('statusText').textContent = data.message;
            document.getElementById('statusText').style.color = '#e74c3c';
        } else if (data.status === 'complete') {
            evtSource.close();
            isDownloading = false;
            document.getElementById('downloadBtn').disabled = false;
            document.getElementById('downloadBtn').textContent = '⬇️ 下载选中的视频';
            document.getElementById('progressFill').style.width = '100%';
            document.getElementById('progressPercent').textContent = '100%';
            document.getElementById('statusText').textContent = data.message;
            document.getElementById('statusText').style.color = '#27ae60';

            setTimeout(() => {
                alert(`任务结束\n成功: ${data.success_count}\n总计: ${data.total}`);
                document.getElementById('statusText').style.color = '';
                document.getElementById('progressFill').style.width = '0%';
                document.getElementById('progressPercent').textContent = '0%';
            }, 500);
        }
    };

    evtSource.onerror = () => {
        evtSource.close();
        isDownloading = false;
        document.getElementById('downloadBtn').disabled = false;
        document.getElementById('downloadBtn').textContent = '⬇️ 下载选中的视频';
    };
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

    const data = {
        source_url: document.getElementById('url').value,
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
                document.getElementById('url').value = data.data.source_url;
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
