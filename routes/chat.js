const express = require('express');
const db = require('../database');
const { authenticateToken } = require('./auth');
const { retrieve } = require('../utils/rag');
const { chat } = require('../utils/zhipu');

const router = express.Router();

// 获取当前用户的所有会话
router.get('/', authenticateToken, (req, res) => {
    const convs = db.query('conversations', c => c.user_id === req.user.id)
        .sort((a, b) => b.id - a.id)
        .map(conv => {
            const msgs = db.query('messages', m => m.conversation_id === conv.id).sort((a, b) => b.id - a.id);
            return { ...conv, last_message: msgs[0]?.content || null };
        });
    res.json({ conversations: convs });
});

// 新建会话
router.post('/', authenticateToken, (req, res) => {
    const conv = db.insert('conversations', {
        user_id: req.user.id, title: req.body.title || '新对话', updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
    res.json({ conversation: conv });
});

// 更新标题
router.patch('/:id', authenticateToken, (req, res) => {
    const id = parseInt(req.params.id);
    const conv = db.get('conversations', c => c.id === id && c.user_id === req.user.id);
    if (!conv) return res.status(404).json({ error: '会话不存在' });
    db.update('conversations', c => c.id === id, { title: req.body.title });
    res.json({ message: 'ok' });
});

// 删除会话
router.delete('/:id', authenticateToken, (req, res) => {
    const id = parseInt(req.params.id);
    const conv = db.get('conversations', c => c.id === id && c.user_id === req.user.id);
    if (!conv) return res.status(404).json({ error: '会话不存在' });
    db.delete('messages', m => m.conversation_id === id);
    db.delete('conversations', c => c.id === id);
    res.json({ message: '会话已删除' });
});

// 获取会话消息
router.get('/:id/messages', authenticateToken, (req, res) => {
    const id = parseInt(req.params.id);
    const conv = db.get('conversations', c => c.id === id && c.user_id === req.user.id);
    if (!conv) return res.status(404).json({ error: '会话不存在' });
    const messages = db.query('messages', m => m.conversation_id === id).sort((a, b) => a.id - b.id);
    res.json({ messages, conversation: conv });
});

// 发送消息（RAG + 智谱 AI）
router.post('/:id/messages', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id);
    const conv = db.get('conversations', c => c.id === id && c.user_id === req.user.id);
    if (!conv) return res.status(404).json({ error: '会话不存在' });

    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: '消息内容不能为空' });

    // 存用户消息
    db.insert('messages', { conversation_id: id, role: 'user', content: content.trim() });

    // 更新会话标题（如果是第一条消息）
    const msgCount = db.query('messages', m => m.conversation_id === id).length;
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    if (msgCount === 1) {
        const title = content.length > 20 ? content.slice(0, 20) + '...' : content;
        db.update('conversations', c => c.id === id, { title, updated_at: now });
    } else {
        db.update('conversations', c => c.id === id, { updated_at: now });
    }

    // RAG 检索
    const retrieved = retrieve(content.trim(), 3);
    console.log(`用户问题: "${content.trim()}", 检索到 ${retrieved.length} 条相关内容`);
    if (retrieved.length > 0) {
        retrieved.forEach((r, i) => console.log(`  检索片段 ${i + 1} (Score: ${r.score.toFixed(2)}): ${r.content.slice(0, 30)}...`));
    }
    let systemPrompt = '你是一个专业的智能客服助手，请用友好、专业的语气回答用户问题。请使用中文简体回答。';
    if (retrieved.length > 0) {
        const context = retrieved.map((r, i) => `[参考资料${i + 1}]（来源：${r.filename}）：\n${r.content}`).join('\n\n');
        systemPrompt += `\n\n以下是从知识库中检索到的相关信息，请优先基于这些内容回答：\n\n${context}`;
    }

    // 历史消息（最近 10 条）
    const history = db.query('messages', m => m.conversation_id === id).sort((a, b) => a.id - b.id);
    const recentHistory = history.slice(-11, -1);

    const messages = [
        { role: 'system', content: systemPrompt },
        ...recentHistory.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: content.trim() },
    ];

    try {
        const aiResponse = await chat(messages);
        db.insert('messages', { conversation_id: id, role: 'assistant', content: aiResponse });
        res.json({ message: { role: 'assistant', content: aiResponse }, used_knowledge_base: retrieved.length > 0 });
    } catch (err) {
        console.error('AI 调用失败:', err.message);
        const errMsg = '抱歉，AI 服务暂时不可用，请稍后重试。';
        db.insert('messages', { conversation_id: id, role: 'assistant', content: errMsg });
        res.json({ message: { role: 'assistant', content: errMsg }, error: true });
    }
});

module.exports = router;
