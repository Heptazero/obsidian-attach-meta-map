# Att Meta Map

把附件映射成一篇笔记，并且**只写你勾选的元数据**。

Fork 自 [Attachments Library](https://github.com/compadrejunior/attachments-library)（José Compadre Junior，MIT）。上游负责"自动建 sidecar 笔记"这件事，本 fork 改了三处：元数据可开关可改名、支持多组独立映射、命令补齐成能直接用的阅读布局。

## 和上游的差别

| | 上游 | 本 fork |
|---|---|---|
| 元数据 | 15 个字段写死 | 25 个字段，逐个开关 + 改属性名，默认只开 5 个 |
| 映射 | 一个附件夹 → 一个笔记夹 | 任意多组，每组独立的文件夹/扩展名/字段表/链接格式 |
| 笔记名 | `a.pdf.md` | 模板可配，默认 `a.md`；撞名时自动退回带扩展名 |
| 链接 | 写死全路径 `[[dir/a.pdf]]` | 模板可配，默认 `[[a]]` |
| 重新抽取 | 没有 | 有，左右两列对比，逐行二选一 |
| 打开 | 没有 | 附件在中间、笔记钉在右侧栏，双向可触发 |
| DOI/ISBN | 有开关，没接线 | 真的接上了（见下） |

## 字段表

字段分四类，设置里分区显示：

- **vault 侧**：附件链接、路径、文件名、类型、大小、创建/修改日期
- **PDF 侧**：标题、作者、主题、关键词、PDF 内记录的创建/修改日期、creator、producer、页数
- **联网查询**：DOI、ISBN、标题、作者、年份
- **手填占位**：status、genre、source、notes（可以设默认值）

默认只开 `attachment` / `title` / `author` / `created` / `updated` 五个。

每个字段可以改属性名，所以 `author` 可以改成 `by`、`lookupYear` 改成 `year`，直接对齐库里已有的 frontmatter 约定。**两个字段可以共用一个属性名**：`title` 默认同时是 PDF 标题和 CrossRef 标题的落点，按目录顺序先非空者胜——PDF 自带标题时不会被联网结果覆盖。

## 多组

一组 = 一个附件夹 → 一个笔记夹，外加这一组自己的扩展名、命名模板、链接格式、字段表。

组可以嵌套（`70_research/PDF` 在 `70_research` 里面），**最长前缀的组胜出**。位于任何一组附件夹内部的 md 文件不会被当成笔记。

## 命令

| 命令 | 作用 |
|---|---|
| Open pair | 附件在主编辑区打开，笔记钉在右侧栏。没有笔记就先建。从附件或从笔记触发都行 |
| Refresh metadata | 重新抽取，弹出对比表：每行「当前值 / 抽取值」二选一，没选中的行原样不动 |
| Create note | 给当前附件建笔记 |
| Backfill | 给所有组补齐缺失的笔记 |

对比表的默认勾选规则：笔记里该属性为空 → 默认选新值；已经有内容 → 默认保留当前值；新值为空 → 绝不建议覆盖。

## DOI / ISBN

上游导出了 `lookupDoi` / `lookupIsbn` 但从没调用。这里接上了：先在文件名和 PDF 自带元数据里找 DOI/ISBN 正则，找不到再尝试读前两页正文——**前两页那步依赖 Obsidian 自带的 pdf.js（`window.pdfjsLib`），拿不到就静默跳过**，只用元数据。命中后查 CrossRef（DOI）或 Open Library（ISBN），填标题、作者、年份。

默认关闭，因为它联网。

## 安全边界

- 只写你勾选的属性，笔记里其他 frontmatter 一律不动。
- 建笔记时目标路径已被别的附件占用 → 退回 `a.pdf.md`，不覆盖。
- `.base` 文件已存在就不重写。
- 删除笔记走 `trashFile`，跟随 Obsidian 的删除设置。

## 开发

```bash
npm install
npm run build      # tsc --noEmit + esbuild
npm test
npm run lint
```

`src/fields.ts` 和 `src/paths.ts` 是纯逻辑，测试集中在这两处。

## 许可

MIT，见 [LICENSE](LICENSE)。上游版权归 José Compadre Junior。
