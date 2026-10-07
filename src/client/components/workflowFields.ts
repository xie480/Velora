import type { EntityKind, FieldDefinition } from "../../shared/workflow";

export interface FieldPresentation { help: string; example: string; rows: number; wide: boolean; short: boolean }
type FieldHints = Record<string, [string, string]>;

const storyHints: FieldHints = {
  name: ["作品或项目的名称，可先用工作标题，后续随时修改。", "未寄出的夏日来信"],
  genre: ["说明故事的主要类型，让 AI 按相应题材规划人物与冲突。", "校园悬疑 / 恋爱 SLG"],
  tags: ["补充题材、氛围或玩法关键词；每个标签独立一项。", "慢热"],
  outline: ["用自己的话描述故事从哪里开始、围绕什么展开、希望走向哪里；无需写成正式正文。", "主角收到一封来自失踪朋友的信，沿着旧照片调查当年的事件。"],
  background: ["说明故事发生前已存在的社会环境或重大事件。", "十年前，镇上的研究所曾发生一次未公开的事故。"],
  worldView: ["描述世界的基本运行方式、特殊规则和与现实不同的设定。", "城市停电后，某些旧广播会重放过去尚未发生的对话。"],
  era: ["填写年代或时代特征，帮助约束科技与生活方式。", "2008 年的沿海小城"],
  locations: ["已确定的故事地点，一项一个；不用提前填写未知地点。", "海边邮局"],
  themes: ["希望故事讨论的问题或价值，例如信任、记忆或选择的代价。", "信任与隐瞒"],
  coreConflict: ["用一两句话说明主角与人物、社会或自身之间的核心矛盾。", "主角想揭开真相，但真相会伤害最信任的人。"],
  tone: ["描述阅读时希望形成的情绪与节奏。", "克制、忧郁，结局保留温暖"],
  presetCharacters: ["记录你已确定的人物及其定位；这些是用户预设，AI 应保留而非自行替换。", "林遥：主角的旧友，隐瞒当年的一段经历"],
  presetEvents: ["你已构思好的剧情事件，一项一个；可写发生条件或大致时机。", "主角在旧校舍找到一张缺角照片"],
  presetBranches: ["你已构思好的关键选择及影响方向；详情将在分支阶段展开。", "是否把照片交给林遥，影响两人的信任"],
  presetEndings: ["你已经想好的结局方向；AI 先将它们纳入可审批清单。", "真相公开但友情破裂的结局"],
  requiredContent: ["明确故事必须包含的内容，AI 后续规划应持续遵守。", "最后一封信必须由主角亲手读完"],
  forbiddenChanges: ["不可被 AI 推翻的创作约束，一项一条；与不希望出现的内容分开写清楚。", "失踪事件必须存在现实原因，不允许用梦境解释"],
  expectedLength: ["填写预期故事规模或游玩时长；卷章的精确数量会在卷与章节阶段确定。", "约 15 万字，游玩 8 小时"],
  notes: ["补充其他创作偏好、参考方向或特别说明。", "对话自然，避免用长篇解释代替剧情推进"],
};

const commonHints: FieldHints = {
  name: ["当前审核对象的简短名称，用于大纲导航与引用。", "雨后的旧校舍"],
  theme: ["这部分剧情主要讨论的主题。", "信任需要面对证据的考验"],
  conflict: ["这部分剧情直接推动故事的矛盾。", "调查证据与保护朋友之间的冲突"],
  storyPhase: ["说明这一卷或章承担的剧情阶段。", "建立疑点 / 冲突升级 / 真相揭露"],
  characterIds: ["从已经确定的人物中选择相关角色；引用人物名称即可，不需要填写 ID。", "选择承担本段剧情的人物"],
  endingIds: ["选择这段剧情推进或影响的已设计结局。", "选择得到铺垫或被开启的结局"],
  chapterIds: ["选择该系统实际作用的已规划章节。", "选择需要移动、调查或物品机制的章节"],
  foreshadowing: ["本对象需要提前埋下的线索；说明它暗示什么、将在哪里回收。", "照片中缺席的人，提示后来揭露的身份"],
  routes: ["列出本对象涉及的叙事路线；使用前后一致的路线名称。", "林遥信任线"],
  requiredEvents: ["必须发生的事件；写清其剧情作用，而非只写事件标题。", "主角核对邮戳，确认信件来自事故当天"],
  forbiddenEvents: ["在当前对象对应的剧情范围内不能发生的事件。", "不能在这一章直接揭露寄信人的身份"],
  prerequisites: ["到达这一结局前必须成立的剧情事实。", "玩家已获知事故的真实原因"],
  preconditions: ["关键分支出现前必须成立的条件。", "主角已经持有照片，并见过林遥"],
  volumeNumber: ["由固定卷章结构自动确定，不能在内容表单中改动。", "卷序号"],
  chapterNumber: ["由固定卷章结构自动确定，不能在内容表单中改动。", "章序号"],
  summary: ["概括整体内容和主要推进关系；无需生成正式正文或对白。", "主角与旧友建立联系，逐步发现彼此记忆的差异。"],
};

