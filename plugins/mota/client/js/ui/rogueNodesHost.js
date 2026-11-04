// plugins/mota/client/js/ui/rogueNodesHost.js — 宿主 shim：把插件贡献的节点图浮层挂进对局页。
//
// 为什么不直接 static import 插件模块：插件可能没装（非肉鸽部署），static import 404 会让
// 整个 game.js 模块图失败。这里用动态 import + catch：插件在就渲染，不在就什么都不做。
// 插件的模块路径由 clientOverlay 顶替：plugins/rogue-ui/client/js/ui/rogueNodes.js → /js/ui/rogueNodes.js。

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';

export function RogueNodesHost({ pub }) {
  const [Comp, setComp] = useState(null);
  useEffect(() => {
    let dead = false;
    import('/js/ui/rogueNodes.js').then((m) => {
      if (!dead && typeof m?.RogueNodes === 'function') setComp(() => m.RogueNodes);
    }).catch(() => { /* 插件未安装：静默跳过 */ });
    return () => { dead = true; };
  }, []);
  return Comp ? html`<${Comp} pub=${pub} />` : null;
}
