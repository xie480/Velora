import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { ArrowUpRight, GitBranch, Sparkles } from "lucide-react";

interface StoryNodeData extends Record<string, unknown> {
  chapter: string;
  title: string;
  kind: "entry" | "choice" | "ending";
  accent: "teal" | "violet" | "gold";
}

type StoryNode = Node<StoryNodeData>;

function StoryNodeCard({ data }: NodeProps<StoryNode>) {
  const Icon = data.kind === "choice" ? GitBranch : data.kind === "ending" ? Sparkles : ArrowUpRight;

  return (
    <div className={`story-node story-node--${data.accent}`}>
      <Handle type="target" position={Position.Left} className="story-handle" />
      <div className="story-node__topline">
        <span className="story-node__icon"><Icon size={14} aria-hidden="true" /></span>
        <span>{data.chapter}</span>
        <span className="story-node__signal" aria-hidden="true" />
      </div>
      <strong>{data.title}</strong>
      <span className="story-node__kind">{data.kind === "choice" ? "分支节点" : data.kind === "ending" ? "结局节点" : "场景节点"}</span>
      <Handle type="source" position={Position.Right} className="story-handle" />
    </div>
  );
}

const nodeTypes = { story: StoryNodeCard };
const nodes: StoryNode[] = [
  {
    id: "opening",
    type: "story",
    position: { x: 30, y: 108 },
    data: { chapter: "CHAPTER 01", title: "雾色来信", kind: "entry", accent: "teal" },
  },
  {
    id: "choice",
    type: "story",
    position: { x: 268, y: 108 },
    data: { chapter: "CHOICE 03", title: "追问寄件人", kind: "choice", accent: "violet" },
  },
  {
    id: "ending",
    type: "story",
    position: { x: 506, y: 108 },
    data: { chapter: "ENDING 01", title: "未寄出的答案", kind: "ending", accent: "gold" },
  },
];

const edges: Edge[] = [
  { id: "e-opening-choice", source: "opening", target: "choice", type: "smoothstep", animated: true },
  { id: "e-choice-ending", source: "choice", target: "ending", type: "smoothstep", animated: true },
];

export function NarrativePreview() {
  return (
    <section className="panel graph-panel" aria-labelledby="graph-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">NARRATIVE GRAPH</span>
          <h2 id="graph-title">叙事脉络</h2>
        </div>
        <span className="preview-label"><span className="preview-label__dot" />示例路线</span>
      </div>
      <div className="graph-preview" aria-label="示例剧情图，展示场景、分支与结局节点">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.16 }}
          minZoom={0.45}
          maxZoom={1.25}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#31415a" />
        </ReactFlow>
        <div className="graph-preview__vignette" aria-hidden="true" />
      </div>
      <div className="graph-legend" aria-label="节点类型">
        <span><i className="legend-dot legend-dot--teal" />场景</span>
        <span><i className="legend-dot legend-dot--violet" />分支</span>
        <span><i className="legend-dot legend-dot--gold" />结局</span>
        <span className="graph-legend__caption">节点与连线将由项目剧情数据生成</span>
      </div>
    </section>
  );
}
