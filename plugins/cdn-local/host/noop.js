// plugins/cdn-local/host/noop.js
// trusted 桥接要求 entry.server 导出 activate(api)；本插件没有服务端 RPC，只有 HTTP 静态层的一个工厂。
export async function activate() {}