const entityHints: Record<EntityKind, FieldHints> = {
  storyBible: {
    premise: ["用简短设定概括主角、目标与核心阻力，是后续创作的共同起点。", "收到失踪旧友的来信后，主角必须在拆迁前找到十年前事故的真相。"],
    worldBackground: ["说明世界的历史背景与当下环境，作为后续章节的事实依据。", "旧研究所在事故后关闭，小城逐渐遗忘了那一天。"],
    worldRules: ["世界中稳定有效的规则，每条独立记录；后续内容不能随意推翻。", "停电期间的旧广播只能被事故亲历者听见"],
    setting: ["说明社会制度、技术条件与时代环境，约束人物可使用的能力和工具。", "智能手机尚未普及，信息主要来自书信和纸质档案。"],
    startingState: ["故事正式开始前世界与主角处于什么状态。", "主角回到故乡，旧校舍将在两周后拆除。"],
    mainConflict: ["整个故事必须持续回应的主要矛盾。", "公开真相可能毁掉朋友的家庭。"],
    coreSecret: ["作者视角下的核心秘密；不是当前人物都已知道的信息。", "事故中被认为失踪的人实际上留下了调查记录。"],
    factions: ["影响故事的重要组织或群体，一项说明一个组织及其目标。", "旧研究所管理委员会：试图保护当年的记录"],
    locations: ["世界中已确定的重要地点；初始世界状态只能引用已审批地点。", "研究所档案室"],
    themes: storyHints.themes,
    immutableFacts: ["后续 AI 生成不可改变的事实；请写成明确的判断。", "事故发生在十年前的八月，不存在时间旅行"],
    unrevealedInformation: ["开篇或早期章节不能提前让玩家或人物知道的信息。", "寄信人的真实身份在第三卷前不能公开"],
  },
  character: {
    basicProfile: ["人物的年龄、称呼、职业等基本资料。", "林遥，24 岁，邮局临时员工"], identity: ["人物在世界和剧情中的身份或角色定位。", "事故亲历者 / 主角旧友"],
    appearance: ["用于辨识人物的外貌特点，优先记录有叙事意义的特征。", "短发，习惯遮住左手上的旧伤"], background: ["人物的成长背景与当前处境。", "事故后离开小城，最近因家人病情回来。"],
    family: ["人物家庭成员、家庭关系及对其行为的影响。", "与母亲同住，父亲长期失联。"], importantPast: ["解释当前行为的重要过去事件。", "曾在事故当夜替朋友保管一封信。"],
    personality: ["描述稳定性格与面对压力时的反应。", "细心但防备心强，受到质疑时会转移话题。"], values: ["人物认为比其他事情更重要的价值判断。", "承诺不能随意违背"],
    likes: ["能影响互动与选择的喜好。", "旧唱片"], dislikes: ["会触发反感或抵触的事物与行为。", "被当众逼问过去"], desire: ["人物内心最希望得到的东西。", "希望被相信，而不是被同情"], fear: ["人物最担心失去什么或遭遇什么。", "害怕真相再次伤害家人"],
    weaknesses: ["人物的限制与容易出错的地方，不等同于道德评价。", "无法拒绝家人的要求"], secret: ["人物掌握但不愿公开的信息。", "知道那张照片的另一半在哪里"], shortTermGoal: ["故事开篇近期想完成的目标。", "阻止旧校舍被拆除"], longTermGoal: ["人物跨越整个故事想达到的状态。", "与当年的选择和解"],
    behaviorStyle: ["人物习惯如何行动、做决定和处理问题。", "先收集证据，最后才表达判断。"], speechStyle: ["语言节奏、用词和交流习惯，帮助避免人物说话同质化。", "短句，少直接回答，紧张时会重复对方的话。"], commonExpressions: ["符合人物声音的惯用表达。", "你真的确定吗？"], forbiddenExpressions: ["不符合身份或性格的表达，AI 应避免使用。", "不要使用夸张网络梗"], emotions: ["人物如何表现情绪，避免只写情绪标签。", "愤怒时声音变轻，悲伤时整理桌面。"], initialAttitude: ["故事开始时对主角的态度及原因。", "礼貌但疏远，因为多年未联系。"], dynamicAttributes: ["定义此人物独有的动态指标、范围和初始值，供后续规划引用。", "信任：0–100，初始 20；角色可拥有不同属性"],
  },
  relationships: { summary: ["概括人物之间的关系网络与主要张力。", "三人因事故相互隐瞒，却共同保护同一段记忆。"], relationships: ["为两名不同人物记录关系含义与可选初始数值，方向代表谁对谁。", "林遥对主角：仍有信任，但不愿谈起过去" ] },
  ending: { endingType: ["结局的叙事类型；用于清单分组，不替代具体结果。", "True End / Bad End"], outcome: ["明确最终发生了什么，人物与世界变成怎样。", "真相被公开，主角与林遥决定一起留下。"], themeMeaning: ["这一结局如何回应故事主题。", "信任不是避免伤害，而是共同承担真相。"], prerequisites: commonHints.prerequisites, relationshipRequirements: ["达到该结局所需的人物关系状态。", "林遥愿意向主角分享事故记录"], requiredEvents: commonHints.requiredEvents, forbiddenEvents: commonHints.forbiddenEvents, flagRequirements: ["必须成立的标记状态，用清晰条件描述即可。", "photo_verified = true"], informationRequirements: ["玩家或人物必须已经获知的信息。", "知道邮戳日期被修改过"], itemRequirements: ["必须取得或保留的道具。", "持有完整照片"], setup: ["反向规划为这个结局提供依据的前期场景或事件。", "第二章展示林遥对缺角照片的反应"], foreshadowing: commonHints.foreshadowing, payoffs: ["结局必须回应或解释的已埋内容。", "解释开篇信件为什么没有寄信地址"], routes: commonHints.routes },
  volume: { endingState: ["本卷结束时应该达到的故事状态，作为下一卷的起点。", "主角确认事故被人为掩盖，但还不知道原因。"], foreshadowing: commonHints.foreshadowing },
  chapter: { summary: ["说明这一章大概发生什么，保留走向和事件，不写正式正文或对白。", "主角访问邮局，在旧账本中找到不一致的寄信记录。"], startTime: ["这一章开始的故事内时间，可相对表述。", "故事第 2 天，上午"], duration: ["预计覆盖多长时间，帮助约束事件安排。", "半天"], endCondition: ["明确什么时候这一章可以结束，应是可判断的剧情条件。", "主角取得寄信记录，并决定下一处调查地点"], requiredBeats: ["本章必须完成的事件或叙事节点，一条一个。", "第一次向林遥询问照片来源"], optionalEvents: ["可以发生但不阻塞章节结束的内容。", "整理邮局储物间，找到旧明信片"], forbiddenEvents: commonHints.forbiddenEvents, routes: commonHints.routes, introducedForeshadowing: ["这一章新埋下的线索，注明预期回收方向。", "账本中同一人的签名出现两种笔迹"], resolvedForeshadowing: ["这一章解释或回应此前的伏笔。", "确认开篇旧广播来自研究所"], retainedConditions: ["本章结束后仍需保留给后续章节的状态或条件。", "照片必须保持完整，不得交给委员会" ] },
  chapterCharacterPlan: { characters: ["逐个人物规划本章起始状态、目标、心理和关系变化、知情边界及结束状态。", "选择人物后，为每项状态填写可观察的变化" ] },
  criticalBranch: { background: ["说明关键选择在什么剧情背景下出现。", "林遥发现主角拿到了事故照片，主动询问来源。"], preconditions: commonHints.preconditions, choices: ["每个选项分别填写显示文字、隐藏条件、实际效果与后续影响；一个关键分支至少需要两个选项。", "公开照片 / 保留照片，两者对关系与调查路线产生不同效果"], foreshadowing: commonHints.foreshadowing },
  gameSystem: { systemType: ["系统的功能类别，只定义创作方案，不执行实际游戏流程。", "时间安排 / 地点移动 / 线索收集"], reason: ["说明为什么这个故事需要该系统。", "调查必须在拆迁前完成，因此需要时间资源约束。"], gameplayValue: ["说明系统给玩家带来的有意义决策。", "玩家需要在不同调查地点之间分配有限时间。"], worldPresentation: ["该机制在世界中如何被人物与玩家感知。", "通过邮局的值班表与每日开放时段表现。"], configuration: ["记录系统静态配置；简单值直接编辑，复杂嵌套可使用高级编辑。", "每日行动次数 = 3，允许夜间调查 = 否" ] },
  initialWorldState: { initialTime: ["正式游戏开始前的时间起点。", "第 1 天，上午 8:00"], initialLocation: ["玩家开始所在的地点，必须属于已审批 Story Bible 地点。", "邮局"], accessibleLocations: ["开篇已经可以访问的地点；后续解锁地点不应提前放入。", "邮局"], characterLocations: ["分别设置已确定人物开篇所在的地点。", "林遥：邮局"], characterRelationships: ["记录开篇人物关系，与人物阶段关系总览保持一致。", "林遥对主角：礼貌疏远，信任 20"], characterAttributes: ["设置每个人物已定义动态属性的开篇数值，不添加新的属性名称。", "林遥 / trust = 20"], playerAttributes: ["记录玩家的初始能力或资源数值。", "insight = 10"], inventory: ["玩家开始已经持有的物品，一条一个。", "缺角照片"], publicInformation: ["开篇对玩家或公众已经公开的信息。", "旧校舍将在两周后拆除"], hiddenInformation: ["作者知道但开篇尚未公开的事实。", "账本的关键一页被委员会取走"], flags: ["初始标记可为文字、数值或是/否，用于表达故事起点。", "photo_verified = 否"], historicalEvents: ["游戏开始前已经发生的历史事件，不在运行时重新执行。", "十年前，研究所发生事故" ] },
};

