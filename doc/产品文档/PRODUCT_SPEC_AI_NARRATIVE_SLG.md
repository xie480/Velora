# AI 驱动的结构化剧情 SLG / VN 平台产品文档

> 文档类型：Product + Game Design + Technical Design  
> 工作代号：Project Chronicle  
> 版本：v0.1  
> 状态：概念验证 / MVP 设计阶段  
> 核心定位：将作者提供的故事大纲、人物、世界观和创作约束，自动“编译”为一个结构化、可验证、可存档、可攻略、具有多分支多结局和 SLG 系统的完整游戏。

---

# 1. 产品摘要

## 1.1 一句话定义

Project Chronicle 是一个 **AI-native Narrative Game Compiler**。

用户不是在游戏过程中和一个无限续写的 AI 聊天，而是先提供：

- 故事大纲
- 世界观
- 时代背景
- 角色设定
- 人物关系
- 核心冲突
- 必须发生的事件
- 禁止发生的事件
- 期望结局类型
- 风格和篇幅要求

系统通过 AI 将这些信息扩展、结构化并编译为一个完整的剧情 SLG / VN 游戏：

- 多章节
- 多角色
- 多地点
- 时间推进
- 人物属性
- 好感、信任、怀疑、压力等状态
- 道具
- 场景互动
- 人物互动
- 手机聊天 / 邮件 / 论坛 / 社交媒体 / 公告板等信息系统
- 多分支
- 隐藏选项
- 前置条件
- Bad End / Normal End / Happy End / True End / Secret End
- 存档 / 读档
- 路线收集
- 结局图鉴
- 分支树 / 路线图
- 二周目解锁
- 自动一致性验证

游戏在“构建阶段”大量使用 AI，在“运行阶段”尽可能使用确定性的游戏逻辑。

---

# 2. 产品愿景

## 2.1 核心目标

让一个拥有故事创意但没有能力手工编写几十万到数百万字剧情、维护数千变量、设计数百分支的创作者，可以通过：

**人类创意 + AI 内容扩展 + 程序化规则验证**

制作出传统团队才可能完成的大型剧情 SLG。

产品最终希望做到：

> 作者负责决定“这个故事为什么值得存在”，AI 负责把它扩展成足够大的游戏内容，程序负责保证游戏逻辑不崩。

---

## 2.2 产品不是什么

本项目明确不做：

1. 通用 AI 世界模拟引擎
2. AI 助手 / 日常工具
3. 纯聊天型 Character AI
4. AI Dungeon 式无限续写
5. “玩家说一句，模型临时编一句”的完全实时剧情
6. 单纯 AI 小说生成器
7. 单纯 Ren'Py 文本生成工具
8. 只负责生成剧本、不维护状态的 AI 写作工具

---

# 3. 产品核心原则

## 3.1 AI 不是真相源

AI 负责：

- 提案
- 扩写
- 文学表达
- 内容变体
- 人物语言风格
- 场景细节
- 剧情设计建议
- 游戏机制建议

程序负责：

- 世界真实状态
- 人物属性
- 玩家属性
- 时间
- 道具
- 地点
- 已发生事件
- 人物知道什么
- 人物不知道什么
- 选项能否出现
- 某结局能否达成
- 存档
- 读档
- 路线可达性
- 规则验证

原则：

> LLM 可以描述事实，但不能私自创建或修改 Canon。

---

## 3.2 内容与状态分离

正文不是状态。

错误设计：

```text
“因为玩家第三章帮助过 Alice，所以 Alice 现在相信玩家。”
```

这句话本身不能作为游戏逻辑。

正确设计：

```yaml
state:
  alice.trust: 72
  flags:
    helped_alice_ch3: true
```

文本只是状态的一种表现形式。

---

## 3.3 长篇不依赖超长上下文

即使游戏已经达到：

- 100 个章节
- 3000 个 Scene
- 100 万字
- 30 个角色
- 50 个结局

也不应该把全部内容重新塞给模型。

每次生成只加载：

- 当前任务
- 当前 Scene Spec
- 当前角色 Canon
- 相关人物关系
- 当前世界状态
- 与该场景相关的历史事件
- 最近短期上下文
- 必须遵守的全局约束

---

## 3.4 先结构，后正文

不允许直接：

```text
“请写一个 100 章的大型恋爱悬疑游戏。”
```

生成过程必须分层：

```text
Story Bible
→ Narrative Architecture
→ Ending Design
→ Story Arc
→ Chapter
→ Scene
→ Beat
→ Choice / Condition / Effect
→ Dialogue / Narration
→ Validation
→ Freeze
```

---

## 3.5 先设计结局，再反推路线

系统默认使用 Ending-First Narrative Planning。

顺序：

```text
结局目标
→ 结局条件
→ 必需 Flag / 属性 / 道具
→ 必需剧情 Beat
→ 必需分支
→ 前置章节
→ 起点
```

这样确保：

- 结局不是随机生成
- 每条路线都有逻辑
- 隐藏条件有来源
- 二周目攻略有意义
- True End 可以被严格验证

---

# 4. 目标用户

## 4.1 核心用户

### A. 独立视觉小说作者

有：

- 人物
- 世界观
- 大纲
- CP
- 核心冲突

但没有资源写 50 万～200 万字。

### B. 独立游戏开发者

擅长：

- 程序
- 美术
- 游戏设计

但缺：

- 编剧团队
- 分支剧情制作能力

### C. TRPG / 同人 / OC 创作者

已有：

- 世界观
- OC
- 人物关系

希望将设定变成一个可玩的游戏。

### D. 玩家型创作者

希望：

> “给我一个故事设定，我自己生成一个可以玩几十小时的游戏。”

