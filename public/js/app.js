/* ============================================
   全局变量 & 工具函数
   ============================================ */
let currentUser = null;
let currentToken = null;
let currentConvId = null;
let allKbList = [];
let isSending = false;

const API = {
    post: (url, body, token) => fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
    }).then(r => r.json()),
    get: (url, token) => fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(r => r.json()),
    delete: (url, token) => fetch(url, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(r => r.json()),
    patch: (url, body, token) => fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
    }).then(r => r.json()),
};

function $(id) { return document.getElementById(id); }
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
function showError(id, msg) { const el = $(id); el.textContent = msg; el.classList.remove('hidden'); }
function hideError(id) { $(id).classList.add('hidden'); }

function formatTime(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
function formatDate(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 86400000 && d.getDate() === now.getDate()) return '今天';
    if (diff < 172800000) return '昨天';
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
    return d.toLocaleDateString('zh-CN');
}

/* ============================================
   初始化
   ============================================ */
window.addEventListener('DOMContentLoaded', () => {
    $('welcome-time').textContent = formatTime(new Date());
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (savedToken && savedUser) {
        currentToken = savedToken;
        currentUser = JSON.parse(savedUser);
        enterMainPage();
    }
});

/* ============================================
   登录 / 注册
   ============================================ */
function switchAuthTab(tab) {
    if (tab === 'login') {
        $('tab-login').classList.add('active');
        $('tab-register').classList.remove('active');
        show('form-login');
        hide('form-register');
    } else {
        $('tab-register').classList.add('active');
        $('tab-login').classList.remove('active');
        hide('form-login');
        show('form-register');
    }
    hideError('auth-error');
}

async function handleLogin(e) {
    e.preventDefault();
    hideError('auth-error');
    const username = $('login-username').value.trim();
    const password = $('login-password').value;
    $('btn-login').textContent = '登录中...';
    $('btn-login').disabled = true;
    try {
        const res = await API.post('/api/auth/login', { username, password });
        if (res.error) { showError('auth-error', res.error); return; }
        currentToken = res.token;
        currentUser = res.user;
        localStorage.setItem('token', currentToken);
        localStorage.setItem('user', JSON.stringify(currentUser));
        enterMainPage();
    } catch (err) {
        showError('auth-error', '网络错误，请检查服务是否启动');
    } finally {
        $('btn-login').textContent = '立即登录 →';
        $('btn-login').disabled = false;
    }
}

async function handleRegister(e) {
    e.preventDefault();
    hideError('auth-error');
    const username = $('reg-username').value.trim();
    const password = $('reg-password').value;
    const password2 = $('reg-password2').value;
    if (password !== password2) { showError('auth-error', '两次密码输入不一致'); return; }
    $('btn-register').textContent = '注册中...';
    $('btn-register').disabled = true;
    try {
        const res = await API.post('/api/auth/register', { username, password });
        if (res.error) { showError('auth-error', res.error); return; }
        currentToken = res.token;
        currentUser = res.user;
        localStorage.setItem('token', currentToken);
        localStorage.setItem('user', JSON.stringify(currentUser));
        enterMainPage();
    } catch (err) {
        showError('auth-error', '网络错误，请检查服务是否启动');
    } finally {
        $('btn-register').textContent = '立即注册 →';
        $('btn-register').disabled = false;
    }
}

function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    currentToken = null;
    currentUser = null;
    currentConvId = null;
    hide('page-main');
    show('page-auth');
}

/* ============================================
   进入主平台
   ============================================ */
function enterMainPage() {
    hide('page-auth');
    show('page-main');

    // 设置头像和用户名
    const uname = currentUser.username;
    const initial = uname.charAt(0).toUpperCase();
    $('header-username').textContent = uname;
    $('header-avatar').textContent = initial;
    $('chat-avatar').textContent = initial;
    $('admin-user-avatar').textContent = initial;

    // 管理员显示后台入口
    if (currentUser.role !== 'admin') {
        $('tab-admin').style.display = 'none';
    } else {
        $('tab-admin').style.display = '';
    }

    // 默认显示用户端
    switchMainTab('user');
}

/* ============================================
   主 Tab 切换
   ============================================ */
