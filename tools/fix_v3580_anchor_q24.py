#!/usr/bin/env python3
"""fix_v3580_anchor_q24.py — [v3.58.0 · 计划 O5] 把 v3450 的 I24 破坏锚点从**死码**改到活机制。

【治的是什么】v3450 的 I24 本来是「破坏『写了没成要报』⇒ 行为判据必须转红」，锚点取的是：

        } catch (e) {
            return false;
        }

在 `ArchiveApp._writeJSON` 里，这一对本来是**唯一**能让 `saved` 变假的机制（旧实现自带
`try { this.storage.set(...); return true; } catch { return false; }`），所以拿它当锚点是对的。

O5 把写体换成唯一实现 `writeReceipt(...).saved === true` 之后，**抛错在 writeReceipt 内部
就被收成 `write_threw` 了**（它自己带 try/catch），外层那对 `catch { return false }` 于是
成了**不可达的死码**。破坏它当然什么也不改变 —— 判据不报 `write-failure-pretended-ok`。
这不是「判据漏了」，是**锚点漂到了死码上**：破坏表必须落在活机制上才有证明力。

【改法】锚点换成同一格的真机制：把回执判定抹成无条件成功——
    `return writeReceipt(...).saved === true;`  →  `return true;`
破坏后 `saved` 恒真，判据必须报 `write-failure-pretended-ok`（且不再依赖外层 catch）。

【用法】
    python3 tools/fix_v3580_anchor_q24.py            # dry-run
    python3 tools/fix_v3580_anchor_q24.py --write    # 落盘
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = 'tests/system-v3450.test.mjs'

NL = '+ NL +'
OLD = ("    q24: [AR_APP,\n"
       "        '        } catch (e) {' + NL + '            return false;' + NL + '        }',\n"
       "        '        } catch (e) {' + NL + '            return true;' + NL + '        }'],\n")
NEW = ("    q24: [AR_APP,\n"
       "        /* [v3.58.0 · 计划 O5] 原锚点取的是 _writeJSON 里那对 catch{return false} ——\n"
       "         *   O5 之后抛错在 writeReceipt 内部就收成 write_threw 了，那对成了**死码**，\n"
       "         *   破坏它什么也不改（判据当然不响）。锚点改到同一格的活机制：把回执判定\n"
       "         *   抹成无条件成功。 */\n"
       "        \"            return writeReceipt(this.storage, key, JSON.stringify(value)).saved === true;\",\n"
       "        '            return true;'],\n")


def main():
    write = '--write' in sys.argv
    path = os.path.join(ROOT, TARGET)
    with open(path, encoding='utf-8') as fh:
        src = fh.read()
    n = src.count(OLD)
    if n != 1:
        print('BAD   %s 锚点命中 %d 次（应 1）' % (TARGET, n))
        sys.exit(1)
    out = src.replace(OLD, NEW, 1)
    if write:
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(out)
        print('WRITE %s' % TARGET)
    else:
        print('DRY   %s（未写入，加 --write 落盘）' % TARGET)


if __name__ == '__main__':
    main()