---

# 5. 核心用户体验

完整流程：

```text
创建项目
↓
填写故事设定
↓
AI 分析 Story Bible
↓
AI 提出游戏设计
↓
作者确认 / 修改
↓
生成 Ending Architecture
↓
生成 Narrative Graph
↓
生成 SLG Systems
↓
生成 Character Models
↓
生成 Chapter / Scene
↓
生成正文 / 对话 / 手机 / 论坛等内容
↓
自动验证
↓
生成 Game Build
↓
试玩
↓
调试 / 修改 / 局部重新生成
↓
发布
```

---

# 6. 项目创建阶段

## 6.1 基础输入

用户需要填写：

### 项目信息

```yaml
title:
genre:
sub_genres:
target_rating:
target_playtime:
target_word_count:
target_endings:
language:
```

### 世界观

```yaml
world:
  era:
  location:
  technology_level:
  political_background:
  social_structure:
  supernatural_rules:
  taboo:
  everyday_life:
```

### 故事主题

```yaml
themes:
  primary:
  secondary:
  emotional_goal:
```

例如：

```yaml
themes:
  primary:
    - trust
    - memory
  secondary:
    - family
    - betrayal
  emotional_goal:
    - bittersweet
    - suspenseful
```

---

## 6.2 故事大纲

允许：

- 自由文本
- Markdown
- 分章节大纲
- 导入已有小说 / 剧本
- 多文档 Story Bible

结构化后形成：

```yaml
story:
  premise:
  protagonist_goal:
  core_conflict:
  inciting_incident:
  midpoint:
  climax:
  resolution:
```

---

# 7. Story Bible

Story Bible 是整个游戏的 Canon 根节点。

任何后续 AI 生成都必须遵守。

建议结构：

```yaml
story_bible:
  world:
  timeline:
  characters:
  factions:
  locations:
  rules:
  themes:
  forbidden_content:
  immutable_facts:
  unresolved_mysteries:
```

---

# 8. 人物系统

## 8.1 Character Canon

每个角色必须拥有不可随意修改的 Canon。

```yaml
character:
  id:
  name:
  age:
  gender:
  occupation:
  role:
  appearance:
  background:
  family:
  education:
  secrets:
  fears:
  desires:
  weaknesses:
  values:
```

---

## 8.2 Character Personality Model

不能只写：

```text
“高冷、傲娇、聪明”
```

需要结构化：

```yaml
personality:
  openness: 0.4
  conscientiousness: 0.9
  extraversion: 0.2
  agreeableness: 0.3
  neuroticism: 0.55

  traits:
    - rational
    - guarded
    - observant

  conflict_style:
    - becomes_cold
    - attacks_logical_inconsistency

  affection_style:
    - remembers_small_details
    - acts_instead_of_speaks

  stress_behavior:
    - becomes_more_formal
```

---

## 8.3 Character Voice Model

```yaml
voice:
  sentence_length:
    short: 0.65
    medium: 0.30
    long: 0.05

  emotional_expression:
    direct: 0.15
    indirect: 0.85

  humor:
    type: dry
    frequency: low

  vocabulary:
    complexity: medium

  punctuation:
    ellipsis: medium
    exclamation: very_low

  never_says:
    - "嘿嘿"
    - "人家"
    - "超开心！"

  verbal_patterns:
    - "……所以呢？"
    - "你到底想说什么？"
```

---

## 8.4 Canonical Dialogue

每个角色保存一定数量的标准台词：

```yaml
canonical_dialogues:
  neutral:
  angry:
  embarrassed:
  affectionate:
  stressed:
  suspicious:
```

用于：

- Few-shot
- 风格验证
- Character Distinctiveness 测试

---

# 9. 人物状态

Canon 相对稳定。

Character State 随游戏变化。

例如：

```yaml
character_state:
  alice:
    affection: 61
    trust: 72
    suspicion: 18
    stress: 50
    jealousy: 5
```

不同角色不需要拥有相同属性。

例如：

Alice：

```yaml
stats:
  affection:
  trust:
  suspicion:
  stress:
```

Yuki：

```yaml
stats:
  affection:
  dependence:
  jealousy:
  courage:
```

---

# 10. 世界真相、人物知识与人物信念

这是项目最关键的数据设计之一。

必须严格区分：

```text
World Truth
Character Knowledge
Character Belief
Character Memory
```

## 10.1 World Truth

```yaml
event:
  id: event_0031
  happened: true
  time: day_3_18_20
  location: school_rooftop
  participants:
    - player
    - alice
```

---

## 10.2 Character Knowledge

Alice 知道：

```yaml
knowledge:
  event_0031:
    source: witnessed
    confidence: 1.0
```

Bob 不知道：

```yaml
knowledge:
  event_0031: null
```

---

## 10.3 Character Belief

Bob 可能错误相信：

```yaml
belief:
  subject: alice
  predicate: was_at
  object: library
  confidence: 0.8
```

实际世界事实：

```text
Alice 当时在天台。
```

这允许：

- 谎言
- 误解
- 隐瞒
- 传言
- 错误推理

---

# 11. Character Memory

人物记忆由数据库持久化，而不是依赖 LLM context。

```yaml
memory:
  id:
  character_id:
  source_event_id:
  type:
  subject:
  predicate:
  object:
  emotional_weight:
  importance:
  confidence:
  acquired_at:
```

例如：

```yaml
memory:
  character_id: alice
  source_event_id: CH03_S42
  type: promise
  subject: player
  predicate: promised
  object: keep_family_secret
  emotional_weight: 0.85
  importance: 0.92
  confidence: 1.0
```

---

# 12. 记忆检索策略

