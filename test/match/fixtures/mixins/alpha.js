// 测试用叠加层：只加一个方法（server/match/host/mixins.js 的 applyMatchMixins 会把它拷到对局类原型上）
export class Mixin {
  rogueAlpha() { return `alpha:${this.tag || ''}`; }
}
