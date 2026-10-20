<div align="center">

# 稿纸 Gaozhi

**在网页稿纸上书写，誊抄前预览每个字的占格、换行与分页。**

![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Tested with Playwright](https://img.shields.io/badge/tested%20with-Playwright-2EAD33?logo=playwright&logoColor=white)

</div>

## 简介

手写稿纸时，标点能否放在行首、一段话会占几行、正文会写到第几页，往往要写到纸上才知道。稿纸 Gaozhi 把这些规则放进一张网页稿纸：文字输入后立即排进格子，誊抄前即可确认每个字在纸上的位置。

应用完全在浏览器中运行，不需要账号，文稿不会上传到任何服务器。

## 功能

- **直接在稿纸上书写**：点击任意位置定位光标，支持中文输入法、粘贴、选择、撤销与重做。
- **任意空格书写**：点击段尾或下方的空白格子即可在该格落字，中间的空格自动以全角空格补齐。
- **标点规则**：行末标点可选择悬挂于格外或严格占格；开引号、开括号不落在行末；省略号与破折号占两格。
- **增删页面**：可在末尾添加空白稿纸并直接在其中书写；没有文字的末尾页面可以删除，空白页同样会被打印。
- **数字与字母**：连续的半角数字和英文字母可两个一格。
- **稿纸设置**：可调整每行格数、每页行数、格子大小、行间距、预览字体（楷体 / 宋体）与格线颜色。
- **实时统计**：显示字数、总页数及光标所在的页、行、格。
- **本地保存**：自动保存在当前浏览器；支持导出 JSON 备份与纯文本，并可重新导入。
- **打印输出**：可直接打印，或通过浏览器另存为 PDF，每张稿纸对应一页 A4。

所有段落从每行第一格排起。段首缩进、标题居中、落款靠右等留白，由书写者自行输入空格控制。

## 快速开始

### 环境要求

- Node.js 20.19 及以上（20.x），或 22.12 及以上
- npm

### 安装与运行

```bash
git clone https://github.com/Whe-Long/gaozhi.git
cd gaozhi
npm install
npm run dev
```

启动后在浏览器访问 <http://127.0.0.1:5173>。

### 打印

点击右上角「打印 / PDF」，在打印设置中选择 A4 纸张、100% 缩放，并关闭浏览器自带的页眉页脚。

## 开发

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器，修改代码后自动刷新 |
| `npm run build` | 类型检查并构建生产版本至 `dist/` |
| `npm run preview` | 本地预览构建结果 |
| `npm test` | 运行单元测试（Vitest） |
| `npm run test:coverage` | 运行单元测试并生成覆盖率报告，低于 80% 时失败 |
| `npm run test:e2e` | 运行端到端测试（Playwright） |

首次运行端到端测试前，需下载测试用浏览器：

```bash
npx playwright install chromium
```

### 项目结构

```
gaozhi/
├── public/              静态资源
├── src/
│   ├── layout.ts        排版引擎：分格、标点处理、分页与点击定位
│   ├── model.ts         文稿与稿纸设置的数据结构及校验
│   ├── storage.ts       本地草稿的读取与损坏恢复
│   ├── App.tsx          界面与编辑交互
│   ├── main.tsx         应用入口
│   └── *.test.ts        单元测试
└── tests/e2e/           端到端测试
```

排版引擎是不依赖界面的纯函数：相同的文字与设置总是得到相同的分行和分页，缩放显示不会改变字所在的格子。

## 数据与隐私

- 文稿保存在浏览器的本地存储（localStorage）中，不会离开你的设备。
- 清除浏览器数据会删除草稿。更换设备或浏览器前，请通过「导出 → 稿纸备份」保存 JSON 文件。
- 若本地草稿损坏无法读取，原始内容会另行保留，可在「导出」菜单中下载。

## 浏览器支持

自动化测试在 Chromium 上运行。Safari 与 Firefox 尚未系统测试，中文输入法的组字行为在不同浏览器间可能存在差异。
