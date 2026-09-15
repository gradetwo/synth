# 节点参数 id 段：影响面量化与决策备忘（§一.11）

**状态**：已测完，**不建议重排编号**。护栏已加（Rust + TS 单测），不动任何 id、不动
`PARAM_COUNT`/ABI、关图模式逐位不变（本批未改任何 DSP 代码路径）。

**基线**：v2.1.4（`pid` 分支）。所有数字都来自真 wasm（`src/generated/synth_core.wasm`，
Node 直驱，无 AudioWorklet / AudioParam / Web Audio 图）与 Rust 单测。

**结论先行**：节点 id 段 `[101, 137)` 是**六个字段区间严丝合缝地铺满**的（相邻、两两不相交、
无空隙），每个 id 恰好被一个字段认领、且一定落在 `0..FX_SLOTS` 之内。**不存在编号重叠**，
`Params::set` 里的 `slot < FX_SLOTS` 是防御性守卫、没有真实 id 会走到。因此重排编号
**不改变任何行为**，只动红线，**不做**。

---

## 一、先纠正任务书里的算式：三个「撞号」例子都不成立

任务书（与 `docs/notes/oversampling.md` 末尾、`docs/NEXT-PLAN-2.md` §一.11 同源）写的是：

```
FX_NODE_OUT_GAIN + 1 == FX_DELAY_MIX
FX_NODE_TO_OUT  + 5 == FX_PARALLEL3
FX_NODE_IN1     + 5 == FX_EQ_ON
```

按 `crates/synth-core/src/params.rs` 里的实际常量逐条核对：

| 断言 | 左边 | 右边 | 结论 |
| :--- | ---: | ---: | :--- |
| `FX_NODE_OUT_GAIN + 1 == FX_DELAY_MIX` | 132 | 35 | **假**，差 97 |
| `FX_NODE_TO_OUT + 5 == FX_PARALLEL3` | 130 | 90 | **假**，差 40 |
| `FX_NODE_IN1 + 5 == FX_EQ_ON` | 106 | 157 | **假**，差 51 |

真正的算式是 `FX_NODE_OUT_GAIN + 6 == OSC_FM`（131+6=137）。132..136 **不是**
`OSC_FM`..`OSC1_SUB_LEVEL`，它们在 id 表里是**空缺号**：节点段占据 `[101, 137)`，
下一个有名字的参数就是 137。这已钉进 `params.rs` 的新测试
`node_block_does_not_shadow_any_ordinary_parameter`。

> 这条纠正很重要：它决定了「修它要不要动红线」。如果 132 真是 `OSC_FM`，那么任何
> 宿主写 `oscFm` 都会顺手改掉节点增益；实测不是。

## 二、逐 id 影响面表（authority = 代码 + 单测，不是推算）

`graph_param_field` 的判据是半开区间 `base <= id < base + FX_SLOTS`，六个 base 依次是
`101 / 107 / 113 / 119 / 125 / 131`，宽度都是 `FX_SLOTS = 6`：

```
[101,107) [107,113) [113,119) [119,125) [125,131) [131,137)
```

**相邻、两两不相交、完整铺满 `[101,137)`**（`107 = 101+6`、`113 = 107+6`、…）。
所以：

- 每个 id 恰好被**一个**字段认领，`(node, field)` 就是它名字说的那个；
- 不存在任何一个 id 被解成 slot ≥ 6；`131+6 = 137` 已经落出所有区间 ⇒ `None` ⇒
  走普通参数 `OSC_FM`；
- `Params::set` 里的 `slot < FX_SLOTS` 是**防御性**的，**没有真实 id 会走到那里**。

| id 段 | 字段 | 区间 | 宿主路径会误读？ | 实测行为 |
| :--- | :--- | :--- | :--- | :--- |
| 101..106 | NODE1..6 IN1 | `[101,107)` | 无 | 各自节点的 `node_in[slot][0].src` |
| 107..112 | NODE1..6 IN1 gain | `[107,113)` | 无 | 各自节点的 `node_in[slot][0].gain` |
| 113..118 | NODE1..6 IN2 | `[113,119)` | 无 | 各自节点的 `node_in[slot][1].src` |
| 119..124 | NODE1..6 IN2 gain | `[119,125)` | 无 | 各自节点的 `node_in[slot][1].gain` |
| 125..130 | NODE1..6 TO_OUT | `[125,131)` | 无 | 各自节点的 `node_to_out[slot]` |
| 131..136 | NODE1..6 OUT gain | `[131,137)` | 无 | 各自节点的 `node_out_gain[slot]` |