function switchMainTab(tab) {
    $('tab-user').classList.toggle('active', tab === 'user');
    $('tab-admin').classList.toggle('active', tab === 'admin');
    if (tab === 'user') {
        show('panel-user');
        hide('panel-admin');
        loadConversations();
        loadKbInfoForUser();
    } else {
        hide('panel-user');
        show('panel-admin');
        showAdminPane('kb');
        loadKbList();
    }
}

/* ============================================
   用户端 - 对话列表
   ============================================ */
async function loadConversations() {
    const res = await API.get('/api/conversations', currentToken);
    const list = res.conversations || [];
    const container = $('conv-list');
    container.innerHTML = '';

    if (list.length === 0) {
        container.innerHTML = '<div class="no-history">暂无历史对话</div>';
        // 自动创建第一个会话
        await createNewConversation();
        return;
    }

    list.forEach(conv => {
        const div = document.createElement('div');
        div.className = 'conv-item' + (conv.id === currentConvId ? ' active' : '');
        div.dataset.id = conv.id;
        div.innerHTML = `
      <div class="conv-item-title">${escHtml(conv.title)}</div>
      <div class="conv-item-time">${formatDate(conv.updated_at)}</div>
    `;
        div.onclick = () => openConversation(conv.id, conv.title);
        container.appendChild(div);
    });

    // 如果没有当前对话，打开最新的
    if (!currentConvId && list.length > 0) {
        openConversation(list[0].id, list[0].title);
    }
}

async function createNewConversation() {
    const res = await API.post('/api/conversations', { title: '新对话' }, currentToken);
    if (res.conversation) {
        currentConvId = res.conversation.id;
        $('chat-conv-title').textContent = res.conversation.title;
        clearChatMessages();
        await loadConversations();
        showChatPane();
        setActiveConv(currentConvId);
    }
}

async function openConversation(id, title) {
    currentConvId = id;
    $('chat-conv-title').textContent = title;
    clearChatMessages();
    showChatPane();
    setActiveConv(id);

    const res = await API.get(`/api/conversations/${id}/messages`, currentToken);
    const msgs = res.messages || [];
    if (msgs.length === 0) {
        // 显示欢迎消息
        return;
    }
    clearChatMessages(true); // 清除欢迎消息
    msgs.forEach(m => appendMessage(m.role, m.content, m.created_at));
    scrollToBottom();
}

function setActiveConv(id) {
    document.querySelectorAll('.conv-item').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.id) === id);
    });
}

/* ============================================
   用户端 - 面板切换
   ============================================ */
function showChatPane() {
    show('chat-pane');
    hide('history-pane');
    hide('kb-info-pane');
    document.querySelectorAll('.nav-item').forEach((el, i) => el.classList.toggle('active', i === 0));
}

function showHistoryPane() {
    hide('chat-pane');
    show('history-pane');
    hide('kb-info-pane');
    document.querySelectorAll('.nav-item').forEach((el, i) => el.classList.toggle('active', i === 1));
    loadHistoryPane();
}

function showKbInfoPane() {
    hide('chat-pane');
    hide('history-pane');
    show('kb-info-pane');
    document.querySelectorAll('.nav-item').forEach((el, i) => el.classList.toggle('active', i === 2));
}

async function loadHistoryPane() {
    const res = await API.get('/api/conversations', currentToken);
    const list = res.conversations || [];
    const container = $('history-list');
    if (list.length === 0) {
        container.innerHTML = '<p class="no-history">暂无历史记录</p>';
        return;
    }
    container.innerHTML = list.map(c => `
    <div class="history-item" onclick="openConversation(${c.id}, '${escHtml(c.title)}'); showChatPane()">
      <div class="history-item-icon">💬</div>
      <div class="history-item-info">
        <div class="history-item-title">${escHtml(c.title)}</div>
        <div class="history-item-date">${formatDate(c.updated_at)}</div>
      </div>
    </div>
  `).join('');
}

