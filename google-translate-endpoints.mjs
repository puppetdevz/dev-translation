/**
 * Google Translate 三个免费端点的 Node.js 实现
 * 使用内置 https 模块，零依赖
 *
 * 作者：调研报告
 * 日期：2026-07-04
 *
 * 来源参考：
 * - DualSubs/Universal (Apache-2.0) — https://github.com/DualSubs/Universal
 * - @vitalets/google-translate-api — https://github.com/vitalets/google-translate-api
 * - selecton-extension — https://github.com/emvaized/selecton-extension
 * - shinkansen — https://github.com/jimmysu0309/shinkansen
 * - stremio-translate-subtitle — https://github.com/HimAndRobot/stremio-translate-subtitle-by-geanpn
 * - MouseTooltipTranslator — https://github.com/ttop32/MouseTooltipTranslator
 */

import https from 'node:https';
import { URL, URLSearchParams } from 'node:url';

// ============================================================
// 工具函数：HTTPS 请求封装
// ============================================================

/**
 * 通用 HTTPS 请求
 * @param {string} method - GET / POST
 * @param {string} urlStr - 完整 URL
 * @param {object} headers - 请求头
 * @param {string|null} body - POST 请求体
 * @param {number} timeoutMs - 超时毫秒
 * @returns {Promise<{status: number, body: string}>}
 */
function httpsRequest(method, urlStr, headers = {}, body = null, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        ...headers,
      },
      timeout: timeoutMs,
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

    if (body) req.write(body);
    req.end();
  });
}

// ============================================================
// 端点 1：translate.googleapis.com
// 模式 A: GET 方式 (client=gtx, 嵌套数组响应)
// 模式 B: POST 方式 (client=at&dj=1, JSON 对象响应) — 推荐
// ============================================================

/**
 * 端点 1 - GET 方式 (gtx)
 * 优点：简单直接
 * 缺点：响应是深度嵌套数组，解析略麻烦
 */
export async function translateEndpoint1_GET(text, from = 'auto', to = 'zh-CN') {
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', from);
  url.searchParams.set('tl', to);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text);

  const { status, body } = await httpsRequest('GET', url.toString(), {
    'Referer': 'https://translate.google.com',
  });

  if (status !== 200) {
    throw new Error(`Endpoint 1 GET failed: HTTP ${status}`);
  }

  const data = JSON.parse(body);

  // 解析嵌套数组: data[0] = [[译1, 原1, ...], [译2, 原2, ...], ...]
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error('Endpoint 1 GET: unexpected response structure');
  }

  const translation = data[0]
    .map(seg => Array.isArray(seg) ? seg[0] : '')
    .filter(Boolean)
    .join('');

  const detectedLang = data[2] || from;

  return { translation, detectedLang };
}


/**
 * 端点 1 - POST 方式 (client=at, dj=1) ⭐推荐
 * 优点：响应是干净的 JSON 对象，@vitalets/google-translate-api 使用的就是此方式
 * 响应格式: { sentences: [{ trans, orig }], src: "en", confidence: 1.0 }
 */
export async function translateEndpoint1_POST(text, from = 'auto', to = 'zh-CN') {
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('dt', 't');
  url.searchParams.set('dj', '1');

  const body = new URLSearchParams({ sl: from, tl: to, q: text }).toString();

  const { status, body: responseBody } = await httpsRequest(
    'POST',
    url.toString(),
    {
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      'Referer': 'https://translate.google.com',
    },
    body,
    10000
  );

  if (status !== 200) {
    throw new Error(`Endpoint 1 POST failed: HTTP ${status}`);
  }

  const data = JSON.parse(responseBody);

  // dj=1 格式: { sentences: [{trans: "...", orig: "..."}, {translit: "..."}], src: "en" }
  if (!data.sentences || !Array.isArray(data.sentences)) {
    throw new Error('Endpoint 1 POST: missing sentences array');
  }

  const translation = data.sentences
    .filter(s => typeof s.trans === 'string')
    .map(s => s.trans)
    .join('');

  const detectedLang = data.src || from;

  return { translation, detectedLang };
}


// ============================================================
// 端点 2：clients5.google.com (Chrome 字典扩展端点)
// 响应格式: [["翻译", "原文", null, null, null, [["释义"]]], "检测语言"]
// 注意：此端点稳定性不如端点 1, 2022 年曾长时间不可用
// ============================================================

export async function translateEndpoint2(text, from = 'auto', to = 'zh-CN') {
  const url = new URL('https://clients5.google.com/translate_a/t');
  url.searchParams.set('client', 'dict-chrome-ex');
  url.searchParams.set('sl', from);
  url.searchParams.set('tl', to);
  url.searchParams.set('q', text);

  const { status, body } = await httpsRequest('GET', url.toString(), {
    'Referer': 'https://translate.google.com',
  });

  if (status !== 200) {
    throw new Error(`Endpoint 2 failed: HTTP ${status}`);
  }

  const data = JSON.parse(body);

  // 实际响应格式: [["翻译", "检测语言"]]
  // data[0] = ["你好世界", "en"]
  // 译文 = data[0][0], 检测语言 = data[0][1]
  const translation = data?.[0]?.[0] || '';
  const detectedLang = data?.[0]?.[1] || from;

  return { translation, detectedLang };
}


// ============================================================
// 端点 3：batchexecute (最可靠，但最复杂)
// 需要先从 translate.google.com 首页刮取 token
// ============================================================

/** Token 缓存 */
let _tokenCache = { fSid: '', bl: '', at: '', expiresAt: 0 };

/**
 * 从 translate.google.com 首页刮取 token
 * 参考: ttop32/MouseTooltipTranslator, FreddieDeWitt/google-translate-extended-api
 */
