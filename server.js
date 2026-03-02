const express = require('express');
const cors = require('cors');
const path = require('path');

// 初始化数据库（建表+默认账号）
require('./database');

const authRouter = require('./routes/auth');
const knowledgeRouter = require('./routes/knowledge');
const chatRouter = require('./routes/chat');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 静态文件（前端）
app.use(express.static(path.join(__dirname, 'public')));

// API 路由
app.use('/api/auth', authRouter);
app.use('/api/kb', knowledgeRouter);
app.use('/api/conversations', chatRouter);

// 所有未匹配的 GET 请求返回前端页面（SPA）
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 全局错误处理
app.use((err, req, res, next) => {
    console.error('全局错误:', err.message);
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: '文件大小超过 20MB 限制' });
    }
    res.status(500).json({ error: '服务器内部错误: ' + err.message });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`智能客服平台已启动：http://localhost:${PORT}`);
        console.log('默认管理员账号: admin / admin123');
    });
}

module.exports = app;