async function loadKbInfoForUser() {
    const res = await API.get('/api/kb', currentToken);
    const kbs = res.knowledge_bases || [];
    const container = $('kb-info-list');
    if (kbs.length === 0) {
        container.innerHTML = '<p style="color:#888">暂无知识库，请联系管理员添加。</p>';
        return;
    }
    container.innerHTML = kbs.map(kb => `
    <div class="kb-info-card">
      <div class="kb-info-icon">📚</div>
      <div>
        <div class="kb-info-name">${escHtml(kb.name)}</div>
        <div class="kb-info-desc">${escHtml(kb.description || '暂无描述')}</div>
        <div class="kb-info-meta">${kb.doc_count || 0} 个文档</div>
      </div>
    </div>
  `).join('');
}

/* ============================================
   用户端 - 聊天
   ============================================ */
function clearChatMessages(full = false) {
    const container = $('chat-messages');
    if (full) {
        container.innerHTML = '';
    } else {
        // 保留欢迎消息
        const welcome = container.querySelector('.chat-welcome');
        container.innerHTML = '';
        if (welcome) container.appendChild(welcome);
    }
}

function appendMessage(role, content, time) {
    const container = $('chat-messages');
    const div = document.createElement('div');
    div.className = role === 'user' ? 'user-msg-wrap' : 'ai-msg-wrap';

    const timeStr = time ? formatTime(time) : formatTime(new Date());

    if (role === 'user') {
        div.innerHTML = `
      <div class="user-bubble">
        <p>${escHtml(content)}</p>
        <span class="msg-time">${timeStr}</span>
      </div>
      <div class="user-avatar-sm">${currentUser.username.charAt(0).toUpperCase()}</div>
    `;
    } else {
        div.innerHTML = `
      <div class="ai-avatar">🤖</div>
      <div class="ai-bubble">
        <p>${formatAiContent(content)}</p>
        <span class="msg-time">${timeStr}</span>
      </div>
    `;
    }
    container.appendChild(div);
    return div;
}

function appendTypingIndicator() {
    const container = $('chat-messages');
    const div = document.createElement('div');
    div.className = 'ai-msg-wrap';
    div.id = 'typing-indicator';
    div.innerHTML = `
    <div class="ai-avatar">🤖</div>
    <div class="ai-bubble typing">
      <span class="typing-text">正在检索知识库...</span>
      <span class="typing-dots"><span></span><span></span><span></span></span>
    </div>
  `;
    container.appendChild(div);
    scrollToBottom();
    return div;
}

function scrollToBottom() {
    const c = $('chat-messages');
    c.scrollTop = c.scrollHeight;
}

function handleChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

async function sendMessage() {
    if (isSending) return;
    const input = $('chat-input');
    const content = input.value.trim();
    if (!content) return;
    if (!currentConvId) {
        await createNewConversation();
    }

    input.value = '';
    input.style.height = 'auto';
    isSending = true;
    $('btn-send').disabled = true;

    // 追加用户消息
    appendMessage('user', content, null);
    scrollToBottom();

    // 显示typing指示器
    const indicator = appendTypingIndicator();

    try {
        const res = await API.post(`/api/conversations/${currentConvId}/messages`, { content }, currentToken);
        indicator.remove();

        if (res.message) {
            appendMessage('assistant', res.message.content, null);
            // 刷新对话列表（标题可能已更新）
            loadConversations();
        }
    } catch (err) {
        indicator.remove();
        appendMessage('assistant', '网络错误，请稍后重试。', null);
    } finally {
        isSending = false;
        $('btn-send').disabled = false;
        scrollToBottom();
    }
}

/* ============================================
   后台管理 - 面板切换
   ============================================ */
function showAdminPane(pane) {
    ['dashboard', 'kb', 'bot', 'logs', 'settings'].forEach(p => {
        const el = $('admin-pane-' + p);
        if (el) el.classList.toggle('hidden', p !== pane);
    });

    document.querySelectorAll('.admin-nav-link').forEach((el, i) => {
        const panes = ['dashboard', 'kb', 'bot', 'logs', 'settings'];
        el.classList.toggle('active', panes[i] === pane);
    });

    if (pane === 'dashboard') loadDashboard();
    if (pane === 'logs') loadAdminLogs();
}

/* ============================================
   后台管理 - 知识库
   ============================================ */
