'use strict';

const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// ── no_proxy check ─────────────────────────────────────────────────────────
function shouldBypassProxy(hostname, noProxy) {
  if (!noProxy) return false;
  const entries = noProxy.split(',').map(e => e.trim()).filter(Boolean);
  for (const entry of entries) {
    if (entry === '*') return true;
    const pattern = entry.startsWith('.') ? entry : '.' + entry;
    if (hostname === entry || hostname.endsWith(pattern)) return true;
  }
  return false;
}

// ── Resolve proxy URL from env ─────────────────────────────────────────────
function getProxyUrl(targetUrl) {
  const parsed = new URL(targetUrl);
  const noProxy = process.env.no_proxy || process.env.NO_PROXY || '';
  if (shouldBypassProxy(parsed.hostname, noProxy)) return undefined;

  if (parsed.protocol === 'https:') {
    return process.env.https_proxy || process.env.HTTPS_PROXY ||
           process.env.http_proxy || process.env.HTTP_PROXY || undefined;
  }
  return process.env.http_proxy || process.env.HTTP_PROXY || undefined;
}

// ── ProxyAgent (HTTP CONNECT tunnel) ───────────────────────────────────────
class ProxyAgent extends https.Agent {
  constructor(proxyUrl) {
    super({ keepAlive: false });
    this.proxy = new URL(proxyUrl);
  }

  createConnection(options, cb) {
    const proxyHost = this.proxy.hostname;
    const proxyPort = parseInt(this.proxy.port, 10) || (this.proxy.protocol === 'https:' ? 443 : 80);
    const targetHost = options.host || options.hostname;
    const targetPort = options.port || 443;

    // Connect to proxy
    const connectFn = this.proxy.protocol === 'https:'
      ? () => tls.connect({ host: proxyHost, port: proxyPort, servername: proxyHost })
      : () => net.connect({ host: proxyHost, port: proxyPort });

    const socket = connectFn();

    // Build CONNECT request
    let connectReq = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n`;
    if (this.proxy.username || this.proxy.password) {
      const creds = Buffer.from(`${decodeURIComponent(this.proxy.username)}:${decodeURIComponent(this.proxy.password)}`).toString('base64');
      connectReq += `Proxy-Authorization: Basic ${creds}\r\n`;
    }
    connectReq += '\r\n';

    socket.once('error', cb);
    socket.write(connectReq);

    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      socket.removeListener('data', onData);
      socket.removeListener('error', cb);

      const statusLine = buf.slice(0, buf.indexOf('\r\n'));
      const statusCode = parseInt(statusLine.split(' ')[1], 10);
      if (statusCode !== 200) {
        socket.destroy();
        return cb(new Error(`Proxy CONNECT failed: ${statusLine}`));
      }

      // If target is HTTPS, wrap in TLS
      if (options._defaultPort === 443 || options.servername || (options.port || 443) === 443) {
        const tlsSocket = tls.connect({
          socket,
          host: targetHost,
          servername: options.servername || targetHost,
        }, () => {
          cb(null, tlsSocket);
        });
        tlsSocket.once('error', cb);
      } else {
        cb(null, socket);
      }
    };
    socket.on('data', onData);
  }
}

// ── Factory ────────────────────────────────────────────────────────────────
function createProxyAgent(targetUrl, noProxyFlag) {
  if (noProxyFlag) return undefined;
  const proxyUrl = getProxyUrl(targetUrl);
  if (!proxyUrl) return undefined;
  return new ProxyAgent(proxyUrl);
}

module.exports = { shouldBypassProxy, getProxyUrl, ProxyAgent, createProxyAgent };
