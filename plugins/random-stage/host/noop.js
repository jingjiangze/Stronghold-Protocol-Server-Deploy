// plugins/random-stage/host/noop.js
// trusted 桥接要求 entry.server 导出 activate(api)；本插件只提供 code.lobby 钩子，没有服务端 RPC。
export async function activate() {}