async function loadKbList() {
    const res = await API.get('/api/kb', currentToken);
    allKbList = res.knowledge_bases || [];
    renderKbCards(allKbList);
    updateUploadKbSelector(allKbList);
}

function updateUploadKbSelector(kbs) {
    const sel = $('upload-kb-select');
    sel.innerHTML = kbs.map(kb => `<option value="${kb.id}">${escHtml(kb.name)}</option>`).join('');
    if (kbs.length > 0) show('upload-kb-selector');
    else hide('upload-kb-selector');
}

function filterKbList(query) {
    const filtered = allKbList.filter(kb => kb.name.includes(query) || (kb.description || '').includes(query));
    renderKbCards(filtered);
}

function filterKbTab(tab, btn) {
    document.querySelectorAll('.kb-sub-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // 简单实现：all 显示全部，其他保留原列表
    renderKbCards(allKbList);
}

function renderKbCards(kbs) {
    const container = $('kb-cards');
    if (kbs.length === 0) {
        container.innerHTML = '<p style="color:#888;text-align:center;padding:40px">暂无知识库，点击右上角创建</p>';
        return;
    }
    const cards = kbs.map(kb => `
    <div class="kb-card" onclick="viewKbDocs(${kb.id}, '${escHtml(kb.name)}')">
      <div class="kb-card-header">
        <div class="kb-card-icon ${kb.doc_count > 0 ? 'icon-blue' : 'icon-gray'}">📚</div>
        <div class="kb-card-menu" onclick="event.stopPropagation()">
          <button class="icon-btn" onclick="showKbMenu(event, ${kb.id})">⋮</button>
          <div class="kb-dropdown hidden" id="kb-menu-${kb.id}">
            <button onclick="deleteKb(${kb.id})">🗑 删除知识库</button>
          </div>
        </div>
      </div>
      <div class="kb-card-name">${escHtml(kb.name)}</div>
      <div class="kb-card-desc">${escHtml(kb.description || '暂无描述')}</div>
      <div class="kb-card-footer">
        <div class="kb-card-meta">
          <span>文档 ${kb.doc_count || 0}</span>
        </div>
        <span class="badge-done">已就绪</span>
      </div>
    </div>
  `).join('');

    // 添加"创建新库"卡片
    const addCard = `
    <div class="kb-card kb-add-card" onclick="showCreateKbModal()">
      <div class="kb-add-icon">＋</div>
      <div>点击创建新库</div>
    </div>
  `;
    container.innerHTML = cards + addCard;
}

function showKbMenu(e, id) {
    e.stopPropagation();
    const menu = $('kb-menu-' + id);
    document.querySelectorAll('.kb-dropdown').forEach(m => {
        if (m !== menu) m.classList.add('hidden');
    });
    menu.classList.toggle('hidden');
}
document.addEventListener('click', () => {
    document.querySelectorAll('.kb-dropdown').forEach(m => m.classList.add('hidden'));
});

async function deleteKb(id) {
    if (!confirm('确认删除该知识库？此操作不可恢复。')) return;
    const res = await API.delete(`/api/kb/${id}`, currentToken);
    if (res.error) { alert(res.error); return; }
    loadKbList();
}

async function viewKbDocs(kbId, name) {
    $('kb-docs-title').textContent = `${name} - 文档列表`;
    const res = await API.get(`/api/kb/${kbId}/documents`, currentToken);
    const docs = res.documents || [];
    const container = $('kb-docs-list');
    if (docs.length === 0) {
        container.innerHTML = '<p style="color:#888">暂无文档，请上传。</p>';
    } else {
        container.innerHTML = docs.map(d => `
      <div class="doc-item">
        <div class="doc-icon">${d.file_type === 'pdf' ? '🔴' : '🔵'}</div>
        <div class="doc-info">
          <div class="doc-name">${escHtml(d.filename)}</div>
          <div class="doc-meta">${formatFileSize(d.size)} · ${d.chunk_count || 0} 段落 · 
            <span class="doc-status ${d.status}">${statusLabel(d.status)}</span>
          </div>
        </div>
        <button class="btn-danger-sm" onclick="deleteDoc(${kbId}, ${d.id})">删除</button>
      </div>
    `).join('');
    }
    show('modal-kb-docs');
}

async function deleteDoc(kbId, docId) {
    if (!confirm('确认删除该文档？')) return;
    const res = await API.delete(`/api/kb/${kbId}/documents/${docId}`, currentToken);
    if (res.error) { alert(res.error); }
    const title = $('kb-docs-title').textContent.split(' - ')[0];
    viewKbDocs(kbId, title);
    loadKbList();
}

function statusLabel(s) {
    return { processing: '处理中', done: '训练完成', error: '处理失败' }[s] || s;
}
function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

/* ============================================
   后台管理 - 创建知识库弹窗
   ============================================ */
function showCreateKbModal() { show('modal-create-kb'); }
function closeModal(id) { hide(id); }
function closeModalOnOverlay(e, id) { if (e.target.id === id) hide(id); }

async function handleCreateKb() {
    const name = $('new-kb-name').value.trim();
    const desc = $('new-kb-desc').value.trim();
    if (!name) { alert('请输入知识库名称'); return; }
    const res = await API.post('/api/kb', { name, description: desc }, currentToken);
    if (res.error) { alert(res.error); return; }
    $('new-kb-name').value = '';
    $('new-kb-desc').value = '';
    closeModal('modal-create-kb');
    loadKbList();
}

/* ============================================
   后台管理 - 文件上传
   ============================================ */
function handleDragOver(e) {
    e.preventDefault();
    $('upload-zone').classList.add('dragover');
}
function handleDrop(e) {
    e.preventDefault();
    $('upload-zone').classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
}
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) uploadFile(file);
    e.target.value = '';
}

