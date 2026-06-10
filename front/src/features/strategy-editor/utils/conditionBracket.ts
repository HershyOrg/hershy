type ConditionBracketLeafInput<T> = {
  id: string;
  payload: T;
  active?: boolean;
};

type ConditionBracketRep = {
  y: number;
  sourceId: string;
};

type ConditionBracketLeaf<T> = {
  type: "leaf";
  id: string;
  roundNo: 1;
  index: number;
  seed: number;
  leaf: ConditionBracketLeafInput<T> | null;
  activeCount: number;
  visible: boolean;
  centerY: number;
  rep: ConditionBracketRep | null;
};

type ConditionBracketOperatorNode<T> = {
  type: "operator";
  id: string;
  roundNo: number;
  index: number;
  left: ConditionBracketNode<T>;
  right: ConditionBracketNode<T>;
  activeCount: number;
  visible: boolean;
  centerY: number;
  rep: ConditionBracketRep | null;
};

type ConditionBracketNode<T> = ConditionBracketLeaf<T> | ConditionBracketOperatorNode<T>;

type ConditionBracket<T> = {
  rounds: ConditionBracketNode<T>[][];
  visibleOperators: ConditionBracketOperatorNode<T>[];
  rootRep: ConditionBracketRep | null;
  height: number;
};

type ConditionBracketOptions = {
  baseId: string;
  leafHeight?: number;
  rowGap?: number;
};

function nextPowerOfTwo(value: number) {
  if (value < 1) {
    throw new Error("condition bracket requires at least one leaf");
  }
  return 2 ** Math.ceil(Math.log2(value));
}

function standardSeedOrder(size: number) {
  if (size < 1 || (size & (size - 1)) !== 0) {
    throw new Error("condition bracket size must be a power of two");
  }

  let order = [1];
  let currentSize = 1;

  while (currentSize < size) {
    currentSize *= 2;
    order = order.flatMap((seed) => [seed, currentSize + 1 - seed]);
  }

  return order;
}

function makeLeaf<T>(
  slotIndex: number,
  seed: number,
  leaf: ConditionBracketLeafInput<T> | null,
  leafHeight: number,
  rowGap: number,
): ConditionBracketLeaf<T> {
  const active = Boolean(leaf && leaf.active !== false);
  const centerY = slotIndex * (leafHeight + rowGap) + leafHeight / 2;
  const id = `leaf-${slotIndex + 1}`;

  return {
    type: "leaf",
    id,
    roundNo: 1,
    index: slotIndex + 1,
    seed,
    leaf: active ? leaf : null,
    activeCount: active ? 1 : 0,
    visible: active,
    centerY,
    rep: active
      ? {
        y: centerY,
        sourceId: id,
      }
      : null,
  };
}

function makeInternalNode<T>(
  baseId: string,
  roundNo: number,
  index: number,
  left: ConditionBracketNode<T>,
  right: ConditionBracketNode<T>,
): ConditionBracketOperatorNode<T> {
  return {
    type: "operator",
    id: `${baseId}-r${roundNo}-m${index}`,
    roundNo,
    index,
    left,
    right,
    activeCount: left.activeCount + right.activeCount,
    visible: false,
    centerY: 0,
    rep: null,
  };
}

function layoutBracket<T>(rounds: ConditionBracketNode<T>[][]) {
  const visibleOperators: ConditionBracketOperatorNode<T>[] = [];

  for (let roundIndex = 1; roundIndex < rounds.length; roundIndex += 1) {
    const round = rounds[roundIndex] as ConditionBracketOperatorNode<T>[];

    round.forEach((node) => {
      node.centerY = (node.left.centerY + node.right.centerY) / 2;
      node.visible = node.left.activeCount > 0 && node.right.activeCount > 0;
      node.rep = node.visible
        ? { y: node.centerY, sourceId: node.id }
        : node.left.rep || node.right.rep;

      if (node.visible) {
        visibleOperators.push(node);
      }
    });
  }

  return visibleOperators;
}

export function buildConditionBracket<T>(
  leaves: ConditionBracketLeafInput<T>[],
  options: ConditionBracketOptions,
): ConditionBracket<T> {
  const activeLeaves = leaves.filter((leaf) => leaf.active !== false).length;
  const bracketSize = nextPowerOfTwo(Math.max(activeLeaves, 1));
  const seedOrder = standardSeedOrder(bracketSize);
  const leavesBySeed = new Map(leaves.map((leaf, index) => [index + 1, leaf]));
  const leafHeight = options.leafHeight ?? 42;
  const rowGap = options.rowGap ?? 22;
  const firstRound = seedOrder.map((seed, index) =>
    makeLeaf(index, seed, leavesBySeed.get(seed) ?? null, leafHeight, rowGap),
  );
  const rounds: ConditionBracketNode<T>[][] = [firstRound];
  let currentRound: ConditionBracketNode<T>[] = firstRound;
  let roundNo = 2;

  while (currentRound.length > 1) {
    const nextRound: ConditionBracketOperatorNode<T>[] = [];

    for (let index = 0; index < currentRound.length; index += 2) {
      nextRound.push(
        makeInternalNode(
          options.baseId,
          roundNo,
          index / 2 + 1,
          currentRound[index],
          currentRound[index + 1],
        ),
      );
    }

    rounds.push(nextRound);
    currentRound = nextRound;
    roundNo += 1;
  }

  const visibleOperators = layoutBracket(rounds);
  const root = rounds[rounds.length - 1][0];

  return {
    rounds,
    visibleOperators,
    rootRep: root.rep,
    height: bracketSize * leafHeight + Math.max(0, bracketSize - 1) * rowGap,
  };
}
