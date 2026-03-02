/**
 * 纯 JavaScript JSON 文件数据库
 * 无需原生模块编译，兼容任意 Node 版本
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const isServerless = !!(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);

const DATA_DIR = isServerless
  ? path.join('/tmp', 'data')
  : path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error('无法创建数据目录:', err.message);
  }
}

const DB_FILE = path.join(DATA_DIR, 'db.json');

// 初始化数据结构
const defaultDB = {
  users: [],
  knowledge_bases: [],
  documents: [],
  document_chunks: [],
  conversations: [],
  messages: [],
  _seq: { users: 1, knowledge_bases: 1, documents: 1, document_chunks: 1, conversations: 1, messages: 1 },
};

function loadDB() {
  if (!fs.existsSync(DB_FILE)) return JSON.parse(JSON.stringify(defaultDB));
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return JSON.parse(JSON.stringify(defaultDB));
  }
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('数据库保存失败:', err.message);
  }
}

function nextId(data, table) {
  if (!data._seq) data._seq = {};
  if (!data._seq[table]) data._seq[table] = 1;
  return data._seq[table]++;
}

// ---- CRUD helpers ----
const db = {
  // read entire store
  _load: loadDB,
  _save: saveDB,

  // Universal query
  query(table, filter) {
    const data = loadDB();
    const rows = data[table] || [];
    return filter ? rows.filter(filter) : rows;
  },

  // Get one
  get(table, filter) {
    return this.query(table, filter)[0] || null;
  },

  // Insert
  insert(table, record) {
    const data = loadDB();
    if (!data[table]) data[table] = [];
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const id = nextId(data, table);
    const row = { id, ...record, created_at: now };
    data[table].push(row);
    saveDB(data);
    return row;
  },

  // Update
  update(table, filter, updates) {
    const data = loadDB();
    let count = 0;
    data[table] = (data[table] || []).map(row => {
      if (filter(row)) { count++; return { ...row, ...updates }; }
      return row;
    });
    saveDB(data);
    return count;
  },

  // Delete
  delete(table, filter) {
    const data = loadDB();
    const before = (data[table] || []).length;
    data[table] = (data[table] || []).filter(r => !filter(r));
    saveDB(data);
    return before - data[table].length;
  },

  // Insert many (bulk)
  insertMany(table, records) {
    const data = loadDB();
    if (!data[table]) data[table] = [];
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const rows = records.map(rec => {
      const id = nextId(data, table);
      return { id, ...rec, created_at: now };
    });
    data[table].push(...rows);
    saveDB(data);
    return rows;
  },
};

// 创建默认管理员
const admin = db.get('users', r => r.username === 'admin');
if (!admin) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.insert('users', { username: 'admin', password_hash: hash, role: 'admin' });
  console.log('默认管理员账号已创建: admin / admin123');
}

module.exports = db;