边界处最容易看错的两对（也是「不相交」的直接证据）：

| 边界 id | 它属于 | 相邻 id | 它属于 | 关系 |
| ---: | :--- | ---: | :--- | :--- |
| 106 | NODE6 IN1（`In1Src` slot 5） | 107 | NODE1 IN1 gain（`In1Gain` slot 0） | 两区间首尾相接，互不认领 |
| 112 | NODE6 IN1 gain | 113 | NODE1 IN2 | 同上 |
| 130 | NODE6 TO_OUT | 131 | NODE1 OUT gain | 同上 |
| 136 | NODE6 OUT gain | 137 | **不是节点**，是普通参数 `OSC_FM` | 段外，`graph_param_field` 返回 `None` |

**宿主路径逐条核对**（都只用手写/生成的**显式 id**，没有任何一条按区间猜节点）：

| 路径 | 实现 | 结论 |
| :--- | :--- | :--- |
| worklet 描述符表 | `src/audio/worklet-processor.js` 的 `PARAMS`（224 条，显式 id），每块把每个参数 `gs_set_param(PARAMS[i][1], values[0])` | 36 个 id 都在表里，值能到 DSP；无区间猜测 |
| JS store 读/写 | `src/state/store.ts` → `engine.setParam(id)` → `PARAM_NAMES[id]` → AudioParam | 按 id 直查，无猜测 |
| 全量推参数 | `src/audio/engine.ts` `applyState()` 遍历 `state.params` 的每个键 | 224 个 id 全推，含 36 个节点 id |
| 图→链镜像 | `src/audio/params.ts` `graphFromChain` / `GRAPH_FROM_CHAIN_IDS`（显式 id 数组） | 与引擎 `gs_fx_graph_sync` 一致 |
| 序列化 | `share.ts`（按 `DEFAULT_PARAMS` 键升序的**值数组** + 显式 id 顺序）、`patchfile.ts`、`preset-model.ts` | 值数组按 id 顺序编解码，往返无损 |
| mcp | `mcp/lib/patch.mjs` `paramPairs()`（按 id 升序的显式对）、`mcp/lib/render.mjs` 推全量 | 与 store 同形 |
| 门禁脚本 | `scripts/lib/render-core.mjs` 的手写 `P` 表（`FX_NODE_IN1: 101` / `FX_NODE_IN1_GAIN: 107` / `FX_NODE_TO_OUT: 125` / `FX_NODE_OUT_GAIN: 131`） | `verify-audio.mjs` 只驱动节点 1 |

## 三、那「宿主无法把 6 个节点全部清干净」是怎么来的？

**这条今天不成立**。可复现的权威证据是 Rust 状态级测试（`crates/synth-core/src/params.rs`
`mod tests`）：

```
cargo test --manifest-path crates/synth-core/Cargo.toml -- --test-threads=1 \
  node_block node_field_ids graph_node_ids_resolve every_node_field
test result: ok. 4 passed; 0 failed; 0 ignored
```

其中 `node_field_ids_write_their_own_state` 把**每个字段的 6 个节点**都写一遍
（值互不相同），逐个断言落到自己的槽位；`graph_node_ids_resolve_to_their_documented_field`
遍历 `[101, 137)` 全部 36 个 id，断言每个 id 的解码结果就是**唯一认领它的那个字段**，
且 `owner_slot < FX_SLOTS` 恒成立。

`docs/notes/oversampling.md` §「发现但未修的既存 bug」说的「JS 探针出现节点 2 读节点 1 的
双驱动（rms 是链的 2 倍）」——我们找不到可复现路径，且同一文件的有效章节给出的是**另一个**
根因：P9.4 的失败是**过采样往返补偿被算了两遍**（节点内部的 dry/wet 交叉淡化混了两份相隔
31 样本的信号，2× 的非谐波能量比 1× 高 ~25 dB），门禁读 −7.1 dB。该节记录的是「节点内部
对齐」，与本 §一.11 的编号无关。**两个症状被同一段笔记混在一起了**；而该段引用的三个算式
经复核也都不成立（见 §一）。

音频侧的差分探针在本机**不成立**，如实记录：本引擎对「写一个参数」这件事本身就有状态
（`Engine::set_param` 对连续参数会置 `smooth_set`；实测连续窗口之间、甚至**写同值**都会
产生 max|Δ| ≈ 0.15..1.8 的漂移），所以「清 6 个节点 → 测 rms」这类样本级对照在没有
同相位锚点时不可信。本批没有据此下任何断言；结论全部建立在 Rust 状态级测试上。

