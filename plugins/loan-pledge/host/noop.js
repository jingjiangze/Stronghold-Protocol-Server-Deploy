// 占位：本插件不挂 trusted 运行时钩子，对局行为由 code.match 的包装器提供。
export {};
// trusted 桥接要求 activate(api)（server/plugins/trustedEntry.js）：本插件没有服务端逻辑，故为空实现。
export async function activate() {}
