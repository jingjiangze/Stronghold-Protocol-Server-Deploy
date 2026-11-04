// 测试用叠加层：与 alpha 重名 —— 叠加时必须报错，绝不静默覆盖
export class Mixin {
  rogueAlpha() { return 'dup'; }
}
