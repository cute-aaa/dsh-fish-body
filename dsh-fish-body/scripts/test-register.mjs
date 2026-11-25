/**
 * 测试入口预载：把 test-ts-resolver 注册成模块解析钩子，并把数据根隔离到临时目录。
 *
 * 隔离是硬性要求：部分宿主模块在 import 期就会按 `DSH_HOME` / `DSH_PET_USER_ROOT`
 * 解析数据根，若沿用机器上真实的值，跑一次 `npm test` 就可能读到（甚至写到）
 * 使用者的 `$DSH_HOME/fish-body`。
 *
 * 只做两件事，且都在任何业务模块加载之前完成：
 *   1. `DSH_HOME` 指向本进程独占的临时目录；
 *   2. 删掉继承来的 `DSH_PET_USER_ROOT`——它优先级高于 `DSH_HOME`，留着就会盖过
 *      上面的隔离。**不要在这里自己设 `DSH_PET_USER_ROOT`**：单测通常靠各自设置
 *      该变量来准备夹具，预载层一旦占了它，测试自己的设定就失效了。
 *
 * 除这两个环境变量外，本模块不改解析策略、不注入其它全局。
 * 由 package.json 的 test 脚本以 --import 引入，仅对测试进程生效。
 * @module dsh-fish-body/scripts/test-register
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'node:module';

/** 本进程独占的临时 DSH 主目录（数据根 = `<它>/fish-body`）。 */
const TEST_HOME = mkdtempSync(join(tmpdir(), 'dsh-pet-test-'));

process.env.DSH_HOME = TEST_HOME;
delete process.env.DSH_PET_USER_ROOT;

register('./test-ts-resolver.mjs', import.meta.url);
