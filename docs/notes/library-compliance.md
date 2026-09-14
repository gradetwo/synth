# 内置曲库的来源与许可（P10.5）

本批的目标是让内置曲目**只有公版作品或本站原创编配**，并把来源与许可写在每首曲目上、
显示在播放器列表的每一行。下面是逐首判定与替换记录，供以后加曲目时对照。

## 判定规则

- **在版权保护期内的作品，无论多短都不留**：片段同样是衍生作品。
- 公版判定按「作者去世 ≥ 70 年」（欧盟/中国取较宽的通行标准）：本批保留与新增的
  作曲家最晚为 Erik Satie（1925 年去世，1996 年起公版）与 Edvard Grieg（1907 年去世）。
- 传统民谣（无特定作者、19 世纪前已在流传）按公版处理，但**不把原创作品冒充民谣**。
- 原创作品在 `source.kind` 里写 `original`，credit 写 `GS-1`（界面上的类型标签已经是「原创作品 / Original work」，credit 只是署名）。

## 移除的 9 首（在版权保护期内）

| id | 曲目 | 原署名 | 处理 |
| :--- | :--- | :--- | :--- |
| `mariage` | 梦中的婚礼 | P. de Senneville | 移除，替换为原创 `waltz` |
| `river` | River Flows in You | Yiruma | 移除，替换为原创 `drift` |
| `summer` | Summer | Joe Hisaishi | 移除，替换为公版 `can-can` |
| `croatian` | 克罗地亚狂想曲 | Tonči Huljić | 移除，替换为公版 `mountain-king` |
| `castle` | 天空之城 | Joe Hisaishi | 移除，替换为公版 `lullaby` |
| `mario` | 超级玛丽主题曲 | Koji Kondo | 移除，替换为公版 `sugar-plum` |
| `got` | 权力的游戏主题曲 | Ramin Djawadi | 移除，替换为原创 `toccata` |
| `butterfly` | 梁祝（选段） | He Zhanhao / Chen Gang | 移除，替换为原创 `highland-song` |
| `seashore` | 沧海一声笑 | James Wong | 移除，替换为公版 `scarborough` |

> **注意**：`croatian`（Tonči Huljić）与 `mario`（Koji Kondo）不在原任务书的 7 首清单里，
> 但同样明确在版权保护期内。本批一并移除并在报告里登记。

## 复核过的「民歌」署名

| id | 署名 | 结论 |
| :--- | :--- | :--- |
| `tetris` | Russian folk（Korobeiniki） | **公版**：1861 年收录于俄罗斯民歌集，旋律本身无在版权主张；仅具体录音/编曲有版权，本曲为项目自编。保留，credit 写明「俄罗斯民谣 Korobeiniki · Russian folk song」。 |
| `greensleeves` | Traditional English | **公版**：1580 年已在伦敦登记，旋律早于任何现代编曲。保留，credit 写明「英格兰传统民谣 · English folk song」。 |

## 保留的公版曲目

`elise`（Beethoven, WoO 59）、`canon`（Pachelbel）、`moonlight`（Beethoven, Op. 27 No. 2）、
`turkish`（Mozart, K. 331）、`jasmine`（中国民歌）、`joy`（Beethoven, Op. 125）、
`tetris`、`greensleeves`、`furelise-rock`（Beethoven 改编），以及练习曲
`scale` / `arpeggio`（原创）。

## 元数据与界面

`SongSpec.source = { kind: 'public-domain' | 'original' | 'user', credit, url? }`。
`Track.source` 由曲库携带并随存储往返；旧存储里没有该字段的曲目按 `user` 读取而不是丢弃，
`kind` 不认识的值也会被替换（`src/midi/library.test.ts` 有断言）。

播放器列表每行在作曲者/音符数/时长下面多一行 `.pt-source`，文案
`公版作品 · <credit>` / `原创作品 · <credit>` / `用户导入 · <文件名>`，
中英成对，键在 `src/i18n.library.ts`（本批自己的模块，`loadAllStrings()` 注册）。

## 用户导入

- `.mid` / `.midi`：沿用 `parseMidi`，成功进「导入」组并带上 `source.credit = 文件名`。
- `.gs1song` / `.gs1.json`：沿用 `parsePatchFile` + `store.importPresetFile`（分享码装在盒子里），
  损坏的码、非 JSON、以及「音色文件不是曲目」三种情况各自给出可见原因。
- 被拒绝的文件不会进入曲库（E2E `player.spec.ts` 的 “refuses a damaged file with a visible
  reason” 覆盖）。

## 按需加载

技术债第 7 条已实测「把 `songs.ts` 单独拆 chunk 是负收益」，因此本批**保持 eager**，
按验收线「首屏 JS 不增」记账：移除 9 首在版权曲目的谱面数据换进 9 首替换曲，
`dist/index-*.js` 与首屏 JS gzip 的实测前后数字见批次报告与提交信息。