每个 Scene 不读取全部记忆。

计算：

```text
MemoryScore =
semantic_relevance
× importance
× emotional_weight
× recency_factor
× relationship_relevance
```

选择 Top-K。

Prompt Context：

```text
Character Canon
+ Current State
+ Important Long-term Memory
+ Relevant Episodic Memory
+ Recent Events
+ Current Scene
```

---

# 13. Narrative Graph

## 13.1 不使用纯 Tree

内部使用：

**State-aware Narrative DAG**

原因：

纯分支树会指数爆炸。

例如：

```text
Chapter 1
├─ A
├─ B
└─ C

Chapter 2
重新汇合
```

虽然剧情汇合，但玩家状态不同。

---

## 13.2 Node

```yaml
node:
  id:
  type:
  chapter:
  scene:
  conditions:
  content:
  effects:
  next:
```

---

## 13.3 Node 类型

```text
NARRATION
DIALOGUE
CHOICE
LOCATION
INTERACTION
ITEM
MESSAGE
FORUM
PHONE_CALL
TIME_ADVANCE
STAT_CHECK
SYSTEM_EVENT
ROUTE_GATE
ENDING
```

---

# 14. Choice System

```yaml
choice:
  id:
  text:
  visible_if:
  enabled_if:
  hidden_if:
  cost:
  effects:
  next_node:
```

例如：

```yaml
choice:
  text: "把照片交给 Alice"

  visible_if:
    inventory:
      contains: old_photo

  enabled_if:
    flags:
      examined_photo: true

  effects:
    alice.trust: +20
    flags:
      alice_confession_route: true

  next_node:
    CH05_SECRET_01
```

---

# 15. 选项显示策略

支持：

### Visible + Enabled

正常选项。

### Visible + Locked

例如：

```text
🔒 需要更高的勇气
```

### Hidden

玩家根本看不到。

### NG+ Reveal

二周目后显示锁定选项。

例如：

```text
？？？？？？
需要：Alice 信赖较高
```

---

# 16. Ending System

## 16.1 结局类型

```text
BAD_END
NORMAL_END
HAPPY_END
TRUE_END
SECRET_END
JOKE_END
CHARACTER_END
```

---

## 16.2 Ending Definition

```yaml
ending:
  id: TRUE_END_01

  requirements:
    alice.trust: ">=80"
    player.corruption: "<30"

    flags:
      truth_discovered: true
      saved_alice: true
      secret_room_found: true

    inventory:
      ancient_key: true
```

---

# 17. Ending-first Planning

生成阶段：

```text
Ending
↓
Ending Conditions
↓
Required Flags
↓
Required Events
↓
Required Choices
↓
Required Chapter Beats
↓
Narrative Route
```

AI 必须解释：

```text
为什么这个 Ending 条件成立？
玩家通过什么途径满足？
是否至少存在一条可达路径？
```

---

# 18. SLG 游戏循环

典型循环：

```text
Day Start
↓
查看手机 / 消息 / 论坛
↓
选择地点
↓
消耗时间
↓
触发角色 / 场景
↓
互动
↓
属性变化
↓
获取道具 / 情报
↓
时间推进
↓
夜间事件
↓
Day End
```

---

# 19. 时间系统

```yaml
game_time:
  day:
  weekday:
  hour:
  minute:
  period:
```

支持：

```text
Morning
Noon
Afternoon
Evening
Night
Late Night
```

事件：

```yaml
event:
  available_time:
    day: [3,4,5]
    period: evening
```

---

# 20. 地点系统

```yaml
location:
  id:
  name:
  description:
  available_time:
  travel_cost:
  connected_locations:
  interactions:
  characters_present:
```

AI 根据世界观生成合理地点。

---

# 21. 世界观驱动的玩法模块

不应该把“手机”“论坛”写死。

定义抽象能力：

```text
PrivateMessageChannel
PublicDiscussionChannel
BroadcastChannel
MailChannel
NewsChannel
DiaryChannel
NoticeBoard
```

现代世界：

```text
PrivateMessageChannel → 手机聊天
PublicDiscussionChannel → 网络论坛
BroadcastChannel → 社交媒体
```

奇幻世界：

```text
PrivateMessageChannel → 魔法信笺
PublicDiscussionChannel → 酒馆公告板
BroadcastChannel → 魔法报纸
```

维多利亚时代：

```text
PrivateMessageChannel → 书信
PublicDiscussionChannel → 沙龙 / 公告
BroadcastChannel → 报纸
```

---

# 22. AI Game System Analyzer

Story Bible 完成后，AI 输出：

```yaml
recommended_systems:
  time_system: true
  location_movement: true
  inventory: true
  private_message: true
  public_forum: true
  social_feed: false
  combat: false
  reputation: true
  money: false
```

同时提供：

```text
reason
gameplay_value
narrative_value
complexity
```

作者可手动 override。

---

# 23. 道具系统

```yaml
item:
  id:
  type:
  name:
  description:
  usable:
  consumable:
  unique:
  effects:
  narrative_tags:
```

分类：

```text
KEY_ITEM
CONSUMABLE
GIFT
CLUE
DOCUMENT
PHONE_CONTENT
EQUIPMENT
QUEST_ITEM
```

---

# 24. 互动系统

## 24.1 人物互动

例如：

```text
Talk
Gift
Invite
Observe
Ask
Confront
Help
Ignore
```

## 24.2 场景互动

```text
Inspect
Search
Use Item
Wait
Listen
Hide
Move
```

## 24.3 Context Action

AI 可以根据 Scene 动态生成互动：

```text
“检查被撕掉一角的照片”
```

但必须绑定程序状态：