const shortFields = new Set(["name", "genre", "era", "tone", "expectedLength", "identity", "appearance", "fear", "shortTermGoal", "longTermGoal", "initialAttitude", "storyPhase", "startTime", "duration", "initialTime", "initialLocation", "systemType", "endingType", "volumeNumber", "chapterNumber"]);
const longFields = new Set(["outline", "worldView", "worldBackground", "premise", "summary", "background", "outcome", "startingState", "coreSecret"]);
export function fieldPresentation(kind: EntityKind | "storyInput", field: FieldDefinition): FieldPresentation {
  const hints = (kind === "storyInput" ? storyHints : entityHints[kind])[field.key] ?? commonHints[field.key];
  if (!hints) throw new Error(`缺少字段说明：${kind}.${field.key}`);
  return { help: hints[0], example: hints[1], rows: longFields.has(field.key) ? 5 : 3, wide: !shortFields.has(field.key), short: shortFields.has(field.key) };
}
export const endingOptions = [ ["NORMAL", "普通结局"], ["HAPPY", "幸福结局"], ["BAD", "坏结局"], ["FAKE", "假结局"], ["TRUE", "真实结局"], ["SECRET", "隐藏结局"], ["SPECIAL", "特殊结局"] ] as const;
export function friendlyFieldLabel(field: FieldDefinition): string {
  const labels: Record<string, string> = { premise: "故事核心设定", endCondition: "章节结束条件", requiredBeats: "本章必需事件 / 叙事节点", optionalEvents: "本章可选事件", forbiddenEvents: "禁止发生的事件", endingType: "结局类型", flagRequirements: "需要成立的标记", flags: "初始标记" };
  return labels[field.key] ?? field.label;
}
