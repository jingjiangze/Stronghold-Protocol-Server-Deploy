// public/js/offline/localSocket.js — loopback WebSocket：一条页内「假连接」的两个端。
//
// 这是离线路径唯一的传输缝：public/js/net.js 的 `Net` 本来就支持 `opts.WebSocket` 注入
// （connect() 里 `const WS = this.WS || globalThis.WebSocket`），所以我们 **不改 Net**——
// 造一个 WebSocket 形状的类，客户端端交给 Net，服务端端交给 LocalLobby（offline/localLobby.js）。
// 帧格式与线上完全一致：JSON 文本帧，双向。
//
// 契约与 himobrine/Stronghold-Protocol-pure-web 的 shared/transportLoopback.js 同源（该仓为本方案参考）：
//   * readyState: 0 CONNECTING / 1 OPEN / 3 CLOSED（WebSocket 常量）。
//   * 构造后异步 open（微任务）：Net 在 `new WS(url)` 之后才挂 onopen/onmessage，必须留窗口。
//   * send 抛错条件与浏览器 WebSocket 一致（CONNECTING 时抛）；CLOSING/CLOSED 丢弃。
//   * close(code) 幂等；双向传播真实 close code（4001 替换语义在离线不存在，但保持形状）。

/**
 * 造一个「每次 new 都接到同一 host」的 WebSocket 替代类。
 * @param {{ open: (ep: any) => void, close?: (ep: any, code: number, reason: string) => void }} host
 *   服务端端：收到 `ep`（{ readyState, send(text), onmessage, onclose, close(code,reason) }）
 * @returns {typeof LoopbackSocket} 可 `new WS(url)` 的类（Net 用法）
 */
export function makeLoopbackClass(host) {
  return class LoopbackSocket {
    /** @param {string} url 仅作日志（'loopback:solo'） */
    constructor(url = 'loopback:solo') {
      this.url = String(url);
      this.readyState = 0;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this._ep = null;
      this._closed = false;
      // 异步 open：构造里绝不同步回调（Net 先 new、后挂 handler）
      Promise.resolve().then(() => this._open());
    }

    _open() {
      if (this._closed) return;
      const client = this;
      const ep = {
        readyState: 1,
        onmessage: null,
        onclose: null,
        /** 服务端 → 客户端：一个 JSON 文本帧，微任务投递（保证 onopen 先于首帧被消费方看到） */
        send: (text) => {
          if (client.readyState !== 1 || client._closed) return;
          Promise.resolve().then(() => client.onmessage?.({ data: String(text) }));
        },
        close: (code, reason) => client._close(code || 1000, reason || 'closed by host'),
      };
      this._ep = ep;
      // readyState=1 先于 host.open：host 若在 open() 里同步打招呼也不会丢
      this.readyState = 1;
      try {
        host.open(ep);
      } catch (err) {
        this.readyState = 0;
        this._close(1006, 'loopback host failed: ' + (err && err.message));
        return;
      }
      if (this._closed) return;
      this.onopen?.();
    }

    /** 客户端 → 服务端 */
    send(text) {
      if (this.readyState === 0) throw new Error('InvalidStateError: loopback socket not open');
      if (this.readyState !== 1) return;
      const ep = this._ep;
      if (!ep) return;
      const frame = String(text);
      Promise.resolve().then(() => ep.onmessage?.({ data: frame }));
    }

    close(code = 1000, reason = '') { this._close(code, reason); }

    _close(code, reason) {
      if (this._closed) return;
      this._closed = true;
      const c = code || 1000;
      const wasOpen = this.readyState === 1;
      const ep = this._ep;
      this.readyState = 3;
      this._ep = null;
      Promise.resolve().then(() => {
        if (wasOpen && ep) { try { host.close?.(ep, c, reason); } catch { /* ignore */ } }
        if (c !== 1000) this.onerror?.(new Error(reason || 'loopback closed'));
        this.onclose?.({ code: c, reason, wasClean: c === 1000 });
      });
    }
  };
}