async function uploadFile(file) {
    const kbSelect = $('upload-kb-select');
    const kbId = kbSelect.value;
    if (!kbId) { alert('请先创建知识库'); return; }

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'doc'].includes(ext)) {
        alert('只支持 PDF 和 Word 文档');
        return;
    }

    const progressBar = $('upload-progress');
    const progressInner = $('upload-progress-inner');
    const statusText = $('upload-status');

    show('upload-progress');
    show('upload-status');
    statusText.textContent = `正在上传 ${file.name}...`;

    // 模拟进度条
    let prog = 0;
    const timer = setInterval(() => {
        prog = Math.min(prog + 10, 85);
        progressInner.style.width = prog + '%';
    }, 200);

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch(`/api/kb/${kbId}/upload`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${currentToken}` },
            body: formData,
        }).then(r => r.json());

        clearInterval(timer);
        progressInner.style.width = '100%';

        if (res.error) {
            statusText.textContent = '上传失败：' + res.error;
            statusText.style.color = '#ff4d4f';
        } else {
            statusText.textContent = `${file.name} 上传成功，正在后台处理...`;
            statusText.style.color = '#52c41a';
            setTimeout(() => { hide('upload-progress'); hide('upload-status'); loadKbList(); }, 2000);
        }
    } catch (err) {
        clearInterval(timer);
        statusText.textContent = '上传失败：网络错误';
        statusText.style.color = '#ff4d4f';
    }
}

/* ============================================
   后台管理 - 仪表盘
   ============================================ */
async function loadDashboard() {
    const res = await API.get('/api/kb', currentToken);
    const kbs = res.knowledge_bases || [];
    const totalDocs = kbs.reduce((sum, kb) => sum + (kb.doc_count || 0), 0);
    $('dashboard-stats').innerHTML = `
    <div class="stat-card"><div class="stat-value">${kbs.length}</div><div class="stat-label">知识库数量</div></div>
    <div class="stat-card"><div class="stat-value">${totalDocs}</div><div class="stat-label">文档总数</div></div>
    <div class="stat-card"><div class="stat-value">GLM-4-Flash</div><div class="stat-label">当前模型</div></div>
  `;
}

async function loadAdminLogs() {
    // 管理员查看所有对话（简化：查当前用户的）
    const container = $('admin-logs-list');
    container.innerHTML = '<p style="color:#888">对话记录功能待扩展（当前展示当前账号记录）。</p>';
}

/* ============================================
   工具函数
   ============================================ */
function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatAiContent(content) {
    // 简单 Markdown 转换：**bold**、换行
    return escHtml(content)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br/>');
}
