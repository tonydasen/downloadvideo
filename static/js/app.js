let videoEntries = [];
let isFetching = false;
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
    statusText.textContent = `正在准备下载 ${indices.length} 个视频...`;
    statusText.style.color = '#667eea';

    // 使用多种方式触发下载，提高兼容性
    indices.forEach((idx, i) => {
        const item = videoEntries[idx];
        const url = item.webpage_url || item.url;
        const title = item.title || 'video';
        const downloadUrl = `/api/download-file?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;

        if (i === 0) {
            // 第一个下载：使用 form 提交（最可靠，不会被浏览器拦截）
            triggerDownloadViaForm(downloadUrl);
            statusText.textContent = `已触发第 1/${indices.length} 个视频下载: ${truncateTitle(title)}`;
        } else {
            // 后续下载：间隔 2 秒，使用 iframe
            setTimeout(() => {
                triggerDownloadViaIframe(downloadUrl);
                statusText.textContent = `已触发第 ${i+1}/${indices.length} 个视频下载: ${truncateTitle(title)}`;
            }, i * 2000);
        }
    });

    // 全部触发完成后恢复按钮状态
    setTimeout(() => {
        downloadBtn.disabled = false;
        downloadBtn.textContent = '⬇️ 下载选中的视频';
        statusText.textContent = `全部 ${indices.length} 个视频已触发下载，请查看浏览器下载栏（如被拦截请允许）`;
        statusText.style.color = '#27ae60';
    }, indices.length * 2000 + 500);
}

/**
 * 使用隐藏的 form 提交触发下载（最可靠，不会被浏览器拦截弹窗）
 */
function triggerDownloadViaForm(url) {
    // 移除旧的 form（如果有）
    const oldForm = document.getElementById('download-form');
    if (oldForm) oldForm.remove();

    const form = document.createElement('form');
    form.id = 'download-form';
    form.method = 'GET';
    form.action = url;
    form.target = '_blank';  // 在新窗口/标签页打开，浏览器会处理为下载
    form.style.display = 'none';
    document.body.appendChild(form);
    form.submit();

    // 提交后延迟移除 form
    setTimeout(() => {
        const f = document.getElementById('download-form');
        if (f) f.remove();
    }, 5000);
}

/**
 * 使用 iframe 触发下载（备用方案）
 */
function triggerDownloadViaIframe(url) {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);
    iframe.src = url;

    // 30 秒后清理 iframe
    setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 30000);
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
