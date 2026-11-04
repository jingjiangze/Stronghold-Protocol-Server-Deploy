# kits-ave-mujica

从 Forge 工坊包导入的 script 插件。导入器不执行包里的脚本，也不检查官方素材。

- sim/index.js 是包里 kits/ 的行为脚本合成的一个入口：每个 Forge 文件一个作用域，import 改成 sp:sdk@1。导入时没有执行它。
- 它只在服主设置 SP_PLUGIN_SCRIPTS=sandbox（或 trusted / trusted-force，并在 plugins/config.json 写锁文件哈希、每位玩家同意）并且房间选中它时运行。
- 改了任何文件都要重新 pack：沙箱只运行锁文件和文件一致的脚本插件。

详细对照见同一次导入的 IMPORT-REPORT.md。界面骨架要手改成 postMessage API v1。
