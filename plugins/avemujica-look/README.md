# ave-mujica-look

从 Forge 工坊包导入的 cosmetic 插件。导入器不执行包里的脚本，也不检查官方素材。

- 素材在 assets.json 指向的文件里。
- Spine 的剪辑由 pack 写入 plugin.lock.json，不要手写 anims。

详细对照见同一次导入的 IMPORT-REPORT.md。界面骨架要手改成 postMessage API v1。
