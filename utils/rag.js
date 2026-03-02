/**
 * RAG 检索 — 针对中文优化的分词与检索
 */
const db = require('../database');

/**
 * 分词函数：支持中英文
 * 将英文按单词切分，中文按字符切分
 */
function tokenize(text) {
    if (!text) return [];

    // 1. 替换标点符号为空格
    const cleanText = text.toLowerCase()
        .replace(/[，。！？、；：""''【】（）《》\[\]{}()<>:;!?,.]/g, ' ');

    // 2. 匹配英文单词和中文字符
    // \w+ 匹配英文/数字，[\u4e00-\u9fa5] 匹配中文字符
    const tokens = cleanText.match(/(\w+|[\u4e00-\u9fa5])/g) || [];

    // 过滤掉单个无意义的字符（可选，这里对中文保留，对英文保留长度>1）
    return tokens.filter(t => {
        if (/[\u4e00-\u9fa5]/.test(t)) return true; // 中文单字也有意义
        return t.length > 1; // 英文单词通常 > 1
    });
}

/**
 * 计算分数：Jaccard 相似度或简单的命中计数
 */
function calculateScore(queryTokens, chunkText) {
    if (!queryTokens.length) return 0;

    const chunkTextLower = chunkText.toLowerCase();
    let hits = 0;

    // 使用简单的包含性检查（针对中文更鲁棒）
    for (const token of queryTokens) {
        if (chunkTextLower.includes(token)) {
            hits++;
        }
    }

    return hits / queryTokens.length;
}

function retrieve(query, topK = 3) {
    const queryTokens = tokenize(query);
    if (!queryTokens.length) return [];

    // 获取所有就绪的文档和 chunks
    const doneDocs = new Set(db.query('documents', d => d.status === 'done').map(d => d.id));
    const chunks = db.query('document_chunks', c => doneDocs.has(c.doc_id));

    if (!chunks.length) return [];

    const docMap = new Map(db.query('documents').map(d => [d.id, d.filename]));

    const scored = chunks.map(c => ({
        content: c.content,
        filename: docMap.get(c.doc_id) || '未知文档',
        score: calculateScore(queryTokens, c.content),
    }));

    // 排序：分数从高到低
    scored.sort((a, b) => b.score - a.score);

    // 只返回有匹配度的段落
    return scored.filter(s => s.score > 0).slice(0, topK);
}

module.exports = { retrieve };
