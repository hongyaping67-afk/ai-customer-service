const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'zhipu_ai_customer_service_2024';

// 注册
router.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
    if (username.length < 2 || username.length > 20) return res.status(400).json({ error: '用户名长度需在 2-20 个字符之间' });
    if (password.length < 6) return res.status(400).json({ error: '密码长度不能少于 6 位' });

    const existing = db.get('users', r => r.username === username);
    if (existing) return res.status(400).json({ error: '该用户名已被注册' });

    const hash = bcrypt.hashSync(password, 10);
    const user = db.insert('users', { username, password_hash: hash, role: 'user' });

    const token = jwt.sign({ id: user.id, username, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username, role: 'user' } });
});

// 登录
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });

    const user = db.get('users', r => r.username === username);
    if (!user) return res.status(401).json({ error: '用户名或密码错误' });

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: '用户名或密码错误' });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// 获取当前用户信息
router.get('/me', authenticateToken, (req, res) => {
    const user = db.get('users', r => r.id === req.user.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const { password_hash, ...safeUser } = user;
    res.json({ user: safeUser });
});

// JWT 验证中间件
function authenticateToken(req, res, next) {
    const auth = req.headers['authorization'];
    const token = auth && auth.split(' ')[1];
    if (!token) return res.status(401).json({ error: '未登录，请先登录' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'token 无效或已过期，请重新登录' });
        req.user = user;
        next();
    });
}

module.exports = router;
module.exports.authenticateToken = authenticateToken;
module.exports.JWT_SECRET = JWT_SECRET;