```yaml
action:
  id:
  requires:
  effects:
  next_node:
```

---

# 25. 手机 / 通讯系统

消息不是纯文本装饰。

消息可以：

- 提供 Flag
- 解锁事件
- 改变关系
- 暗示时间
- 提供线索
- 触发路线

例如：

```yaml
message:
  sender: alice
  time: day_5_22_13
  text: "你明天有空吗？"

  effects:
    flags:
      alice_invitation_received: true
```

---

# 26. 论坛 / 公共信息系统

支持：

```text
Thread
Post
Reply
Anonymous Post
Rumor
Poll
News
```

帖子可以根据玩家行为变化。

例如：

```text
论坛传闻：
“有人昨天晚上在旧教学楼看到了两个人。”
```

触发条件：

```yaml
conditions:
  player.visited_old_school: true
  witness_present: true
```

---

# 27. Story Generation Pipeline

完整生成流程：

```text
User Input
↓
Normalize
↓
Story Bible Generator
↓
Canon Validator
↓
Game Design Generator
↓
Ending Planner
↓
Narrative Arc Planner
↓
Chapter Planner
↓
Scene Planner
↓
State Graph Generator
↓
Dialogue / Prose Writer
↓
Memory Extractor
↓
Consistency Validator
↓
Reachability Validator
↓
Character Voice Validator
↓
Freeze Canon
```

---

# 28. AI Agent / Worker 划分

不建议用一个万能 Agent。

建议独立角色：

```text
StoryArchitect
GameDesigner
EndingPlanner
ArcPlanner
ChapterPlanner
ScenePlanner
DialogueWriter
NarrationWriter
CharacterReviewer
LoreReviewer
LogicValidator
MemoryExtractor
RouteValidator
```

它们未必都需要独立模型实例。

实际可以是：

```text
同一模型
+ 不同 System Prompt
+ 不同 JSON Schema
```

---

# 29. Scene 生成契约

AI 不直接自由发挥。

Scene Planner 输出：

```yaml
scene:
  id:
  chapter:
  location:
  time:
  participants:

  purpose:
  required_beats:
  optional_beats:
  forbidden_information:

  emotional_arc:
  state_changes:

  choices:

  next_nodes:
```

---

# 30. Writer 权限限制

Writer 只能：

- 写对白
- 写动作
- 写环境
- 进行语言润色

Writer 不允许：

- 新增角色
- 新增关键道具
- 修改人物背景
- 修改真相
- 创建新 Flag
- 创建新剧情路线
- 私自改变属性

除非 Planner Spec 明确授权。

---

# 31. Consistency Validator

对每个 Scene 检查：

### Lore

- 世界观规则
- 年代
- 技术
- 地点
- 人物背景

### Character

- OOC
- 禁忌语言
- 人物是否知道不该知道的信息

### State

- 道具是否存在
- Flag 是否存在
- 人物是否存活
- 地点是否可达

### Timeline

- 时间是否冲突
- 角色是否同时出现在两个地方

---

# 32. Character Voice Validator

可做盲测：

将台词去掉角色名：

```text
Dialogue A
Dialogue B
Dialogue C
```

AI 判断：

```text
分别属于哪个角色？
confidence?
```

如果无法区分：

```text
Character Distinctiveness Score < threshold
```

重新生成。

---

# 33. Route Validator

Narrative Graph 构建完成后自动进行：

```text
Graph Traversal
Constraint Solving
State Simulation
```

检查：

```text
所有 Ending 是否 reachable
所有 Node 是否 reachable
是否存在 Dead Node
是否存在 Infinite Loop
是否存在 Impossible Requirement
```

---

# 34. Flag 来源验证

例如：

Ending 要求：

```text
flag.truth_discovered == true
```

系统必须找到：

```text
至少一个 Node 能产生：
truth_discovered = true
```

否则：

```text
BUILD ERROR
```

---

# 35. Item 来源验证

如果 Scene 需要：

```text
ancient_key
```

则必须证明玩家可以提前获取。

否则：

```text
Unreachable Content
```

---

# 36. Stat 可达性验证

例如：

```text
AliceTrust >= 90
```

程序模拟所有可能增长：

```text
max(AliceTrust) = 82
```

则：

```text
TRUE_END unreachable
```

这是硬错误。

---

# 37. 状态引擎

统一 GameState：

```yaml
game_state:
  time:
  player:
  characters:
  inventory:
  flags:
  quests:
  world:
  communications:
  route:
  progression:
```

---

# 38. Event Sourcing

推荐所有关键状态变化通过 Event 表达。

例如：

```yaml
event:
  type: CHARACTER_STAT_CHANGED
  character: alice
  stat: trust
  from: 40
  to: 55
  source: CH03_SCENE_17
```

优点：

- Debug
- Replay
- Save / Load
- 分支回溯
- 游戏日志
- AI Memory 提取
- 分支树显示

---

# 39. Save / Load

Save：

```yaml
save:
  project_version:
  current_node:
  game_state:
  event_cursor:
  playtime:
  discovered_nodes:
  unlocked_endings:
  ng_plus:
```

---

# 40. 存档确定性

同一个 Save：

```text
Load
↓
必须得到相同世界状态
```

如果正文已经 Freeze，则：

```text
相同 Scene
=
相同正文
```

不允许读档后 AI 随机重写关键内容。

---

# 41. 可选动态 Flavor Content

可以允许少量运行时生成：

- 不影响状态的闲聊
- 环境描述变体
- NPC 小互动
- 论坛填充内容
- 手机闲聊
- 日记文字

但必须：

```text
No State Mutation
```

或者：

```text
State Mutation 必须经过 Runtime Validator
```

---

# 42. Branch Graph 可视化

