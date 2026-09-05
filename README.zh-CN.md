# Att Meta Map

[English](./README.md)

Att Meta Map 把 Obsidian 中的资源集合映射成索引笔记。模型只有一句话：**`source` 决定关系，模板决定字段，映射决定其他值从哪来。**

Fork 自 [Attachments Library](https://github.com/compadrejunior/attachments-library)（José Compadre Junior，MIT）。

## 功能

### 只保留一种明确关系

每篇受管理的笔记都有固定的 `source` 属性，值可以是一个双链，也可以是双链列表。只有它能决定哪些资源属于这篇笔记。

- 同名、同目录和相同文件尺寸都不会自行形成已有关系。
- 一篇笔记可以同时关联原始 PDF、译本、幻灯片、数据或其他附属资料。
- 从笔记或任意已关联资源执行“成对打开”，都会在左侧打开资源，并在右侧复用同一个笔记标签页。
- “资源关系”侧栏逐项列出 `source`，可以打开或明确解绑。解绑永远不会删除文件。

### 选择 sidecar 或 folder 布局

- **Sidecar**：资源和笔记分别位于两个根目录。资源原地不动，笔记可以镜像资源的子文件夹结构。
- **Folder**：只使用一个集合根目录，并选择附件所在的精确层级。根目录直接文件是 `0` 级，下一层是 `1` 级，依此类推。

Folder 的 `0` 级会把散落资源折叠进新条目文件夹，并在启用时创建同目录笔记。`1` 级及以上把当前父目录视为最终条目文件夹，只在原地创建笔记，绝不再嵌套一层。

Folder 组可以配置多个附属文件前缀，例如 `cn_`、`zh_`、`slides_`。去掉前缀后与已有条目同名的文件会加入那个条目文件夹，并追加到笔记的 `source` 列表。

### 让模板控制元数据

每组选择一篇 Markdown 模板。模板 frontmatter 的键就是这组笔记的字段白名单；全局映射表决定每个键可以从哪里取得值。

可用来源包括：

- 库和文件：路径、名称、后缀、大小、日期，以及从文件名解析出的年份和标题
- PDF 元数据：标题、作者、主题、关键词、日期、creator、producer 和页数
- 可选联网查询：DOI 或 ISBN、标题、作者和年份

多个来源可以映射到同一属性。目录顺序中第一个非空值胜出，因此已有文件名或 PDF 元数据不会被后面的联网结果覆盖。重新抽取时会并排显示当前值和新值，只写入明确选中的行。

### 用有序规则整理组外附件

附件规则只处理所有映射组资源根目录之外的文件，可以移动并重命名附件。

- 规则从上到下执行，第一条命中后停止。
- 同一栏多个值是“或”，不同栏是“且”，排除栏是“非”，留空表示不限。
- 原始文件夹和后缀都能从当前库中模糊选择。
- 命名支持 `{{basename}}`、`{{parent}}`、`{{note}}` 和 `{{index}}`。
- `{{index}}` 每次根据完整目标快照取最小可用正整数，因此现有 `1、82` 可以重排成 `1、2`。

映射组资源根目录是硬保护区，通用规则永远不会触碰已经属于某组的文件。规则目前只手动运行，而且确认前一定展示完整变化树。

## 安装

### Obsidian 社区插件

Att Meta Map 通过 Obsidian 社区目录审核后，可以从“设置 → 第三方插件 → 浏览”直接安装。

### BRAT 或手动安装

审核完成前，可以在 [BRAT](https://obsidian.md/plugins?id=obsidian42-brat) 中添加 `Heptazero/obsidian-attach-meta-map`，或从[最新 Release](https://github.com/Heptazero/obsidian-attach-meta-map/releases/latest)下载 `main.js`、`manifest.json`、`styles.css`，放入：

```text
<vault>/.obsidian/plugins/att-meta-map/
```

然后重新加载 Obsidian，并在“第三方插件”里启用 **Att Meta Map**。

## 快速开始

1. 打开“设置 → Att Meta Map”，选择中文、English 或“跟随 Obsidian”。
2. 新建映射组，选择 **Sidecar** 或 **Folder**。
3. 设置资源文件夹、模板、监听后缀和创建行为。
4. 右键一个资源，执行“成对打开”。如果还没有笔记，插件会按该组规则创建相应笔记或文件夹。
5. 大批量补齐前检查完整的红绿文件夹树，只有每个目标都正确时才确认。

## 关系模型

模型有三条规则：

1. **`source` 是固定关系字段**，不属于可配置元数据映射。
2. **模板决定有哪些元数据字段**。往模板 frontmatter 增加一个键，就等于为这一组启用该字段。
3. **全局映射决定值从哪里来**。即使配置了“PDF 作者 → author”，模板里没有 `author` 时也不会写入。

因此模板本身就是字段开关。Att Meta Map 始终维护 `source`；其他属性必须同时得到模板和映射表认可。

## 布局细节

### Sidecar

Sidecar 组分别配置资源根目录和笔记根目录。映射功能永远不会移动资源；笔记可以镜像资源子目录，也可以保持扁平。

### Folder

Folder 组只配置一个集合根目录和附件精确层级。

- `0` 级：创建条目文件夹、搬入附件，并按设置决定是否创建笔记。
- `1+` 级：当前父目录已经是条目文件夹；只在资源旁创建笔记，不移动资源。
- 更浅或更深的文件都被忽略，不猜测它属于这一组。
- 文件夹可以自由改名，因为目录名称不参与关系判断。

如果只要文件夹整理，不需要索引笔记，可以关闭“为新附件建笔记”。`0` 级仍会创建条目文件夹，但该组不再运行模板、元数据抽取和笔记维护。

## 模板和映射

Att Meta Map 会自动发现 Templater 的 `templates_folder` 和核心 Templates 插件目录，设置里还可以添加额外模板文件夹。

模板正文会复制到新笔记。`type: paper`、`status: active` 等模板自带值原样保留。Templater 的 `<% ... %>` 块不会执行，而是被移除，因为 `tp.file.move()` 一类命令可能把新笔记移出映射边界。需要动态行为时，可以创建后手动运行 Templater。

没有选择模板时，插件使用内置最小字段：`source`、`title`、`author`、`created`、`updated`，并省略空值。

笔记名和链接模板支持：

- `{{basename}}`、`{{name}}`、`{{ext}}`、`{{path}}`、`{{folder}}`
- 从常见“作者 - 年份 - 标题”文件名解析的 `{{year}}` 和 `{{title}}`

如果笔记名模板要求 `{{year}}`，但文件名没有年份，整个模板会退回安全文件名，不生成残缺名称。插件也会自动修正有歧义的无后缀链接，避免 `[[paper]]` 指向 `paper.md` 而不是 `paper.pdf`。

## 命令和文件菜单

| 命令 | 作用 |
|---|---|
| 成对打开 | 左侧打开资源，右侧复用一个笔记标签；允许时创建缺失笔记 |
| 重新抽取元数据 | 并排显示当前值和抽取值，只应用选中的行 |
| 解绑当前资源 | 确认后移除选中的 `source`，不移动或删除文件 |
| 打开资源关系面板 | 在侧栏列出当前笔记或资源的全部 `source` |
| 补齐缺失的笔记 | 扫描所有组，完整预览移动、建笔记和写入 `source` 后再执行 |
| 按规则整理当前笔记的附件 | 对活动笔记链接的组外附件应用通用规则 |

文件菜单还可以整理当前笔记的附件、单个附件、一个文件夹或递归文件夹。所有入口共用同一套规划器、预览和受保护执行器。

变化预览里，红色 `−` 表示文件将离开旧路径，不代表删除；绿色 `+` 表示新路径、新笔记或 `source` 值将出现。取消时零写入。

## 自动触发和安全边界

插件启用期间，映射组常驻监听 `create`、`rename` 和 `modify`。脚本、同步工具和 Git 带来的文件变化，也可能触发与 Obsidian 内操作相同的事件。通用附件规则不注册自动监听。

Att Meta Map 不监听 `delete`，也永远不会自动删除笔记。资源消失后，笔记和可检查的 `source` 断链都会保留。

其他边界：

- 只写模板和映射表共同认可的属性。
- 修改时间同步只更新笔记已经存在的属性。
- 目标笔记名被占用时退回带扩展名的名字，绝不覆盖已有文件。
- 批量移动使用执行前快照和临时名。预览后状态变化时整批拒绝；移动失败时尝试恢复原路径。
- Folder 只移动 `0` 级资源，并标记插件自己的移动，避免 rename 监听再次处理。

外部修改 `data.json` 后，正在运行的插件不会立刻重新加载。请禁用再启用插件、执行“View → Force Reload”，或重启 Obsidian。

## 语言和架构

界面可以跟随 Obsidian，也可以直接切换中文或 English。翻译按消息键集中保存在 `src/i18n/locales/en.json` 和 `src/i18n/locales/zh.json`，界面代码没有散落的中英文副本。

实现把确定性规则与 Obsidian 文件写入分开：

- `settings-model.ts` 负责默认值和持久设置规范化。
- `sources.ts` 解析元数据，`metadata-types.ts` 保存共享数据模型。
- `metadata-diff.ts` 定义刷新和安全补值规则，不依赖任何弹窗。
- `paths.ts` 负责确定性的目录、命名和链接策略。
- `creation-plan.ts` 定义可预览的笔记和文件夹变化。
- `attachment-rules.ts` 规划通用附件移动，`attachment-organizer.ts` 执行已确认计划。
- `note-manager.ts` 是面向 Obsidian 的服务，负责解析关系和执行受保护的笔记操作。

## 开发

```bash
npm install
npm run pipeline
```

流水线依次运行 Obsidian lint、带覆盖率的单元测试、TypeScript 检查和生产构建。Obsidian Release 包含 `main.js`、`manifest.json`、`styles.css`。

问题和贡献请提交到 [GitHub 仓库](https://github.com/Heptazero/obsidian-attach-meta-map)。

## 许可

MIT，见 [LICENSE](LICENSE)。上游 Attachments Library 版权归 José Compadre Junior。