async function getTokens() {
  if (_tokenCache.expiresAt > Date.now()) {
    return _tokenCache;
  }

  const { status, body } = await httpsRequest(
    'GET',
    'https://translate.google.com/',
    {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    null,
    15000  // 首页可能很大，给 15s 超时
  );

  if (status !== 200) {
    throw new Error(`Failed to fetch Google Translate homepage: HTTP ${status}`);
  }

  const fSid = body.match(/"FdrFJe":"(.*?)"/)?.[1];
  const bl = body.match(/"cfb2h":"(.*?)"/)?.[1];
  const at = body.match(/"SNlM0e":"(.*?)"/)?.[1] || '';

  if (!fSid || !bl) {
    throw new Error('Failed to extract tokens from Google Translate homepage');
  }

  _tokenCache = { fSid, bl, at, expiresAt: Date.now() + 55 * 60 * 1000 }; // 55 分钟 TTL
  return _tokenCache;
}

/**
 * 端点 3 - batchexecute
 * RPC ID: MkEWBc (翻译)
 * 参考实现: HimAndRobot/stremio-translate-subtitle, google-translate-api-browser
 */
export async function translateEndpoint3(text, from = 'auto', to = 'zh-CN') {
  const { fSid, bl, at } = await getTokens();

  // 构建请求体 f.req
  // 格式: [[["MkEWBc", "[[\"text\",\"from\",\"to\",true],[null]]", null, "generic"]]]
  const rpcPayload = JSON.stringify([[text, from, to, true], [null]]);
  const fReq = JSON.stringify([[[ 'MkEWBc', rpcPayload, null, 'generic' ]]]);
  const postBody = new URLSearchParams({ 'f.req': fReq, at }).toString();

  // 构建 URL 参数
  const reqId = Math.floor(10000 + Math.random() * 90000);
  const url = new URL('https://translate.google.com/_/TranslateWebserverUi/data/batchexecute');
  url.searchParams.set('rpcids', 'MkEWBc');
  url.searchParams.set('source-path', '/');
  url.searchParams.set('f.sid', fSid);
  url.searchParams.set('bl', bl);
  url.searchParams.set('hl', 'en');
  url.searchParams.set('soc-app', '1');
  url.searchParams.set('soc-platform', '1');
  url.searchParams.set('soc-device', '1');
  url.searchParams.set('_reqid', String(reqId));
  url.searchParams.set('rt', 'c');

  const { status, body: responseBody } = await httpsRequest(
    'POST',
    url.toString(),
    {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Referer': 'https://translate.google.com/',
    },
    postBody,
    15000
  );

  if (status !== 200) {
    if (status === 429) throw new Error('Endpoint 3: rate limited (429)');
    throw new Error(`Endpoint 3 failed: HTTP ${status}`);
  }

  // 解析响应
  // batchexecute 返回的是多行 JSON (每行一个 JSON 数组)
  // 安全前缀: )]}'\n
  const cleaned = responseBody.replace(/^\)\]\}'\n?/, '').trim();

  // 逐行解析，找到 MkEWBc 那一行
  let payloadStr = null;
  for (const line of cleaned.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (Array.isArray(row) && row[0] === 'wrb.fr' && row[1] === 'MkEWBc') {
        payloadStr = row[2]; // 第三个元素是 payload JSON 字符串
        break;
      }
    } catch { /* 跳过非 JSON 行 */ }
  }

  if (!payloadStr) {
    throw new Error('Endpoint 3: no MkEWBc response row found');
  }

  const payload = JSON.parse(payloadStr);

  // payload[1][0][0][5] = 译文片段数组
  const translatedBlocks = payload?.[1]?.[0]?.[0]?.[5];
  if (!Array.isArray(translatedBlocks)) {
    throw new Error('Endpoint 3: unexpected payload structure');
  }

  const translation = translatedBlocks
    .map(block => block?.[0])
    .filter(Boolean)
    .join(' ');

  const detectedLang = payload[2] || from;

  return { translation, detectedLang };
}


// ============================================================
// 测试运行
// ============================================================

async function runTests() {
  const testCases = [
    { text: 'Hello world', from: 'auto', to: 'zh-CN', label: '英→中' },
    { text: '你好世界', from: 'auto', to: 'en', label: '中→英' },
    { text: 'How are you today?', from: 'auto', to: 'ja', label: '英→日' },
    { text: '长期存在且稳定运行的接口', from: 'auto', to: 'en', label: '长句中→英' },
  ];

  const endpoints = [
    { name: '端点1 GET (gtx)', fn: translateEndpoint1_GET },
    { name: '端点1 POST (gtx+dj=1)', fn: translateEndpoint1_POST },
    { name: '端点2 (clients5)', fn: translateEndpoint2 },
  ];

  // 端点 3 (batchexecute) 需要访问 translate.google.com 刮取 token，
  // 在部分网络环境下不可达（如中国），已在单独测试中验证。

  for (const ep of endpoints) {
    console.log(`\n══════════════════════════════════════════════`);
    console.log(`  ${ep.name}`);
    console.log(`══════════════════════════════════════════════`);

    for (const tc of testCases) {
      try {
        const start = Date.now();
        const result = await ep.fn(tc.text, tc.from, tc.to);
        const elapsed = Date.now() - start;
        console.log(`  [${tc.label}] ${elapsed}ms`);
        console.log(`    原文: ${tc.text}`);
        console.log(`    译文: ${result.translation}`);
        console.log(`    检测: ${result.detectedLang}`);
      } catch (err) {
        console.log(`  [${tc.label}] ❌ ${err.message}`);
      }

      // 请求间隔避免频限
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

// 当直接运行此文件时执行测试
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  runTests().catch(console.error);
}