编辑器提供：

```text
Chapter
→ Scene
→ Choice
→ Route
→ Ending
```

支持：

- 缩放
- 搜索
- 过滤角色
- 过滤 Ending
- 查看 Flag
- 查看条件
- 查看状态变化
- 查看未达节点

---

# 43. 玩家攻略树

玩家侧提供简化后的路线图。

首次游戏：

```text
很多节点隐藏
```

达成后：

```text
解锁已访问路线
```

NG+：

```text
可显示部分条件提示
```

---

# 44. Ending Gallery

展示：

```text
已获得 7 / 23
```

分类：

- Bad End
- Character End
- Happy End
- True End
- Secret End

---

# 45. Collection System

可收集：

- CG
- Scene
- Ending
- Message
- Forum Thread
- Item
- Character Memory
- Route

---

# 46. 二周目系统

NG+ 可以：

- 保留 Ending 解锁
- 保留路线图
- 显示隐藏条件
- 解锁特殊选项
- 解锁 True Route
- 解锁角色内心视角
- 解锁新的通讯内容

---

# 47. Creator Editor

作者必须可以修改 AI 输出。

## 47.1 Story Bible Editor

## 47.2 Character Editor

## 47.3 Ending Editor

## 47.4 Graph Editor

## 47.5 Scene Editor

## 47.6 Condition Editor

## 47.7 Variable Inspector

## 47.8 Save Inspector

---

# 48. 局部重新生成

禁止：

```text
改一个角色
→ 整个游戏重新生成
```

需要 Dependency Graph。

例如修改：

```text
Alice 的职业
```

系统找出影响：

```text
Alice Character Canon
↓
Alice Scenes
↓
对应 Dialogue
↓
部分 Locations
```

只重新生成相关内容。

---

# 49. Content Freeze

内容状态：

```text
DRAFT
GENERATED
VALIDATED
FROZEN
MANUAL_EDITED
```

FROZEN 后 AI 不自动修改。

---

# 50. 内容版本控制

每个生成单元：

```yaml
content_version:
  version:
  parent_version:
  generated_by:
  prompt_hash:
  model:
  created_at:
  status:
```

支持：

- Diff
- Rollback
- Regenerate
- Compare

---

# 51. 数据模型

建议核心表：

```text
projects
story_bibles
characters
character_traits
character_voice_profiles
character_stats
character_relationships

locations
items
systems

chapters
scenes
nodes
choices
conditions
effects
endings

flags
events
memories
knowledge
beliefs

messages
forum_threads
forum_posts

generation_jobs
generation_artifacts
validation_results

game_builds
saves
save_events
```

---

# 52. 忽略

---

# 53. 忽略

---

# 54. AI Provider Layer

抽象：

```text
LLMProvider
```

接口：

```text
generateStructured()
generateText()
embed()
evaluate()
```

实现：

```text
OpenAIProvider
AnthropicProvider
GeminiProvider
LocalProvider
```

避免产品绑定一个模型。

---

# 55. Structured Output

所有结构设计必须 Schema First。

例如：

```json
{
  "scene_id": "string",
  "purpose": ["string"],
  "participants": ["string"],
  "required_beats": ["string"],
  "choices": []
}
```

禁止让模型随意输出无法解析结构。

---

# 56. Prompt Architecture

每个 Prompt 由以下部分组成：

```text
SYSTEM ROLE
TASK
CANON
CURRENT STATE
RELEVANT MEMORY
CONSTRAINTS
OUTPUT SCHEMA
```

---

# 57. Context Builder

独立组件：

```text
ContextBuilder
```

负责：

```text
load StoryBible
load Character
load Scene Dependencies
retrieve Memory
load Game Rules
truncate
rank
assemble
```

---

# 58. Generation Job System

大型游戏生成必须异步任务化。

Job：

```yaml
generation_job:
  type:
  status:
  progress:
  dependencies:
  retry:
  cost:
```

例如：

```text
Generate StoryBible
↓
Generate Endings
↓
Generate Arcs
↓
Generate Chapters
↓
Generate Scenes
```

---

# 59. Dependency Graph

生成任务也是 DAG。

例如：

```text
Character Canon
    ↓
Character Voice
    ↓
Character Scene
```

StoryBible 发生变化：

```text
invalidate dependent artifacts
```

---

# 60. Build System

最终：

```text
Source Project
↓
Validate
↓
Compile Narrative Graph
↓
Compile State Rules
↓
Bundle Content
↓
Create Game Build
```

类似：

```text
Game Compiler
```

---

# 61. Build Error

例如：

```text
E001 ENDING_UNREACHABLE
E002 UNKNOWN_FLAG
E003 ITEM_NO_SOURCE
E004 CHARACTER_DEAD_BUT_PRESENT
E005 KNOWLEDGE_LEAK
E006 TIMELINE_CONFLICT
E007 INVALID_LOCATION
E008 STAT_IMPOSSIBLE
```

---

# 62. API 设计示例

## Project

```http
POST /projects
GET /projects/{id}
PUT /projects/{id}
```

## Story

```http
POST /projects/{id}/story-bible/generate
POST /projects/{id}/story-bible/validate
```

## Character

```http
POST /projects/{id}/characters/generate
PUT /characters/{id}
```

## Narrative

```http
POST /projects/{id}/endings/generate
POST /projects/{id}/arcs/generate
POST /projects/{id}/chapters/{id}/generate
```

## Build

```http
POST /projects/{id}/builds
GET /builds/{id}
```

---

# 63. Runtime API

```http
POST /game/{buildId}/new
POST /game/{sessionId}/action
POST /game/{sessionId}/choice
POST /game/{sessionId}/move
POST /game/{sessionId}/use-item
POST /game/{sessionId}/save
POST /game/{sessionId}/load
```

