const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { authenticateToken } = require('./auth');

const router = express.Router();

const isServerless = !!(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);

const uploadDir = isServerless
    ? path.join('/tmp', 'uploads')
    : path.join(__dirname, '../uploads');

if (!fs.existsSync(uploadDir)) {
    try {
        fs.mkdirSync(uploadDir, { recursive: true });
    } catch (err) {
        console.error('无法创建上传目录:', err.message);
    }
}

const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + path.extname(file.originalname));
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        ['.pdf', '.docx', '.doc'].includes(ext) ? cb(null, true) : cb(new Error('只支持 PDF 和 Word 文档'));
    },
});

function splitIntoChunks(text, size = 500, overlap = 50) {
    const chunks = [];
    let start = 0;
    while (start < text.length) {
        const chunk = text.slice(start, start + size).trim();
        if (chunk.length > 20) chunks.push(chunk);
        start += size - overlap;
    }
    return chunks;
}

async function parseDocument(filePath, fileType) {
    if (fileType === 'pdf') {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(fs.readFileSync(filePath));
        return data.text;
    }
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
}

// ---- 知识库 CRUD ----

router.get('/', authenticateToken, (req, res) => {
    const kbs = db.query('knowledge_bases').sort((a, b) => b.id - a.id);
    const result = kbs.map(kb => {
        const docCount = db.query('documents', d => d.kb_id === kb.id).length;
        return { ...kb, doc_count: docCount };
    });
    res.json({ knowledge_bases: result });
});

router.post('/', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可创建知识库' });
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: '知识库名称不能为空' });
    const kb = db.insert('knowledge_bases', { name, description: description || '', created_by: req.user.id });
    res.json({ knowledge_base: kb });
});

router.delete('/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可删除知识库' });
    const id = parseInt(req.params.id);
    const kb = db.get('knowledge_bases', r => r.id === id);
    if (!kb) return res.status(404).json({ error: '知识库不存在' });
    // cascade
    const docs = db.query('documents', d => d.kb_id === id);
    docs.forEach(doc => db.delete('document_chunks', c => c.doc_id === doc.id));
    db.delete('documents', d => d.kb_id === id);
    db.delete('knowledge_bases', r => r.id === id);
    res.json({ message: '知识库已删除' });
});

router.get('/:id/documents', authenticateToken, (req, res) => {
    const id = parseInt(req.params.id);
    const docs = db.query('documents', d => d.kb_id === id).sort((a, b) => b.id - a.id);
    res.json({ documents: docs });
});

router.post('/:id/upload', authenticateToken, upload.single('file'), async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可上传文档' });
    const kbId = parseInt(req.params.id);
    const kb = db.get('knowledge_bases', r => r.id === kbId);
    if (!kb) return res.status(404).json({ error: '知识库不存在' });
    if (!req.file) return res.status(400).json({ error: '请上传文件' });

    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
    const fileType = ext === 'pdf' ? 'pdf' : 'docx';

    const doc = db.insert('documents', {
        kb_id: kbId, filename: originalName,
        file_type: fileType, size: req.file.size, status: 'processing', chunk_count: 0,
    });

    res.json({ message: '文件上传成功，正在处理...', doc_id: doc.id });

    setImmediate(async () => {
        try {
            const text = await parseDocument(req.file.path, fileType);
            const chunks = splitIntoChunks(text);
            db.insertMany('document_chunks', chunks.map((c, i) => ({ doc_id: doc.id, kb_id: kbId, content: c, chunk_index: i })));
            db.update('documents', r => r.id === doc.id, { status: 'done', chunk_count: chunks.length });
            console.log(`文档 ${req.file.originalname} 处理完成，共 ${chunks.length} 段落`);
        } catch (err) {
            console.error('文档处理失败:', err.message);
            db.update('documents', r => r.id === doc.id, { status: 'error' });
        }
    });
});

router.delete('/:kbId/documents/:docId', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可删除文档' });
    const kbId = parseInt(req.params.kbId);
    const docId = parseInt(req.params.docId);
    const doc = db.get('documents', d => d.id === docId && d.kb_id === kbId);
    if (!doc) return res.status(404).json({ error: '文档不存在' });
    db.delete('document_chunks', c => c.doc_id === docId);
    db.delete('documents', d => d.id === docId);
    res.json({ message: '文档已删除' });
});

module.exports = router;
