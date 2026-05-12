const fs = require('fs');

const filePath = 'components/node-editor/layout.ts';
let code = fs.readFileSync(filePath, 'utf-8');

const regex = /\n(\s*)const dagreGraph = new dagre\.graphlib\.Graph\(\);[\s\S]*?node\.position = { x, y };\n\s*\}\);\n/m;

const match = code.match(regex);
if (match) {
  const replacement = `
    const parentNodeObj = newNodes.find((n) => n.id === parentId);
    // 전략 블록 (솔리드 타입이거나 이름에 Strategy 포함)인 경우, 
    // 내부의 '시퀀스+개별노드' 간 수동 배치가 깨지지 않도록 Dagre 정렬을 수행하지 않고 위치를 유지합니다.
    const isStrategy = 
      parentNodeObj?.data?.styleType === "solid" || 
      parentId === "g_strategy" || 
      (parentNodeObj?.data?.label && String(parentNodeObj.data.label).includes("Strategy"));

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    if (!isStrategy) {
      const dagreGraph = new dagre.graphlib.Graph();
      dagreGraph.setDefaultEdgeLabel(() => ({}));

      // DAGRE 그래프 여백 설정
      dagreGraph.setGraph({
        rankdir: direction,
        ranksep: 30,
        nodesep: 20,
      });

      const childIds = new Set(childNodes.map((n) => n.id));

      // 이 그룹에 속한 자식 노드 세팅 (이전 단계에서 사이즈가 커진 그 룹노드 포함)
      childNodes.forEach((node) => {
        let w = node.type === "groupNode" ? node.style?.width : (node.measured?.width ?? node.style?.width ?? node.width);
        let h = node.type === "groupNode" ? node.style?.height : (node.measured?.height ?? node.style?.height ?? node.height);

        if (!w || !h) {
          if (node.type === "groupNode") {
            w = w || GROUP_MIN_WIDTH;
            h = h || GROUP_MIN_HEIGHT;
          } else {
            switch (node.type) {
              case "actionNode": w = w || 320; h = h || 100; break;
              case "functionNode": w = w || 320; h = h || 100; break;
              case "branchNode": w = w || 420; h = h || 150; break;
              case "timelineFrame": w = w || 520; h = h || 350; break;
              case "clickTrigger": w = w || 280; h = h || 80; break;
              case "timeTrigger": w = w || 280; h = h || 80; break;
              default: w = w || 300; h = h || 120; break;
            }
          }
        }

        dagreGraph.setNode(node.id, { width: Number(w), height: Number(h) });
      });

      // 이 그룹 내부 자식 노드들 간에 연결된 엣지만 세팅
      edges.forEach((edge) => {
        if (childIds.has(edge.source) && childIds.has(edge.target)) {
          dagreGraph.setEdge(edge.source, edge.target);
        }
      });

      // 개별 서브 트리에 대해 자동 정렬 수행
      dagre.layout(dagreGraph);

      // 최소 좌표를 추출하여 (0, 0) 기준으로 패딩 넣기
      childNodes.forEach((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        const w = nodeWithPosition.width;
        const h = nodeWithPosition.height;

        const x = nodeWithPosition.x - w / 2;
        const y = nodeWithPosition.y - h / 2;

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);

        node.position = { x, y };
      });
    } else {
      // 전략 블록인 경우 자식들의 현재 위치(x, y)를 그대로 추출하여 그룹 크기를 조정함.
      childNodes.forEach((node) => {
        let w = node.type === "groupNode" ? node.style?.width : (node.measured?.width ?? node.style?.width ?? node.width);
        let h = node.type === "groupNode" ? node.style?.height : (node.measured?.height ?? node.style?.height ?? node.height);

        const numW = Number(w) || (node.type === "groupNode" ? GROUP_MIN_WIDTH : NODE_WIDTH);
        const numH = Number(h) || (node.type === "groupNode" ? GROUP_MIN_HEIGHT : NODE_HEIGHT);

        const x = node.position.x;
        const y = node.position.y;

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + numW);
        maxY = Math.max(maxY, y + numH);
      });
    }
`;
  code = code.replace(match[0], replacement);
  fs.writeFileSync(filePath, code, 'utf-8');
  console.log("Replaced successfully!");
} else {
  console.log("No match found.");
}