---

# 64. Runtime 不依赖 LLM 的部分

应尽可能包括：

- Choice 判定
- 条件判定
- State mutation
- 时间
- 地点
- Inventory
- Stats
- Ending 判定
- Save
- Load
- Route
- Unlock

---

# 65. Runtime 可以调用 LLM 的部分

可选：

- Flavor Dialogue
- Ambient Content
- 论坛填充
- 无状态闲聊
- 个性化总结

默认不影响关键 Canon。

---

# 66. AI 成本控制

生成大作必须预算化。

每个 Job 记录：

```text
input_tokens
output_tokens
cost
model
latency
```

---

# 67. Model Tiering

不同任务使用不同模型。

例如：

### 高级模型

用于：

- Story Architecture
- Ending Design
- Critical Scene
- Validation

### 中级模型

用于：

- Chapter Expansion
- Scene Planning

### 便宜模型

用于：

- Flavor
- Tag
- Summarization
- Classification

---

# 68. 文本缓存

基于：

```text
prompt_hash
model
schema_version
```

缓存输出。

避免重复花费。

---

# 69. 自动 QA

完整 Build 必须经过：

```text
Static Validation
Graph Validation
State Simulation
AI Narrative Review
Character Review
Regression Tests
```

---

# 70. State Simulation

自动创建虚拟玩家：

```text
Random Player
Completionist Player
Alice Route Player
Bad Choice Player
True End Search Player
```

模拟数千局。

统计：

```text
Ending Reach Rate
Deadlock Rate
Average Playtime
Route Coverage
```

---

# 71. Property-based Test

例如：

```text
任何合法 Action 后：
GameState 必须合法
```

```text
character.hp >= 0
```

```text
unique_item count <= 1
```

---

# 72. Narrative Regression

修改内容后：

重新运行关键路线：

```text
True End Route
Alice Happy End
Major Bad End
```

确保仍可达。

---

# 73. Debugger

开发者模式：

```text
Current Node
Current Flags
Character Stats
Inventory
Knowledge
Memory
Available Choice
Blocked Choice
Ending Progress
```

---

# 74. Why Is This Locked?

开发者可以点击选项：

```text
为什么无法出现？
```

显示：

```text
alice.trust = 62
requires >= 70

missing:
flag.helped_alice
```

这是调试大型 SLG 极其重要的功能。

---

# 75. Player Hint System

可选：

```text
轻提示
中提示
完整条件
```

例如：

```text
“也许应该更早取得 Alice 的信任。”
```

而不是直接：

```text
Trust >= 70
```

---

# 76. UI 主要页面

Creator Side：

```text
Dashboard
Story Bible
Characters
World
Game Systems
Narrative Graph
Chapter Editor
Scene Editor
Ending Editor
Validation
Build
Playtest
```

Player Side：

```text
Main Menu
Story
Map
Phone / Communication
Inventory
Character
Save / Load
Ending Gallery
Route Graph
Collection
Settings
```

---

# 77. Narrative Graph UI

Node 颜色：

```text
Scene
Choice
Route Gate
Ending
Error
```

Node 显示：

```text
标题
角色
时间
关键 Flag
```

支持：

```text
点击查看
拖拽
搜索
过滤
Highlight Route
```

---

# 78. MVP 定义

第一版绝对不要做百万字。

建议：

```text
3 个主要角色
1 个玩家角色
7 个游戏日
5 个地点
20~30 个 Flag
10 个道具
100~150 个 Scene
20 个重要 Choice
3 Bad End
2 Normal End
1 Happy End
1 True End
5~10 万字
```

---

# 79. MVP 必须支持

### Creator

- Story Bible
- Character
- Ending
- AI Chapter Generation
- AI Scene Generation
- Narrative Graph
- Manual Edit

### Runtime

- Dialogue
- Choice
- Time
- Location
- Stats
- Inventory
- Save / Load
- Ending

### AI

- Character Voice
- Scene Writer
- Validation

---

# 80. MVP 暂时不做

- 战斗
- 复杂经济
- 多人
- AI 配音
- 视频
- 3D
- 开放世界
- 无限制实时对话
- 100 个角色
- Mod Marketplace

---

# 81. MVP 成功标准

如果 Demo 能满足以下要求，则核心技术验证成功：

1. 所有 Ending 自动验证可达。
2. 没有未知 Flag。
3. 没有无来源关键 Item。
4. 人物不会知道未获知信息。
5. 同一角色在不同章节保持明显语言风格。
6. 遮掉名字后能较高概率判断角色。
7. Load 后状态完全一致。
8. Route Graph 正确。
9. 修改 Character Canon 后只局部失效。
10. 玩家能明显感受到不同选择对后续产生影响。

---

# 82. V1

MVP 后：

```text
10~15 个角色
20~30 小时
500+ Scene
20+ Ending
手机
论坛
社交信息
礼物
地图
CG
路线收集
NG+
```

---

# 83. V2

```text
50~100 小时
1000~3000 Scene
百万字
多大型 Route
复杂角色 Knowledge
动态世界通讯
Creator Marketplace
Template
Mod
```

---

# 84. 忽略

---

# 85. 最大风险

## 风险 1：内容很多但不好玩

解决：

先生成：

```text
Game Design
```

再生成正文。

不是只生成文字。

---

## 风险 2：AI 文风同质化

解决：

- Voice Model
- Canonical Dialogue
- Character Distinctiveness
- Manual Editing
- 多模型 Review

---

## 风险 3：剧情越长越失控

解决：

```text
Hierarchy
State
Memory
Validation
Freeze
```

