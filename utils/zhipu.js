/**
 * 智谱 AI (GLM-4-Flash) API 封装
 */
const https = require('https');

const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY || '7d82a8c0a35841b29d9bc58ca2c29232.CxHh43LtGfpnBy5D';
const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const MODEL = 'GLM-4-Flash';

/**
 * 调用智谱 AI 聊天接口
 * @param {Array} messages - [{role, content}]
 * @returns {Promise<string>} - AI 回复文本
 */
function chat(messages) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            model: MODEL,
            messages,
            temperature: 0.7,
            max_tokens: 1024,
            stream: false,
        });

        const url = new URL(ZHIPU_API_URL);
        const options = {
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ZHIPU_API_KEY}`,
                'Content-Length': Buffer.byteLength(body),
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.choices && json.choices[0]) {
                        resolve(json.choices[0].message.content);
                    } else if (json.error) {
                        reject(new Error(json.error.message || '智谱 AI 返回错误'));
                    } else {
                        reject(new Error('智谱 AI 未知响应: ' + data));
                    }
                } catch (e) {
                    reject(new Error('解析智谱 AI 响应失败: ' + data));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(60000, () => {
            req.destroy();
            reject(new Error('请求超时，请稍后重试'));
        });
        req.write(body);
        req.end();
    });
}

module.exports = { chat };