## 四、护栏：做了什么

**没有改任何 id、`PARAM_COUNT`、ABI、阈值或 DSP 路径**。新增的都是**断言**：

| 文件 | 测试 | 钉住什么 |
| :--- | :--- | :--- |
| `crates/synth-core/src/params.rs` | `node_block_does_not_shadow_any_ordinary_parameter` | 段是 `[101,137)`；`FX_GRAPH`(100) 与 `OSC_FM`(137) 都在段外；计划点名的 9 个普通参数**都不在**段内 |
| 同上 | `every_node_field_id_reaches_its_own_field` | 36/36 个节点 id 解码到**自己**的 `(node, field)` |
| 同上 | `graph_node_ids_resolve_to_their_documented_field` | 六区间首尾相接；逐 id 的「唯一认领」；`owner_slot < FX_SLOTS` 恒成立；`132..136` 是空缺号而非 `OSC_FM..OSC1_SUB_LEVEL` |
| 同上 | `node_field_ids_write_their_own_state` | 每个字段 6 个节点的写入落到自己的槽位；6 个 OUT gain id 对应 6 个互不相同的状态字；普通参数不受影响 |
| `src/audio/node-ids.test.ts`（新增） | 5 条 | JS 侧镜像：块连续、无普通参数 id 落入、`PARAM_NAMES`/`DEFAULT_PARAMS` 覆盖 36 个 id、id 助手不越界、`FX_NODE6_OUT_GAIN + 1 === OSC_FM` |

这几条的**否定断言**才是真正的护栏：将来任何人往 `[101,137)` 里插一个新的有名字参数
（或把节点段往右挪），都会在 CI 里立刻变红——这正是「宿主按 id 读参」这件事的护城河。

## 五、结论：要不要重排编号？

**不必要，而且没有收益。** 依据：

1. **重排不改变任何行为**。36 个 id 今天已经一一对应到正确的 `(node, field)`；把区间解码
   换成显式表（或换任一编号方案）不会让任何 id 的落点发生变化——**已有的编号是自洽的**，
   所谓「撞号」不存在。也就是说任务书的 (b) 没有功能收益。
2. **重排会动红线**。id 是 `.gs1proj` / 分享码 / 91 条工厂预设的线格式；把 `FX_NODE_*`
   移到别处意味着所有旧文件的节点字段会指到别的参数，必须同时写迁移（新旧 id 双读、
   写新 id），代价见下。
3. **真实的（放大的）风险是「未来」而不是「现在」**：节点段之外最近的普通参数是 137
   （`OSC_FM`），一旦有人把新参数追加到 `[101,137)` 里、或把节点段右移，就会真的撞上。
   现在护栏测试在，这种改动会在提交时被挡住。段内还空着 132..136 五个 id，扩字段也
   够用。

**如果将来仍要重排（备忘，未实现）**：

- 影响面：`crates/synth-core/src/params.rs`（`graph_param_field`、`PARAM_COUNT`、
  `is_continuous`、`set` 的 match 臂）、`src/audio/params.ts`（`Param`/`PARAM_NAMES`/
  `DEFAULT_PARAMS`/spec/`graphInId` 等 4 个助手）、`src/audio/worklet-processor.js`
  的 `PARAMS` 表（36 条）、`scripts/lib/render-core.mjs` 的 `P` 表、`mcp` 的 id 升序对、
  `GRAPH_FROM_CHAIN_IDS`。
- 迁移方案：新增 id 段 → `graph_param_field` 同时认旧段（只读）与新段（写），
  载入旧文件时把旧 id 值搬到新 id；导出只写新 id；`SCHEMA_VERSION` 提到下一版。
- 代价：一次「读旧写新」的兼容层 + 每个 `.gs1proj`/分享码/预设的往返测试 + 全部
  91 条指纹重录（**必然**会动 `verify:presets` 的数字，需要父代理确认后重录）。
  收益：0（见上）。结论：不做。

## 六、复现方式

```bash
# 权威结论（状态级）
cargo test --manifest-path crates/synth-core/Cargo.toml -- --test-threads=1 \
  node_block node_field_ids graph_node_ids_resolve every_node_field

# JS 侧镜像
npx vitest run src/audio/node-ids.test.ts
```