---

## 风险 4：分支爆炸

解决：

```text
Narrative DAG
State Reuse
Conditional Variant
Route Gate
```

---

## 风险 5：生成成本过高

解决：

```text
Tiered Model
Caching
Partial Regeneration
Freeze
```

---

## 风险 6：自动生成垃圾内容

解决：

每个 Scene 必须有 Narrative Purpose。

禁止纯填充。

---

# 86. Narrative Density

Scene 必须至少实现一个：

```text
Character Development
Plot Progress
Foreshadow
Relationship Change
Information Gain
Resource Change
Player Decision
World Building
```

否则标记：

```text
Low Narrative Value
```

---

# 87. 内容评分

每 Scene 自动计算：

```text
PlotValue
CharacterValue
ChoiceValue
Novelty
Consistency
VoiceQuality
```

低分 Scene：

```text
Review Required
```

---

# 88. 可扩展的游戏类型

架构成熟后可支持：

### 恋爱 SLG

```text
Affection
Trust
Jealousy
Date
Gift
```

### 悬疑

```text
Evidence
Knowledge
Suspicion
Timeline
```

### 校园

```text
Schedule
Club
Exam
Relationship
```

### 宫廷

```text
Reputation
Faction
Influence
Secret
```

### 生存

```text
Resource
Time
Health
Relationship
```

核心 Narrative Runtime 不变。

---

# 89. 核心竞争力

长期真正有价值的不是：

```text
AI 写得更快
```

而是：

```text
AI 生成一个巨大游戏后，
这个游戏仍然逻辑正确。
```

核心壁垒：

1. Narrative Compiler
2. State Graph
3. Character Memory
4. Knowledge Model
5. Ending-first Planner
6. Reachability Validator
7. Dependency-based Regeneration
8. Character Voice Validation

---

# 90. 最终技术定义

Project Chronicle 可以被理解为：

```text
         Human Creative Intent
                  │
                  ▼
             Story Bible
                  │
                  ▼
         Narrative Compiler
          /       |       \
         /        |        \
        ▼         ▼         ▼
    Story DAG  Game Rules  Characters
        │         │          │
        └─────┬───┴────┬─────┘
              ▼        ▼
           Validator  Content Generator
              │        │
              └────┬───┘
                   ▼
              Frozen Build
                   │
                   ▼
              Game Runtime
                   │
                   ▼
                Player
```

---

# 91. 推荐工程模块

后端模块可以拆为：

```text
project-service
story-bible-service
character-service
narrative-service
generation-service
validation-service
runtime-service
save-service
asset-service
build-service
```

MVP 不需要微服务。

推荐先：

```text
Modular Monolith
```

例如：

```text
Spring Boot
+ PostgreSQL
+ Redis
+ Object Storage
```

等业务稳定后再拆。

---

# 92. 推荐 Domain 划分

```text
project
story
world
character
narrative
gameplay
generation
validation
runtime
save
build
```

---

# 93. 最重要的 Domain Object

```text
Project
StoryBible
Character
CharacterState
CharacterKnowledge
Memory
Location
Item
NarrativeNode
Choice
Condition
Effect
Ending
GameState
Event
Save
Build
```

---

# 94. Condition DSL

建议设计简单 DSL。

例如：

```text
alice.trust >= 70
inventory.has("old_photo")
flag("helped_alice")
time.day >= 5
```

组合：

```text
AND
OR
NOT
```

---

# 95. Effect DSL

例如：

```text
alice.trust += 10
flag("alice_route") = true
inventory.add("key")
time.advance(60)
```

这样：

- AI 易生成
- 程序易验证
- Creator 易阅读
- Graph 易分析

---

# 96. 安全执行

AI 永远不能输出任意代码。

只允许输出：

```text
Condition DSL
Effect DSL
Structured JSON
```

Runtime 执行预定义操作。

---

# 97. Prompt Injection 风险

如果未来允许：

- 用户上传设定
- 导入外部文本
- UGC

要区分：

```text
Instruction
Content
```

上传内容只能是数据，不能覆盖 System Policy。

---

# 98. 数据安全

项目内容可能属于作者商业 IP。

必须：

- 项目隔离
- 权限
- 加密
- 不公开默认
- 可导出
- 可删除

---

# 99. Export

长期建议支持：

```text
Chronicle Runtime
JSON Game Package
Ren'Py
Godot
Web
```

但 MVP 可以只支持自有 Runtime。

---

# 100. 项目核心判断

这个产品最核心的技术问题不是：

> AI 能不能写 100 万字？

而是：

> 当 AI 写完 100 万字之后，这 100 万字是否仍然属于同一个世界、同一批角色、同一套规则，并且玩家真的可以通过自己的选择走到不同结局？

整个系统都应该围绕这个问题设计。

---

# 101. 推荐的第一阶段开发顺序

## Phase 1：Runtime

先不用 AI。

手写一个：

```text
Character
Scene
Choice
Condition
Effect
GameState
Save
Ending
```

证明运行时正确。

---

## Phase 2：Graph

实现：

```text
Narrative DAG
Route Visualization
Reachability
```

---

## Phase 3：AI Structured Generation

让 AI 生成：

```text
Character
Ending
Scene Spec
Choice
```

---

## Phase 4：Writer

加入：

```text
Dialogue Writer
Narration Writer
```

---

## Phase 5：Memory

加入：

```text
Knowledge
Belief
Memory
Retrieval
```

---

## Phase 6：Validation

加入：

```text
Logic Validator
Lore Validator
Character Validator
```

---

## Phase 7：SLG

加入：

```text
Time
Location
Inventory
Phone
Forum
Interaction
```

---

