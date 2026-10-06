/* ============================================================
 * tests/browser/static-server.mjs — 零依赖静态服务（浏览器层 L4 的基础设施）
 * ------------------------------------------------------------
 * 为什么需要（而不是直接把 fixture 写成 file:// 打开）：
 *   file:// 之下 Chromium 对**多模块并发加载**的处理不稳定 —— 实测同一份
 *   fixture 重复跑 6 次，「真模块图（8 个文件）全部加载完成」只有约一半的轮次
 *   成立，另一半在 `await import(...)` 处**静默挂住**（既无异常、也不继续），
 *   于是一批本来该红的判据会因为「模块压根没加载」而拿到空白读数。
 *   这与本仓最贵的那类假绿同族：**不能把「没跑起来」读成「没有问题」**。
 *   走 HTTP 单源（fixture 与仓库文件同 origin）后，同样的 6 轮全部稳定完成。
 *
 * 本服务只做三件事：
 *   ① 把仓库根当静态目录（只读、越界即 403）；
 *   ② 对 `/` 返回调用方给的 fixture HTML（场景代码由它以内联 module 形式带上）；
 *   ③ 如实记录每一次被请求的相对路径（用于「真模块图确实被加载」这一读数）。
 * 它**不做**任何写入、不解析任何请求体、不落任何日志文件。
 * ============================================================ */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

/**
 * 起一个只读静态服务。
 * @param {{root:string, fixture?:string}} opts
 *   `root` 必须是绝对路径；所有请求都被解析到它之下，越界（含 `..` / 编码穿越）一律 403。
 *   `fixture` 是 `/` 的 HTML 响应体（场景代码由调用方拼好传进来）。
 * @returns {Promise<{origin:string, port:number, served:string[], close:()=>Promise<void>}>}
 */
export async function startStaticServer(opts = {}) {
  const root = path.resolve(String(opts.root || process.cwd()));
  const fixture = String(opts.fixture ?? '<!doctype html><meta charset="utf-8"><title>empty</title>');
  const served = [];

  const server = http.createServer((req, res) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    } catch (_e) {
      res.writeHead(400); res.end('bad request'); return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      served.push('<fixture>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fixture);
      return;
    }

    const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    const abs = path.resolve(root, rel);
    // 越界判据：解析后的绝对路径必须仍在 root 之下（`path.relative` 不以 `..` 开头）。
    const rel2root = path.relative(root, abs);
    if (rel2root.startsWith('..') || path.isAbsolute(rel2root)) {
      res.writeHead(403); res.end('forbidden'); return;
    }

    fs.readFile(abs, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      served.push(rel);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(buf);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    /** 本次会话中真实被请求过的相对路径（按请求顺序，含重复）。 */
    served,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