# 102. 第一版推荐 Demo

题材：

```text
现代校园悬疑 + 恋爱
```

原因：

天然支持：

- 手机
- 聊天
- 论坛
- 地点
- 时间
- 人物关系
- 道具
- 情报
- 多路线

规模：

```text
7 Days
3 Main Characters
5 Locations
7 Endings
100~150 Scenes
```

---

# 103. Demo 核心卖点

玩家宣传语可以是：

> 你的每一次选择都会被记住。

> 有些人记得你做过什么，也有人根本不知道。

> 同一个故事，可以存在完全不同的真相认知。

> 你不只是选择对话，而是在逐渐塑造一条只属于你的路线。

---

# 104. 最终产品愿景

长期目标不是生成“一部 AI 小说”。

而是让作者输入：

```text
故事
人物
世界
创作意图
```

系统输出：

```text
一个真正可玩的游戏。
```

它拥有：

- 开始
- 发展
- 伏笔
- 冲突
- 玩家决策
- 后果
- 角色成长
- 隐藏路线
- 多结局
- 收集
- 二周目
- 攻略
- 存档
- 可验证逻辑

最终形成一种新的创作方式：

> **Human-authored intent, AI-expanded content, machine-verified game logic.**

即：

> **人类决定故事的灵魂，AI 放大创作规模，程序保证游戏成立。**

---

# 附录 A：核心对象关系

```text
Project
│
├── StoryBible
│   ├── World
│   ├── Rule
│   ├── Timeline
│   └── Theme
│
├── Character
│   ├── Canon
│   ├── Voice
│   ├── State
│   ├── Knowledge
│   └── Memory
│
├── Narrative
│   ├── Arc
│   ├── Chapter
│   ├── Scene
│   ├── Node
│   ├── Choice
│   └── Ending
│
├── Gameplay
│   ├── Time
│   ├── Location
│   ├── Inventory
│   ├── Communication
│   └── Interaction
│
├── Runtime
│   ├── GameState
│   ├── Event
│   ├── Save
│   └── Progress
│
└── Build
    ├── Validation
    ├── Content
    └── Assets
```

---

# 附录 B：核心 Scene 示例

```yaml
scene:
  id: CH05_A17

  chapter: 5

  time:
    day: 5
    period: evening

  location: school_rooftop

  participants:
    - player
    - alice

  purpose:
    - increase_alice_suspicion
    - foreshadow_watch_mystery

  required_beats:
    - alice_notices_broken_watch
    - alice_asks_where_player_was_last_night

  forbidden_information:
    - attacker_identity

  dialogue_style:
    alice:
      mood: guarded
      formality: high

  choices:

    - id: tell_truth

      text: "告诉她昨晚发生的事"

      effects:
        alice.trust: +10
        alice.suspicion: -10

        flags:
          told_alice_truth: true

    - id: lie

      text: "说自己一直在家"

      effects:
        alice.trust: -5
        alice.suspicion: +20

        flags:
          lied_to_alice: true

    - id: show_photo

      text: "把旧照片拿给她看"

      visible_if:
        inventory.has: old_photo

      enabled_if:
        flags:
          examined_old_photo: true

      effects:
        alice.trust: +25

        flags:
          alice_secret_route: true

      next:
        CH05_SECRET_02
```

---

# 附录 C：建议仓库结构

```text
chronicle/
├── backend/
│   ├── project/
│   ├── story/
│   ├── character/
│   ├── narrative/
│   ├── gameplay/
│   ├── generation/
│   ├── validation/
│   ├── runtime/
│   ├── save/
│   └── build/
│
├── web/
│   ├── creator/
│   └── player/
│
├── schemas/
│   ├── character.schema.json
│   ├── scene.schema.json
│   ├── choice.schema.json
│   └── ending.schema.json
│
├── prompts/
│   ├── story_architect/
│   ├── scene_planner/
│   ├── dialogue_writer/
│   └── validators/
│
├── examples/
│
└── docs/
    └── PRODUCT_SPEC.md
```

---

# 附录 D：MVP 里程碑

## M0：基础 Runtime

完成：

- Node
- Choice
- Condition
- Effect
- GameState
- Save

---

## M1：Narrative Graph

完成：

- DAG
- Ending
- Route
- Graph UI
- Reachability

---

## M2：AI Generation

完成：

- Story Bible
- Character
- Ending
- Scene Spec

---

## M3：Content

完成：

- Dialogue
- Narration
- Character Voice

---

## M4：SLG

完成：

- Time
- Location
- Inventory
- Character Stats

---

## M5：Communication

完成：

- Private Message
- Forum
- Notification

---

## M6：Validation

完成：

- State Validator
- Route Validator
- Lore Validator
- Character Validator

---

## M7：完整 Demo

完成：

```text
7 Days
3 Characters
7 Endings
5~10 万字
```

并验证：

```text
100% Ending Reachable
0 Missing Flag
0 Missing Key Item
0 Dead Node
Character Voice 可区分
Save / Load 完全确定
```

---

# 结论

该产品技术上可行。

最重要的不是获得一个“永远不会忘记”的 LLM，而是构建一个：

```text
外部持久化状态
+
人物知识 / 记忆
+
结构化剧情图
+
确定性 Runtime
+
AI 内容生成
+
自动验证
```

的完整系统。

只要坚持：

> **AI 生成，程序记忆，规则验证，内容冻结。**

就可以把游戏规模扩展到传统人工创作很难承担的程度，同时保留：

- 角色一致性
- 剧情可控性
- 多结局
- 存读档确定性
- 攻略价值
- 二周目价值
- 大型 SLG 的系统感

这应该成为整个产品的核心工程原则。
