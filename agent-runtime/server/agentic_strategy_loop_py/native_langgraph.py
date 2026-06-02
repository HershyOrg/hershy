#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Native Python LangGraph runner for Hershy agent-loop strategy generation.

This module owns the agent-loop graph. The Node server only passes JSON in and
out; it does not orchestrate the loop.
"""

from __future__ import annotations

import json
import os
import re
import sys
import uuid
import warnings
from datetime import datetime, timezone
from importlib import metadata as importlib_metadata
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple, TypedDict

warnings.filterwarnings("ignore")

from langgraph.graph import END, START, StateGraph


HERSHY_NATIVE_LANGGRAPH_VERSION = "2026-05-24.python-langgraph-native-v2"
HERSHY_BLOCK_MAP_CONTRACT_VERSION = "2026-05-24.block-map-v11-code-first-python-native"
CHAIN_ID_BASE = "8453"
FRONT_ROOT = Path(__file__).resolve().parents[2]

GRAPH_NODE_IDS = [
    "infer_intent",
    "collect_local_evidence",
    "resolve_contracts",
    "audit_data_sources",
    "generate_hershy_code",
    "static_analyze_hershy_code_to_ui",
    "materialize_block_map",
    "validate_block_map",
    "repair_block_map",
    "audit_execution_readiness",
    "write_strategy_summary",
    "finalize_result",
]


class AgentState(TypedDict, total=False):
    prompt: str
    options: Dict[str, Any]
    trace: List[Dict[str, Any]]
    intent: Dict[str, Any]
    evidence_bundle: Dict[str, Any]
    contract_resolution: Dict[str, Any]
    data_source_audit: Dict[str, Any]
    hershy_code_contract: Dict[str, Any]
    static_analysis_contract: Dict[str, Any]
    runtime_graph: Dict[str, Any]
    validation: Dict[str, Any]
    agent_loop_contract_validation: Dict[str, Any]
    repair_attempts: int
    execution_readiness: Dict[str, Any]
    strategy_ai_summary: Dict[str, Any]
    result: Dict[str, Any]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def slugify(value: Any, fallback: str = "item") -> str:
    text = normalize_text(value).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text[:96] or fallback


def uniq(items: List[str]) -> List[str]:
    seen: Set[str] = set()
    out: List[str] = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            out.append(item)
    return out


def langgraph_package_version() -> str:
    try:
        return importlib_metadata.version("langgraph")
    except Exception:
        return "unknown"


def append_trace(state: AgentState, stage: str, label: str, detail: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    return [
        *(state.get("trace") or []),
        {
            "stage": stage,
            "label": label,
            "detail": detail or {},
            "at": utc_now(),
        },
    ]


def output_block(name: str, description: str = "", output_kind: str = "") -> Dict[str, Any]:
    block = {
        "id": slugify(name, "output").replace("-", ""),
        "name": name,
        "type": "output",
    }
    if description:
        block["description"] = description
    if output_kind:
        block["outputKind"] = output_kind
    return block


def input_block(block_id: str, name: Optional[str] = None, description: str = "") -> Dict[str, Any]:
    block = {
        "id": slugify(name or block_id, "input"),
        "name": name or block_id,
        "type": "input",
    }
    if description:
        block["description"] = description
    return block


def logic_description(input_text: str, action_text: str, output_text: str) -> str:
    return "\n".join(
        [
            f"1. 어떤 데이터를 받아와서: {input_text}",
            f"2. 어떤 동작을 수행하고: {action_text}",
            f"3. 어떤 output을 내는지: {output_text}",
        ]
    )


def runtime_required_provenance(fields: List[str], requirement: str, current_source: str = "") -> Dict[str, Any]:
    outputs: Dict[str, Any] = {}
    for field in fields:
        item = {
            "field": field,
            "sourceType": "runtime_adapter_required",
            "status": "unresolved",
            "liveValue": False,
            "adapterRequirement": requirement,
        }
        if current_source:
            item["currentSource"] = current_source
        outputs[field] = item
    return {
        "sourceType": "runtime_adapter_required",
        "status": "unresolved",
        "liveValue": False,
        "outputs": outputs,
        "adapterRequirement": requirement,
        **({"currentSource": current_source} if current_source else {}),
    }


def computed_provenance(field: str, inputs: List[str]) -> Dict[str, Any]:
    return {
        field: {
            "field": field,
            "sourceType": "computed_from_proven_inputs",
            "status": "computed",
            "liveValue": False,
            "inputs": inputs,
            "blockedUntilInputsResolved": True,
        }
    }


def unresolved_contract_provenance(fields: List[str], requirement: str) -> Dict[str, Any]:
    return {
        field: {
            "field": field,
            "sourceType": "agent_contract_resolution_stage",
            "status": "unresolved",
            "liveValue": False,
            "adapterRequirement": requirement,
        }
        for field in fields
    }


def block(block_id: str, block_type: str, workflow_id: str, x: int, y: int, config: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": block_id,
        "type": block_type,
        "position": {"x": x, "y": y},
        "config": {
            **config,
            "workflowId": workflow_id,
        },
    }


def connection(
    conn_id: str,
    kind: str,
    from_id: str,
    to_id: str,
    label: str,
    source_block_id: str = "",
    shared: bool = False,
) -> Dict[str, Any]:
    item = {
        "id": conn_id,
        "kind": kind,
        "fromId": from_id,
        "toId": to_id,
        "label": label,
        "easyLabel": label,
    }
    if source_block_id:
        item["sourceBlockId"] = source_block_id
    if shared:
        item["sharedDataPipeline"] = True
    return item


def read_json_file(path: Path) -> Optional[Dict[str, Any]]:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return None


def infer_requested_assets(prompt: str, options: Dict[str, Any]) -> List[str]:
    raw_assets = options.get("assets")
    assets: List[str] = []
    if isinstance(raw_assets, list):
        assets.extend(normalize_text(item).upper() for item in raw_assets if normalize_text(item))
    elif normalize_text(raw_assets):
        assets.extend(item.strip().upper() for item in normalize_text(raw_assets).split(",") if item.strip())
    prompt_upper = prompt.upper()
    for symbol in ["BTC", "CBBTC", "WBTC", "ETH", "WETH", "USDC", "USDT", "AERO"]:
        if symbol in prompt_upper:
            assets.append("cbBTC" if symbol in {"BTC", "CBBTC", "WBTC"} else symbol)
    return uniq(assets or ["cbBTC"])


def infer_intent_node(state: AgentState) -> Dict[str, Any]:
    prompt = normalize_text(state.get("prompt"))
    options = state.get("options") or {}
    prompt_lower = prompt.lower()
    prompt_korean = prompt
    chain = normalize_text(options.get("chain")) or ("Base" if re.search(r"\bbase\b|베이스", prompt_lower + " " + prompt_korean) else "Base")
    assets = infer_requested_assets(prompt, options)
    is_arbitrage = bool(re.search(r"arbitrage|arb|차익|아비트라지", prompt_lower + " " + prompt_korean))
    is_yield = bool(re.search(r"yield|farm|farming|lend|vault|이자|농사|수익|예치", prompt_lower + " " + prompt_korean))
    if is_arbitrage:
        strategy_kind = "base_dex_arbitrage"
    else:
        strategy_kind = "base_btc_yield"
    if is_yield and not is_arbitrage:
        strategy_kind = "base_btc_yield"
    algorithm_by_kind = {
        "base_dex_arbitrage": ("base_dex_atomic_arbitrage", "Base DEX Atomic Arbitrage"),
        "base_btc_yield": ("base_btc_yield_allocator", "Base BTC Yield Farming"),
    }
    algorithm_id, algorithm_name = algorithm_by_kind[strategy_kind]
    execution_domain = {"id": "base-defi", "label": "Base DeFi", "kgModuleEnabled": True}
    intent = {
        "id": strategy_kind,
        "chain": chain,
        "chainId": CHAIN_ID_BASE if chain.lower() == "base" else "",
        "assets": assets,
        "selectedAlgorithm": {
            "id": algorithm_id,
            "name": algorithm_name,
        },
        "executionDomain": execution_domain,
        "requiresWalletAddress": True,
        "noHallucinationPolicy": "Only materialize live values when source provenance proves runtime polling or evidence-backed static data.",
    }
    return {
        "intent": intent,
        "trace": append_trace(state, "intent", "Python LangGraph intent node completed", {"strategyKind": strategy_kind, "assets": assets}),
    }


def collect_local_evidence_node(state: AgentState) -> Dict[str, Any]:
    intent = state.get("intent") or {}
    base_registry = read_json_file(FRONT_ROOT / "protocols" / "registries" / "defillama-base-top-100.json") or {}
    aero_registry = read_json_file(FRONT_ROOT / "protocols" / "aerodrome.base.json") or {}
    protocols = base_registry.get("protocols") if isinstance(base_registry.get("protocols"), list) else []
    interesting_names = {"Morpho Blue", "Moonwell Vaults", "Aave V3", "Compound V3", "Aerodrome", "Uniswap V3", "PancakeSwap AMM"}
    protocol_evidence = [
        {
            "name": item.get("name"),
            "slug": item.get("slug"),
            "category": item.get("category"),
            "chain": item.get("selectedChain"),
            "selectedChainTvl": item.get("selectedChainTvl"),
            "source": base_registry.get("source", {}),
            "snapshotGeneratedAt": base_registry.get("generatedAt"),
            "provenance": "local_defillama_registry_snapshot",
        }
        for item in protocols
        if item.get("name") in interesting_names or item.get("slug") in {"morpho-blue", "moonwell-vaults", "aerodrome", "uniswap-v3"}
    ][:10]
    aerodrome_contracts = []
    if aero_registry:
        aerodrome_contracts = [
            {
                "protocol": aero_registry.get("protocol", "Aerodrome"),
                "chain": aero_registry.get("chain", "base-mainnet"),
                "address": address,
                "source": aero_registry.get("githubUrl") or aero_registry.get("website"),
                "provenance": "local_protocol_registry",
                "notes": aero_registry.get("notes", ""),
            }
            for address in aero_registry.get("addresses", [])
            if isinstance(address, str)
        ]
    evidence_bundle = {
        "status": "completed",
        "prompt": state.get("prompt"),
        "intent": intent,
        "webSources": [],
        "apiSources": [],
        "chunks": [],
        "entities": [],
        "protocolEvidence": protocol_evidence,
        "contracts": aerodrome_contracts if intent.get("id") == "base_dex_arbitrage" else [],
        "warnings": [
            "Python native loop did not fetch live APR, balance, allowance, liquidity, quote, or paused values. Those outputs stay runtime_adapter_required.",
        ],
    }
    return {
        "evidence_bundle": evidence_bundle,
        "trace": append_trace(
            state,
            "evidence",
            "Python LangGraph local evidence node completed",
            {"protocolEvidence": len(protocol_evidence), "contracts": len(evidence_bundle["contracts"])},
        ),
    }


def resolve_contracts_node(state: AgentState) -> Dict[str, Any]:
    intent = state.get("intent") or {}
    evidence = state.get("evidence_bundle") or {}
    if intent.get("id") == "base_dex_arbitrage":
        aerodrome_addresses = [item.get("address") for item in evidence.get("contracts", []) if item.get("protocol") == "Aerodrome"]
        contract_resolution = {
            "status": "partial",
            "stage": "agent_loop_contract_resolution",
            "chain": "base-mainnet",
            "chainId": CHAIN_ID_BASE,
            "resolvedBy": "python-langgraph-native-contract-resolution-node",
            "protocolContracts": {
                "Aerodrome": {
                    "status": "evidence_backed_static_registry",
                    "addresses": aerodrome_addresses,
                    "source": "protocols/aerodrome.base.json",
                },
                "Uniswap V3": {"status": "unresolved", "reason": "No verified local evidence was loaded in this Python run."},
                "PancakeSwap V3": {"status": "unresolved", "reason": "No verified local evidence was loaded in this Python run."},
            },
            "executorAddress": "ATOMIC_ARBITRAGE_EXECUTOR_REQUIRED",
            "executorAddressStatus": "deployment_required",
            "tokenAddressMap": {},
            "warnings": [
                "Atomic executor deployment address is not configured.",
                "Token addresses and route calldata must be resolved by runtime adapters before live execution.",
            ],
        }
    else:
        contract_resolution = {
            "status": "unresolved",
            "stage": "agent_loop_contract_resolution",
            "chain": "base-mainnet",
            "chainId": CHAIN_ID_BASE,
            "resolvedBy": "python-langgraph-native-contract-resolution-node",
            "depositAsset": "cbBTC",
            "depositAssetAddress": "DEPOSIT_ASSET_ADDRESS_REQUIRED",
            "selectedMarketContractAddress": "YIELD_MARKET_CONTRACT_REQUIRED",
            "spenderAddress": "SPENDER_ADDRESS_REQUIRED",
            "functionSignatures": [],
            "warnings": [
                "Verified Base BTC yield market/vault contract was not found in loaded evidence.",
                "cbBTC balance, allowance, APR, cap, paused, and liquidity reads require a runtime adapter plus EOA wallet address.",
            ],
        }
    return {
        "contract_resolution": contract_resolution,
        "trace": append_trace(
            state,
            "contract-resolution",
            "Python LangGraph contract resolution node completed",
            {"status": contract_resolution.get("status")},
        ),
    }


def audit_data_sources_node(state: AgentState) -> Dict[str, Any]:
    intent = state.get("intent") or {}
    if intent.get("id") == "base_dex_arbitrage":
        required = [
            "walletAddress",
            "tokenInAddress",
            "tokenOutAddress",
            "amountIn",
            "quotedOut",
            "routeData",
            "gasCostUsd",
            "allowanceAmount",
            "simulationStatus",
            "executorAddress",
        ]
    else:
        required = [
            "walletAddress",
            "walletBalance",
            "allowanceAmount",
            "netApr",
            "paused",
            "supplyCapRemaining",
            "withdrawalLiquidity",
            "claimableRewardUsd",
            "positionValueUsd",
            "depositAssetAddress",
            "selectedMarketContractAddress",
            "spenderAddress",
        ]
    audit = {
        "status": "runtime_adapter_required",
        "checkedFields": required,
        "livePolledFields": [],
        "runtimeAdapterRequiredFields": required,
        "rules": [
            "Every formula input must trace to a source block.",
            "Source blocks must mark live polled, evidence backed, computed, or unresolved provenance.",
            "Unresolved values may appear in the graph only as blocked paper-mode data.",
        ],
    }
    return {
        "data_source_audit": audit,
        "trace": append_trace(state, "data-source-audit", "Python LangGraph data source audit node completed", {"missing": len(required)}),
    }


def generate_hershy_code_node(state: AgentState) -> Dict[str, Any]:
    contract = {
        "status": "contract_declared",
        "sourceOfTruth": "generated_strategy.go",
        "generationPoint": "server-runtime-artifact-stage",
        "requiredOrder": [
            "materialize validated runtime graph",
            "generate generated_strategy.go",
            "static analyze generated_strategy.go",
            "render UI from the analyzed runtime artifact",
        ],
        "uiEditPolicy": "Every UI edit must regenerate generated_strategy.go before the code view is considered synced.",
        "notes": [
            "The Python LangGraph node records the code-first contract.",
            "The Node runtime-artifacts stage performs actual Go code generation and static-analysis consistency checks.",
        ],
    }
    return {
        "hershy_code_contract": contract,
        "trace": append_trace(state, "hershy-code-contract", "Hershy code-first contract declared", {"sourceOfTruth": contract["sourceOfTruth"]}),
    }


def static_analyze_hershy_code_to_ui_node(state: AgentState) -> Dict[str, Any]:
    contract = {
        "status": "contract_declared",
        "analysisSource": "generated_strategy.go",
        "uiDerivation": "static-analysis-of-generated-runtime-artifact",
        "requiredChecks": [
            "generated_strategy.go contains all runtime block IDs",
            "generated_strategy.go contains all runtime connection IDs",
            "UI node snippets must be extracted from generated_strategy.go",
            "UI is stale whenever its graph signature differs from the latest analyzed generated_strategy.go",
        ],
    }
    return {
        "static_analysis_contract": contract,
        "trace": append_trace(state, "static-analysis-contract", "Static-analysis-to-UI contract declared", {"analysisSource": contract["analysisSource"]}),
    }


def build_graph_summary(blocks: List[Dict[str, Any]], connections: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_type: Dict[str, int] = {}
    for item in blocks:
        by_type[item.get("type", "unknown")] = by_type.get(item.get("type", "unknown"), 0) + 1
    return {"blocks": len(blocks), "connections": len(connections), "byType": by_type}


def build_agent_contract_metadata(workflow_groups: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "version": HERSHY_BLOCK_MAP_CONTRACT_VERSION,
        "nativeEngine": "python-langgraph",
        "blockMapRules": [
            "visible_graph_trading_logic_only",
            "data_pipeline_left_sequence_middle_monitoring_right",
            "data_pipeline_contains_streaming_and_indicator_only",
            "one_check_effect_sequence_per_action",
            "no_sequence_to_sequence_edges",
            "shared_pipeline_edges_to_checks_are_red",
            "trigger_formula_is_output_block_named_trigger",
            "plain_korean_indicator_logic_description_required",
            "no_hallucinated_live_values",
            "formula_source_lineage_audit_required",
            "hershy_generated_strategy_go_is_runtime_source_of_truth",
            "ui_block_map_must_be_derivable_from_static_analysis",
            "ui_edits_must_regenerate_and_reanalyze_hershy_code",
        ],
        "sourceOfTruth": "generated_strategy.go",
        "uiDerivationPolicy": "Render UI from a statically analyzed Hershy runtime artifact, then keep UI edits synchronized by regenerating generated_strategy.go.",
        "workflowGroupIds": [group.get("id") for group in workflow_groups],
    }


def build_base_btc_yield_graph(state: AgentState) -> Dict[str, Any]:
    prompt = state.get("prompt") or ""
    intent = state.get("intent") or {}
    contract_resolution = state.get("contract_resolution") or {}
    data_audit = state.get("data_source_audit") or {}
    generated_at = utc_now()
    pipeline_id = "pipeline-base-btc-yield"
    approve_seq = "seq-yield-approve"
    deposit_seq = "seq-yield-deposit"
    claim_seq = "seq-yield-claim"
    exit_seq = "seq-yield-exit"
    monitor_seq = "monitor-yield-state"
    market_fields = [
        "netApr",
        "rewardApr",
        "withdrawalLiquidity",
        "utilization",
        "supplyCapRemaining",
        "paused",
        "oracleRisk",
        "adminRisk",
        "gasCost",
        "walletBalance",
        "allowanceAmount",
        "positionValueUsd",
        "claimableRewardUsd",
        "killSwitch",
        "eventTime",
    ]
    adapter_requirement = (
        "Base BTC yield adapter plus EOA wallet address. Required reads: APR, paused/cap/liquidity, "
        "cbBTC balanceOf(wallet), allowance(wallet, spender), position value, and claimable rewards."
    )
    resolver_fields = [
        "depositAssetAddress",
        "selectedMarketContractAddress",
        "spenderAddress",
        "contractResolutionStatus",
    ]
    blocks = [
        block(
            "yield-market-source",
            "streaming",
            pipeline_id,
            60,
            120,
            {
                "name": "Base BTC yield market data",
                "sourceUrl": normalize_text((state.get("options") or {}).get("rpcUrl")) or "https://mainnet.base.org",
                "url": normalize_text((state.get("options") or {}).get("rpcUrl")) or "https://mainnet.base.org",
                "method": "POLLING",
                "streamKind": "evm-rpc",
                "streamChain": "base-mainnet",
                "streamMethod": "eth_blockNumber",
                "streamParamsJson": "[]",
                "sourceKind": "rpc",
                "externalSource": True,
                "updateMode": "periodic",
                "updateIntervalMs": 5000,
                "intervalMs": 5000,
                "chainId": CHAIN_ID_BASE,
                "fields": market_fields,
                "dataAvailabilityStatus": "runtime_adapter_required",
                "dataProvenance": runtime_required_provenance(market_fields, adapter_requirement, "evm_rpc_block_health_only"),
                "overviewDescription": "Base 블록은 읽지만 APR, 잔고, allowance, 유동성 값은 아직 실제 어댑터가 필요합니다.",
                "outputBlocks": [output_block(field) for field in market_fields],
            },
        ),
        block(
            "yield-contract-resolver",
            "normal",
            pipeline_id,
            360,
            120,
            {
                "name": "Yield contract resolver",
                "functionName": "resolveYieldContracts",
                "expression": "agent evidence -> depositAssetAddress, selectedMarketContractAddress, spenderAddress",
                "logicDescription": logic_description(
                    "Base BTC 이자농사에 필요한 예치 토큰, 마켓 컨트랙트, spender 주소 후보를 받아옵니다.",
                    "증거가 있는 주소만 확정하고, 증거가 없으면 실행에 쓰지 못하도록 unresolved로 남깁니다.",
                    "예치 토큰 주소, 마켓 컨트랙트 주소, spender 주소, 해석 상태를 내보냅니다.",
                ),
                "logicDescriptionAuthor": "python-langgraph-native",
                "dataProvenance": unresolved_contract_provenance(
                    resolver_fields,
                    "Agent contract-resolution node must load verified Base yield market evidence before these outputs can become live executable.",
                ),
                "inputBlocks": [input_block("agent-evidence", "agentEvidence")],
                "outputBlocks": [output_block(field) for field in resolver_fields],
                "contractResolutionStatus": contract_resolution.get("status", "unresolved"),
                "depositAssetAddress": contract_resolution.get("depositAssetAddress"),
                "selectedMarketContractAddress": contract_resolution.get("selectedMarketContractAddress"),
                "spenderAddress": contract_resolution.get("spenderAddress"),
            },
        ),
        block(
            "yield-score",
            "normal",
            pipeline_id,
            660,
            120,
            {
                "name": "Yield safety score",
                "functionName": "scoreYieldMarket",
                "expression": "yield-market-source::netApr*0.35 + yield-market-source::withdrawalLiquidity*0.20 + yield-market-source::utilization*0.15 - yield-market-source::oracleRisk*0.08 - yield-market-source::adminRisk*0.05 - yield-market-source::gasCost*0.05",
                "logicDescription": logic_description(
                    "예상 순이자율, 빠져나올 수 있는 유동성, 시장 사용률, 오라클/관리자 위험, 가스비를 받아옵니다.",
                    "수익이 높고 위험과 비용이 낮을수록 점수가 올라가도록 하나의 안전 점수로 합칩니다.",
                    "예치나 출금 판단에 쓸 score 값을 내보냅니다.",
                ),
                "logicDescriptionAuthor": "python-langgraph-native",
                "dataProvenance": computed_provenance("score", ["yield-market-source"]),
                "inputBlocks": [input_block("yield-market-source", "marketData")],
                "outputBlocks": [output_block("score")],
            },
        ),
        block(
            "approve-trigger",
            "trigger",
            approve_seq,
            60,
            80,
            {
                "name": "Approve",
                "triggerType": "condition",
                "materializedTriggerFormula": True,
                "condition": "yield-score::score >= 0.70 && yield-market-source::paused == false && yield-market-source::allowanceAmount <= 0 && yield-market-source::walletBalance > 0 && yield-contract-resolver::contractResolutionStatus == 'resolved'",
                "logicDescription": logic_description(
                    "시장 안전 점수, 일시정지 여부, 현재 allowance, 지갑 잔고, 컨트랙트 해석 상태를 받아옵니다.",
                    "예치가 가능하지만 아직 승인 금액이 부족한 상황인지 확인합니다.",
                    "승인을 실행해도 되는 trigger 값을 내보냅니다.",
                ),
                "checkEffect": True,
                "checkRole": "check",
                "checkContextSources": ["yield-market-source", "yield-contract-resolver", "yield-score"],
                "inputBlocks": [input_block("yield-market-source"), input_block("yield-contract-resolver"), input_block("yield-score")],
                "outputBlocks": [output_block("trigger", "조건식 결과 boolean 데이터", "boolean-data")],
            },
        ),
        block(
            "approve-yield-asset",
            "action",
            approve_seq,
            360,
            80,
            {
                "name": "Approve yield asset",
                "actionType": "dex",
                "chainId": CHAIN_ID_BASE,
                "evmChain": "base-mainnet",
                "contractAddress": contract_resolution.get("depositAssetAddress", "DEPOSIT_ASSET_ADDRESS_REQUIRED"),
                "contractAddressStatus": "unresolved",
                "functionName": "approve",
                "evmFunctionName": "approve",
                "executionMode": "paper",
                "paperStatus": "NOT_LIVE_EXECUTABLE_CONTRACTS_REQUIRED",
                "inputBlocks": [input_block("approve-trigger", "trigger"), input_block("spenderAddress"), input_block("amount")],
                "outputBlocks": [output_block("status"), output_block("txHash")],
                "overviewDescription": "승인 컨트랙트와 spender가 증거로 확정되기 전까지 실제 트랜잭션을 보내지 않습니다.",
            },
        ),
        block(
            "deposit-trigger",
            "trigger",
            deposit_seq,
            60,
            220,
            {
                "name": "Deposit",
                "triggerType": "condition",
                "materializedTriggerFormula": True,
                "condition": "yield-score::score >= 0.70 && yield-market-source::paused == false && yield-market-source::allowanceAmount > 0 && yield-market-source::walletBalance > 0 && yield-market-source::supplyCapRemaining > 0 && yield-market-source::killSwitch == 0 && yield-contract-resolver::contractResolutionStatus == 'resolved'",
                "logicDescription": logic_description(
                    "시장 안전 점수, 중단 여부, 승인 금액, 지갑 잔고, 남은 예치 한도, 비상 중단 상태를 받아옵니다.",
                    "돈을 넣어도 되는 상태인지와 승인/한도/잔고가 모두 충분한지 확인합니다.",
                    "예치를 실행해도 되는 trigger 값을 내보냅니다.",
                ),
                "checkEffect": True,
                "checkRole": "check",
                "checkContextSources": ["yield-market-source", "yield-contract-resolver", "yield-score"],
                "inputBlocks": [input_block("yield-market-source"), input_block("yield-contract-resolver"), input_block("yield-score")],
                "outputBlocks": [output_block("trigger", "조건식 결과 boolean 데이터", "boolean-data")],
            },
        ),
        block(
            "deposit-yield-asset",
            "action",
            deposit_seq,
            360,
            220,
            {
                "name": "Deposit into yield market",
                "actionType": "dex",
                "chainId": CHAIN_ID_BASE,
                "evmChain": "base-mainnet",
                "contractAddress": contract_resolution.get("selectedMarketContractAddress", "YIELD_MARKET_CONTRACT_REQUIRED"),
                "contractAddressStatus": "unresolved",
                "functionName": "adapter_required",
                "evmFunctionName": "deposit_or_supply_required",
                "executionMode": "paper",
                "paperStatus": "NOT_LIVE_EXECUTABLE_MARKET_CONTRACT_REQUIRED",
                "inputBlocks": [input_block("deposit-trigger", "trigger"), input_block("asset"), input_block("amount")],
                "outputBlocks": [output_block("status"), output_block("txHash"), output_block("positionShares")],
                "overviewDescription": "프로토콜별 deposit/supply 함수와 마켓 주소가 확정된 뒤에만 live 실행으로 바뀔 수 있습니다.",
            },
        ),
        block(
            "claim-trigger",
            "trigger",
            claim_seq,
            60,
            360,
            {
                "name": "Claim",
                "triggerType": "condition",
                "materializedTriggerFormula": True,
                "condition": "yield-market-source::claimableRewardUsd >= 5 && yield-market-source::positionValueUsd > 0 && yield-market-source::killSwitch == 0 && yield-contract-resolver::contractResolutionStatus == 'resolved'",
                "logicDescription": logic_description(
                    "받을 수 있는 보상 금액, 현재 포지션 가치, 비상 중단 상태, 컨트랙트 해석 상태를 받아옵니다.",
                    "보상이 너무 작을 때는 가스비를 아끼고, 받을 만한 금액이 쌓였는지 확인합니다.",
                    "보상 수령을 실행해도 되는 trigger 값을 내보냅니다.",
                ),
                "checkEffect": True,
                "checkRole": "check",
                "checkContextSources": ["yield-market-source", "yield-contract-resolver"],
                "inputBlocks": [input_block("yield-market-source"), input_block("yield-contract-resolver")],
                "outputBlocks": [output_block("trigger", "조건식 결과 boolean 데이터", "boolean-data")],
            },
        ),
        block(
            "claim-yield-rewards",
            "action",
            claim_seq,
            360,
            360,
            {
                "name": "Claim rewards",
                "actionType": "dex",
                "chainId": CHAIN_ID_BASE,
                "evmChain": "base-mainnet",
                "contractAddress": contract_resolution.get("selectedMarketContractAddress", "YIELD_MARKET_CONTRACT_REQUIRED"),
                "contractAddressStatus": "unresolved",
                "functionName": "claim_required",
                "executionMode": "paper",
                "paperStatus": "NOT_LIVE_EXECUTABLE_CLAIM_FUNCTION_REQUIRED",
                "inputBlocks": [input_block("claim-trigger", "trigger")],
                "outputBlocks": [output_block("status"), output_block("txHash"), output_block("claimedAmount")],
            },
        ),
        block(
            "exit-trigger",
            "trigger",
            exit_seq,
            60,
            500,
            {
                "name": "Exit",
                "triggerType": "condition",
                "materializedTriggerFormula": True,
                "condition": "yield-market-source::killSwitch == 1 || yield-market-source::paused == true || yield-score::score < 0.45 || yield-market-source::withdrawalLiquidity <= 0",
                "logicDescription": logic_description(
                    "비상 중단 값, 시장 중단 여부, 안전 점수, 출금 유동성을 받아옵니다.",
                    "위험이 커졌거나 빠져나올 유동성이 사라지기 전에 포지션을 줄여야 하는지 확인합니다.",
                    "출금을 실행해야 하는 trigger 값을 내보냅니다.",
                ),
                "checkEffect": True,
                "checkRole": "check",
                "checkContextSources": ["yield-market-source", "yield-score"],
                "inputBlocks": [input_block("yield-market-source"), input_block("yield-score")],
                "outputBlocks": [output_block("trigger", "조건식 결과 boolean 데이터", "boolean-data")],
            },
        ),
        block(
            "withdraw-yield-asset",
            "action",
            exit_seq,
            360,
            500,
            {
                "name": "Withdraw from yield market",
                "actionType": "dex",
                "chainId": CHAIN_ID_BASE,
                "evmChain": "base-mainnet",
                "contractAddress": contract_resolution.get("selectedMarketContractAddress", "YIELD_MARKET_CONTRACT_REQUIRED"),
                "contractAddressStatus": "unresolved",
                "functionName": "withdraw_required",
                "executionMode": "paper",
                "paperStatus": "NOT_LIVE_EXECUTABLE_WITHDRAW_FUNCTION_REQUIRED",
                "inputBlocks": [input_block("exit-trigger", "trigger"), input_block("positionShares")],
                "outputBlocks": [output_block("status"), output_block("txHash"), output_block("withdrawnAmount")],
            },
        ),
        block(
            "yield-monitor",
            "monitoring",
            monitor_seq,
            60,
            120,
            {
                "name": "Yield monitor",
                "format": "values",
                "selectedVariables": ["netApr", "walletBalance", "allowanceAmount", "positionValueUsd", "claimableRewardUsd", "lastActionStatus"],
                "overviewDescription": "실제 어댑터가 붙은 뒤 APR, 잔고, 승인 금액, 포지션 상태를 감시합니다.",
            },
        ),
    ]
    connections = [
        connection("yield-market-to-score", "data-flow", "yield-market-source", "yield-score", "점수 계산", "netapr"),
        connection("yield-resolver-to-score", "data-flow", "yield-contract-resolver", "yield-score", "컨트랙트 상태", "contractresolutionstatus"),
        connection("yield-market-to-approve", "data-flow", "yield-market-source", "approve-trigger", "공통 데이터", "allowanceamount", True),
        connection("yield-resolver-to-approve", "data-flow", "yield-contract-resolver", "approve-trigger", "주소 확인", "contractresolutionstatus", True),
        connection("yield-score-to-approve", "data-flow", "yield-score", "approve-trigger", "안전 점수", "score", True),
        connection("approve-trigger-to-action", "trigger-action", "approve-trigger", "approve-yield-asset", "승인 실행", "trigger"),
        connection("yield-market-to-deposit", "data-flow", "yield-market-source", "deposit-trigger", "공통 데이터", "walletbalance", True),
        connection("yield-resolver-to-deposit", "data-flow", "yield-contract-resolver", "deposit-trigger", "주소 확인", "contractresolutionstatus", True),
        connection("yield-score-to-deposit", "data-flow", "yield-score", "deposit-trigger", "예치 판단", "score", True),
        connection("deposit-trigger-to-action", "trigger-action", "deposit-trigger", "deposit-yield-asset", "예치 실행", "trigger"),
        connection("yield-market-to-claim", "data-flow", "yield-market-source", "claim-trigger", "보상 확인", "claimablerewardusd", True),
        connection("yield-resolver-to-claim", "data-flow", "yield-contract-resolver", "claim-trigger", "주소 확인", "contractresolutionstatus", True),
        connection("claim-trigger-to-action", "trigger-action", "claim-trigger", "claim-yield-rewards", "보상 수령", "trigger"),
        connection("yield-market-to-exit", "data-flow", "yield-market-source", "exit-trigger", "위험 확인", "killswitch", True),
        connection("yield-score-to-exit", "data-flow", "yield-score", "exit-trigger", "위험 점수", "score", True),
        connection("exit-trigger-to-action", "trigger-action", "exit-trigger", "withdraw-yield-asset", "출금 실행", "trigger"),
        connection("yield-market-to-monitor", "stream-monitor", "yield-market-source", "yield-monitor", "상태 표시", "netapr"),
        connection("deposit-result-to-monitor", "action-result", "deposit-yield-asset", "yield-monitor", "예치 결과", "status"),
        connection("claim-result-to-monitor", "action-result", "claim-yield-rewards", "yield-monitor", "보상 결과", "status"),
        connection("withdraw-result-to-monitor", "action-result", "withdraw-yield-asset", "yield-monitor", "출금 결과", "status"),
    ]
    groups = [
        {
            "id": pipeline_id,
            "title": "Base BTC 데이터 파이프라인",
            "purpose": "예치 판단에 필요한 시장, 지갑, 컨트랙트 해석 데이터를 한 번 읽고 여러 check 시퀀스에 공급합니다.",
            "sequenceType": "data-pipeline",
            "order": 1,
            "nodeIds": ["yield-market-source", "yield-contract-resolver", "yield-score"],
            "canAbstract": False,
            "mustStayVisibleNodeIds": ["yield-market-source", "yield-contract-resolver", "yield-score"],
            "sharedDataPipeline": True,
        },
        {
            "id": approve_seq,
            "title": "Approve 시퀀스",
            "purpose": "승인이 부족할 때만 예치 토큰 allowance를 열어줍니다.",
            "sequenceType": "check-effect",
            "order": 2,
            "nodeIds": ["approve-trigger", "approve-yield-asset"],
            "canAbstract": False,
            "mustStayVisibleNodeIds": ["approve-trigger", "approve-yield-asset"],
            "checkEffect": {"checkNodeId": "approve-trigger", "effectNodeId": "approve-yield-asset", "reusableInputsOnly": ["yield-market-source", "yield-contract-resolver", "yield-score"]},
        },
        {
            "id": deposit_seq,
            "title": "Deposit 시퀀스",
            "purpose": "시장과 지갑 상태가 모두 통과될 때만 실제 예치 액션을 준비합니다.",
            "sequenceType": "check-effect",
            "order": 3,
            "nodeIds": ["deposit-trigger", "deposit-yield-asset"],
            "canAbstract": False,
            "mustStayVisibleNodeIds": ["deposit-trigger", "deposit-yield-asset"],
            "checkEffect": {"checkNodeId": "deposit-trigger", "effectNodeId": "deposit-yield-asset", "reusableInputsOnly": ["yield-market-source", "yield-contract-resolver", "yield-score"]},
        },
        {
            "id": claim_seq,
            "title": "Claim 시퀀스",
            "purpose": "받을 보상이 충분히 쌓였을 때만 보상 수령 액션을 준비합니다.",
            "sequenceType": "check-effect",
            "order": 4,
            "nodeIds": ["claim-trigger", "claim-yield-rewards"],
            "canAbstract": False,
            "mustStayVisibleNodeIds": ["claim-trigger", "claim-yield-rewards"],
            "checkEffect": {"checkNodeId": "claim-trigger", "effectNodeId": "claim-yield-rewards", "reusableInputsOnly": ["yield-market-source", "yield-contract-resolver"]},
        },
        {
            "id": exit_seq,
            "title": "Exit 시퀀스",
            "purpose": "비상 중단, 시장 중단, 점수 하락이 감지되면 출금 액션을 준비합니다.",
            "sequenceType": "check-effect",
            "order": 5,
            "nodeIds": ["exit-trigger", "withdraw-yield-asset"],
            "canAbstract": False,
            "mustStayVisibleNodeIds": ["exit-trigger", "withdraw-yield-asset"],
            "checkEffect": {"checkNodeId": "exit-trigger", "effectNodeId": "withdraw-yield-asset", "reusableInputsOnly": ["yield-market-source", "yield-score"]},
        },
        {
            "id": monitor_seq,
            "title": "모니터링 시퀀스",
            "purpose": "데이터와 실행 결과를 관찰만 하고 다른 매매 로직을 구동하지 않습니다.",
            "sequenceType": "monitoring",
            "order": 90,
            "nodeIds": ["yield-monitor"],
            "canAbstract": False,
            "mustStayVisibleNodeIds": ["yield-monitor"],
        },
    ]
    return {
        "schemaVersion": 1,
        "kind": "hershy-strategy-graph",
        "strategy": {"id": "base-btc-yield-python-native", "name": "Base BTC Yield Farming"},
        "generatedAt": generated_at,
        "metadata": {
            "strategyKind": "base_btc_yield",
            "executionDomain": intent.get("executionDomain"),
            "sourcePrompt": prompt,
            "agenticWorkflow": True,
            "aiLoopInternalized": True,
            "visibleGraphScope": "trading-logic-only",
            "externalPollingSource": True,
            "workflowPlan": intent,
            "evidenceBundle": state.get("evidence_bundle"),
            "strategyBlock": {
                "id": "strategy-base-btc-yield",
                "title": "Base BTC 이자농사 전략",
                "purpose": "Base에서 BTC 계열 자산을 예치하되, 실제 증거가 없는 주소와 값은 paper-only로 막습니다.",
                "nodeIds": [item["id"] for item in blocks],
            },
            "workflowGroups": groups,
            "checkEffectGraph": True,
            "sequenceIsolation": "one-check-effect-sequence-per-action",
            "reusablePipelinePolicy": "only data-pipeline outputs may feed multiple check nodes",
            "contractResolution": contract_resolution,
            "dataSourceAudit": data_audit,
            "internalizedAgentPhases": [
                "intent",
                "evidence",
                "contract_resolution",
                "data_source_audit",
                "block_map_validation",
                "execution_readiness",
            ],
            "agentLoopContract": build_agent_contract_metadata(groups),
        },
        "summary": build_graph_summary(blocks, connections),
        "blocks": blocks,
        "connections": connections,
    }


def build_base_dex_arbitrage_graph(state: AgentState) -> Dict[str, Any]:
    prompt = state.get("prompt") or ""
    intent = state.get("intent") or {}
    contract_resolution = state.get("contract_resolution") or {}
    data_audit = state.get("data_source_audit") or {}
    generated_at = utc_now()
    pipeline_id = "pipeline-base-dex-quotes"
    approve_seq = "seq-arb-approve"
    simulate_seq = "seq-arb-simulate"
    execute_seq = "seq-arb-execute"
    monitor_seq = "monitor-arb-state"
    quote_fields = [
        "amountIn",
        "quotedOut",
        "routeData",
        "tokenInAddress",
        "tokenOutAddress",
        "gasCostUsd",
        "priceImpactBps",
        "slippageBufferUsd",
        "allowanceAmount",
        "walletBalance",
        "executorAddress",
        "simulationStatus",
        "simulatedProfitUsd",
        "killSwitch",
    ]
    adapter_requirement = (
        "Base DEX quote/simulation adapter plus EOA wallet address. Required reads: venue quotes, "
        "route calldata, allowance, wallet token balance, gas estimate, and eth_call simulation."
    )
    resolver_fields = ["protocolContracts", "tokenAddressMap", "executorAddress", "contractResolutionStatus"]
    blocks = [
        block(
            "base-dex-quote-source",
            "streaming",
            pipeline_id,
            60,
            120,
            {
                "name": "Base DEX quote stream",
                "sourceUrl": normalize_text((state.get("options") or {}).get("rpcUrl")) or "https://mainnet.base.org",
                "url": normalize_text((state.get("options") or {}).get("rpcUrl")) or "https://mainnet.base.org",
                "method": "POLLING",
                "streamKind": "evm-rpc",
                "streamChain": "base-mainnet",
                "streamMethod": "eth_blockNumber",
                "streamParamsJson": "[]",
                "chainId": CHAIN_ID_BASE,
                "fields": quote_fields,
                "dataAvailabilityStatus": "runtime_adapter_required",
                "dataProvenance": runtime_required_provenance(quote_fields, adapter_requirement, "evm_rpc_block_health_only"),
                "outputBlocks": [output_block(field) for field in quote_fields],
                "overviewDescription": "Base 블록은 읽지만 quote, routeData, gas, simulation 값은 아직 실제 어댑터가 필요합니다.",
            },
        ),
        block(
            "base-dex-contract-resolver",
            "normal",
            pipeline_id,
            360,
            120,
            {
                "name": "Base DEX contract resolver",
                "functionName": "resolveBaseDexContracts",
                "expression": "agent evidence -> routers, quoters, factories, tokenAddressMap, executorAddress",
                "logicDescription": logic_description(
                    "Base DEX 후보와 로컬 증거에 있는 컨트랙트 정보를 받아옵니다.",
                    "증거가 있는 주소만 사용 가능으로 표시하고, 빠진 router/quoter/token/executor는 unresolved로 막습니다.",
                    "프로토콜 컨트랙트 목록, 토큰 주소 맵, executor 주소, 해석 상태를 내보냅니다.",
                ),
                "logicDescriptionAuthor": "python-langgraph-native",
                "dataProvenance": unresolved_contract_provenance(
                    resolver_fields,
                    "Agent contract-resolution node must provide verified routers/quoters/factories/tokens/executor before live arbitrage.",
                ),
                "protocolContracts": contract_resolution.get("protocolContracts", {}),
                "executorAddress": contract_resolution.get("executorAddress", "ATOMIC_ARBITRAGE_EXECUTOR_REQUIRED"),
                "contractResolutionStatus": contract_resolution.get("status", "partial"),
                "inputBlocks": [input_block("agent-evidence", "agentEvidence")],
                "outputBlocks": [output_block(field) for field in resolver_fields],
            },
        ),
        block(
            "arb-profit-score",
            "normal",
            pipeline_id,
            660,
            120,
            {
                "name": "Arbitrage profit score",
                "functionName": "scoreArbitrageRoute",
                "expression": "base-dex-quote-source::quotedOut - base-dex-quote-source::amountIn - base-dex-quote-source::gasCostUsd - base-dex-quote-source::slippageBufferUsd",
                "logicDescription": logic_description(
                    "투입 금액, 받을 것으로 예상되는 금액, 가스비, 미끄러짐 여유분을 받아옵니다.",
                    "받을 금액에서 비용과 안전 여유분을 빼서 실제로 남을 수 있는 수익을 계산합니다.",
                    "거래를 진행해도 되는 예상 순수익 profitUsd를 내보냅니다.",
                ),
                "logicDescriptionAuthor": "python-langgraph-native",
                "dataProvenance": computed_provenance("profitUsd", ["base-dex-quote-source"]),
                "inputBlocks": [input_block("base-dex-quote-source", "quoteData")],
                "outputBlocks": [output_block("profitUsd")],
            },
        ),
        block(
            "arb-approve-trigger",
            "trigger",
            approve_seq,
            60,
            80,
            {
                "name": "Approve",
                "triggerType": "condition",
                "materializedTriggerFormula": True,
                "condition": "arb-profit-score::profitUsd > 0 && base-dex-quote-source::allowanceAmount <= 0 && base-dex-quote-source::walletBalance > 0 && base-dex-contract-resolver::contractResolutionStatus == 'resolved'",
                "logicDescription": logic_description(
                    "예상 순수익, 승인 금액, 지갑 잔고, 컨트랙트 해석 상태를 받아옵니다.",
                    "아비트라지 실행 전에 토큰 승인이 필요한 상황인지 확인합니다.",
                    "승인을 실행해도 되는 trigger 값을 내보냅니다.",
                ),
                "checkEffect": True,
                "checkRole": "check",
                "inputBlocks": [input_block("base-dex-quote-source"), input_block("base-dex-contract-resolver"), input_block("arb-profit-score")],
                "outputBlocks": [output_block("trigger", "조건식 결과 boolean 데이터", "boolean-data")],
            },
        ),
        block(
            "approve-arb-token",
            "action",
            approve_seq,
            360,
            80,
            {
                "name": "Approve arbitrage token",
                "actionType": "dex",
                "chainId": CHAIN_ID_BASE,
                "evmChain": "base-mainnet",
                "contractAddress": "TOKEN_IN_ADDRESS_REQUIRED",
                "functionName": "approve",
                "executionMode": "paper",
                "paperStatus": "NOT_LIVE_EXECUTABLE_TOKEN_AND_SPENDER_REQUIRED",
                "inputBlocks": [input_block("arb-approve-trigger", "trigger"), input_block("spender"), input_block("amount")],
                "outputBlocks": [output_block("status"), output_block("txHash")],
            },
        ),
        block(
            "arb-simulate-trigger",
            "trigger",
            simulate_seq,
            60,
            220,
            {
                "name": "Simulate",
                "triggerType": "condition",
                "materializedTriggerFormula": True,
                "condition": "arb-profit-score::profitUsd > 0 && base-dex-quote-source::routeData != '' && base-dex-contract-resolver::executorAddress != 'ATOMIC_ARBITRAGE_EXECUTOR_REQUIRED'",
                "logicDescription": logic_description(
                    "예상 순수익, 경로 데이터, executor 주소를 받아옵니다.",
                    "트랜잭션을 보내기 전에 같은 경로가 시뮬레이션 가능한 상태인지 확인합니다.",
                    "시뮬레이션을 실행해도 되는 trigger 값을 내보냅니다.",
                ),
                "checkEffect": True,
                "checkRole": "check",
                "inputBlocks": [input_block("base-dex-quote-source"), input_block("base-dex-contract-resolver"), input_block("arb-profit-score")],
                "outputBlocks": [output_block("trigger", "조건식 결과 boolean 데이터", "boolean-data")],
            },
        ),
        block(
            "simulate-arb-route",
            "action",
            simulate_seq,
            360,
            220,
            {
                "name": "Simulate arbitrage route",
                "actionType": "dex",
                "chainId": CHAIN_ID_BASE,
                "evmChain": "base-mainnet",
                "contractAddress": contract_resolution.get("executorAddress", "ATOMIC_ARBITRAGE_EXECUTOR_REQUIRED"),
                "functionName": "simulate",
                "executionMode": "paper",
                "paperStatus": "NOT_LIVE_EXECUTABLE_EXECUTOR_REQUIRED",
                "inputBlocks": [input_block("arb-simulate-trigger", "trigger"), input_block("routeData"), input_block("amountIn")],
                "outputBlocks": [output_block("status"), output_block("simulatedProfitUsd")],
            },
        ),
        block(
            "arb-execute-trigger",
            "trigger",
            execute_seq,
            60,
            360,
            {
                "name": "Execute",
                "triggerType": "condition",
                "materializedTriggerFormula": True,
                "condition": "arb-profit-score::profitUsd >= 3 && base-dex-quote-source::simulationStatus == 'success' && base-dex-quote-source::killSwitch == 0 && base-dex-contract-resolver::contractResolutionStatus == 'resolved'",
                "logicDescription": logic_description(
                    "예상 순수익, 시뮬레이션 성공 여부, 비상 중단 상태, 컨트랙트 해석 상태를 받아옵니다.",
                    "실행 전에 수익 기준과 안전 조건이 모두 통과됐는지 확인합니다.",
                    "아비트라지 실행을 보내도 되는 trigger 값을 내보냅니다.",
                ),
                "checkEffect": True,
                "checkRole": "check",
                "inputBlocks": [input_block("base-dex-quote-source"), input_block("base-dex-contract-resolver"), input_block("arb-profit-score")],
                "outputBlocks": [output_block("trigger", "조건식 결과 boolean 데이터", "boolean-data")],
            },
        ),
        block(
            "execute-arb-route",
            "action",
            execute_seq,
            360,
            360,
            {
                "name": "Execute arbitrage route",
                "actionType": "dex",
                "chainId": CHAIN_ID_BASE,
                "evmChain": "base-mainnet",
                "contractAddress": contract_resolution.get("executorAddress", "ATOMIC_ARBITRAGE_EXECUTOR_REQUIRED"),
                "functionName": "executeArbitrage",
                "executionMode": "paper",
                "paperStatus": "NOT_LIVE_EXECUTABLE_EXECUTOR_AND_CALLDATA_REQUIRED",
                "inputBlocks": [input_block("arb-execute-trigger", "trigger"), input_block("routeData"), input_block("minProfitUsd")],
                "outputBlocks": [output_block("status"), output_block("txHash"), output_block("realizedProfitUsd")],
            },
        ),
        block(
            "arb-monitor",
            "monitoring",
            monitor_seq,
            60,
            120,
            {
                "name": "Arbitrage monitor",
                "format": "values",
                "selectedVariables": ["profitUsd", "simulationStatus", "gasCostUsd", "status", "txHash"],
            },
        ),
    ]
    connections = [
        connection("quotes-to-profit", "data-flow", "base-dex-quote-source", "arb-profit-score", "수익 계산", "quotedout"),
        connection("resolver-to-profit", "data-flow", "base-dex-contract-resolver", "arb-profit-score", "주소 확인", "contractresolutionstatus"),
        connection("quotes-to-approve", "data-flow", "base-dex-quote-source", "arb-approve-trigger", "공통 데이터", "allowanceamount", True),
        connection("resolver-to-approve", "data-flow", "base-dex-contract-resolver", "arb-approve-trigger", "주소 확인", "contractresolutionstatus", True),
        connection("profit-to-approve", "data-flow", "arb-profit-score", "arb-approve-trigger", "수익 확인", "profitusd", True),
        connection("approve-trigger-to-action", "trigger-action", "arb-approve-trigger", "approve-arb-token", "승인 실행", "trigger"),
        connection("quotes-to-simulate", "data-flow", "base-dex-quote-source", "arb-simulate-trigger", "경로 데이터", "routedata", True),
        connection("resolver-to-simulate", "data-flow", "base-dex-contract-resolver", "arb-simulate-trigger", "executor 확인", "executoraddress", True),
        connection("profit-to-simulate", "data-flow", "arb-profit-score", "arb-simulate-trigger", "수익 확인", "profitusd", True),
        connection("simulate-trigger-to-action", "trigger-action", "arb-simulate-trigger", "simulate-arb-route", "시뮬레이션", "trigger"),
        connection("quotes-to-execute", "data-flow", "base-dex-quote-source", "arb-execute-trigger", "실행 데이터", "simulationstatus", True),
        connection("resolver-to-execute", "data-flow", "base-dex-contract-resolver", "arb-execute-trigger", "주소 확인", "contractresolutionstatus", True),
        connection("profit-to-execute", "data-flow", "arb-profit-score", "arb-execute-trigger", "수익 기준", "profitusd", True),
        connection("execute-trigger-to-action", "trigger-action", "arb-execute-trigger", "execute-arb-route", "거래 실행", "trigger"),
        connection("quotes-to-monitor", "stream-monitor", "base-dex-quote-source", "arb-monitor", "상태 표시", "simulatedprofitusd"),
        connection("simulate-to-monitor", "action-result", "simulate-arb-route", "arb-monitor", "검증 결과", "status"),
        connection("execute-to-monitor", "action-result", "execute-arb-route", "arb-monitor", "실행 결과", "status"),
    ]
    groups = [
        {
            "id": pipeline_id,
            "title": "Base DEX 데이터 파이프라인",
            "purpose": "Base quote, contract resolver, profit score를 여러 check 시퀀스가 공유합니다.",
            "sequenceType": "data-pipeline",
            "order": 1,
            "nodeIds": ["base-dex-quote-source", "base-dex-contract-resolver", "arb-profit-score"],
            "canAbstract": False,
            "mustStayVisibleNodeIds": ["base-dex-quote-source", "base-dex-contract-resolver", "arb-profit-score"],
            "sharedDataPipeline": True,
        },
        {
            "id": approve_seq,
            "title": "Approve 시퀀스",
            "purpose": "아비트라지 토큰 승인이 부족할 때만 allowance 액션을 준비합니다.",
            "sequenceType": "check-effect",
            "order": 2,
            "nodeIds": ["arb-approve-trigger", "approve-arb-token"],
            "canAbstract": False,
            "mustStayVisibleNodeIds": ["arb-approve-trigger", "approve-arb-token"],
            "checkEffect": {"checkNodeId": "arb-approve-trigger", "effectNodeId": "approve-arb-token", "reusableInputsOnly": ["base-dex-quote-source", "base-dex-contract-resolver", "arb-profit-score"]},
        },
        {
            "id": simulate_seq,
            "title": "Simulation 시퀀스",
            "purpose": "실제 거래 전 executor로 경로를 검증합니다.",
            "sequenceType": "check-effect",
            "order": 3,
            "nodeIds": ["arb-simulate-trigger", "simulate-arb-route"],
            "canAbstract": False,
            "mustStayVisibleNodeIds": ["arb-simulate-trigger", "simulate-arb-route"],
            "checkEffect": {"checkNodeId": "arb-simulate-trigger", "effectNodeId": "simulate-arb-route", "reusableInputsOnly": ["base-dex-quote-source", "base-dex-contract-resolver", "arb-profit-score"]},
        },
        {
            "id": execute_seq,
            "title": "Execute 시퀀스",
            "purpose": "시뮬레이션과 수익 조건이 통과된 경우에만 아비트라지 실행을 준비합니다.",
            "sequenceType": "check-effect",
            "order": 4,
            "nodeIds": ["arb-execute-trigger", "execute-arb-route"],
            "canAbstract": False,
            "mustStayVisibleNodeIds": ["arb-execute-trigger", "execute-arb-route"],
            "checkEffect": {"checkNodeId": "arb-execute-trigger", "effectNodeId": "execute-arb-route", "reusableInputsOnly": ["base-dex-quote-source", "base-dex-contract-resolver", "arb-profit-score"]},
        },
        {
            "id": monitor_seq,
            "title": "모니터링 시퀀스",
            "purpose": "quote, simulation, execution 결과를 관찰만 합니다.",
            "sequenceType": "monitoring",
            "order": 90,
            "nodeIds": ["arb-monitor"],
            "canAbstract": False,
            "mustStayVisibleNodeIds": ["arb-monitor"],
        },
    ]
    return {
        "schemaVersion": 1,
        "kind": "hershy-strategy-graph",
        "strategy": {"id": "base-dex-arbitrage-python-native", "name": "Base DEX Arbitrage"},
        "generatedAt": generated_at,
        "metadata": {
            "strategyKind": "base_dex_arbitrage",
            "executionDomain": intent.get("executionDomain"),
            "sourcePrompt": prompt,
            "agenticWorkflow": True,
            "aiLoopInternalized": True,
            "visibleGraphScope": "trading-logic-only",
            "externalPollingSource": True,
            "workflowPlan": intent,
            "evidenceBundle": state.get("evidence_bundle"),
            "strategyBlock": {
                "id": "strategy-base-dex-arbitrage",
                "title": "Base DEX 아비트라지 전략",
                "purpose": "Base DEX 경로를 감시하되, executor와 실제 quote adapter가 없으면 paper-only로 막습니다.",
                "nodeIds": [item["id"] for item in blocks],
            },
            "workflowGroups": groups,
            "checkEffectGraph": True,
            "sequenceIsolation": "one-check-effect-sequence-per-action",
            "reusablePipelinePolicy": "only data-pipeline outputs may feed multiple check nodes",
            "contractResolution": contract_resolution,
            "dataSourceAudit": data_audit,
            "internalizedAgentPhases": [
                "intent",
                "evidence",
                "contract_resolution",
                "data_source_audit",
                "block_map_validation",
                "execution_readiness",
            ],
            "agentLoopContract": build_agent_contract_metadata(groups),
        },
        "summary": build_graph_summary(blocks, connections),
        "blocks": blocks,
        "connections": connections,
    }


def materialize_block_map_node(state: AgentState) -> Dict[str, Any]:
    intent = state.get("intent") or {}
    if intent.get("id") == "base_dex_arbitrage":
        runtime_graph = build_base_dex_arbitrage_graph(state)
    else:
        runtime_graph = build_base_btc_yield_graph(state)
    runtime_graph = {
        **runtime_graph,
        "metadata": {
            **(runtime_graph.get("metadata") or {}),
            "hershyCodeContract": state.get("hershy_code_contract"),
            "staticAnalysisContract": state.get("static_analysis_contract"),
            "sourceOfTruth": "generated_strategy.go",
            "uiDerivationPolicy": "static-analysis-of-generated_strategy.go",
            "uiEditSyncPolicy": "ui-edit-regenerates-hershy-code",
        },
    }
    return {
        "runtime_graph": runtime_graph,
        "trace": append_trace(
            state,
            "block-map",
            "Python LangGraph block-map materialization node completed",
            {"blocks": len(runtime_graph.get("blocks", [])), "connections": len(runtime_graph.get("connections", []))},
        ),
    }


REFERENCE_RE = re.compile(r"([A-Za-z0-9_-]+)::([A-Za-z0-9_-]+)")


def block_by_id(graph: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {item.get("id"): item for item in graph.get("blocks", []) if item.get("id")}


def group_by_block_id(graph: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    result: Dict[str, Dict[str, Any]] = {}
    for group in graph.get("metadata", {}).get("workflowGroups", []) or []:
        for node_id in group.get("nodeIds", []) or []:
            result[node_id] = group
    return result


def get_block_config(graph: Dict[str, Any], block_id: str) -> Dict[str, Any]:
    item = block_by_id(graph).get(block_id) or {}
    config = item.get("config")
    return config if isinstance(config, dict) else {}


def output_field_provenance(config: Dict[str, Any], field_name: str) -> Optional[Dict[str, Any]]:
    provenance = config.get("dataProvenance")
    if not isinstance(provenance, dict):
        return None
    outputs = provenance.get("outputs")
    if isinstance(outputs, dict):
        direct = outputs.get(field_name)
        if isinstance(direct, dict):
            return direct
        for key, value in outputs.items():
            if isinstance(value, dict) and normalize_text(value.get("field")).lower() == field_name.lower():
                return value
    direct = provenance.get(field_name)
    if isinstance(direct, dict):
        return direct
    for key, value in provenance.items():
        if isinstance(value, dict) and (key.lower() == field_name.lower() or normalize_text(value.get("field")).lower() == field_name.lower()):
            return value
    if provenance.get("sourceType"):
        return provenance
    return None


def expression_references(config: Dict[str, Any]) -> List[Tuple[str, str, str]]:
    text = " ".join(
        normalize_text(config.get(key))
        for key in ["expression", "condition", "logic", "code"]
        if normalize_text(config.get(key))
    )
    return [(match.group(1), match.group(2), match.group(0)) for match in REFERENCE_RE.finditer(text)]


def trace_formula_origin(
    graph: Dict[str, Any],
    source_id: str,
    field_name: str,
    path: Optional[List[str]] = None,
    seen: Optional[Set[str]] = None,
) -> List[Dict[str, Any]]:
    path = path or []
    seen = seen or set()
    key = f"{source_id}::{field_name}"
    if key in seen:
        return [{"sourceBlockId": source_id, "fieldName": field_name, "status": "cycle", "path": [*path, source_id]}]
    seen.add(key)
    blocks = block_by_id(graph)
    source_block = blocks.get(source_id)
    if not source_block:
        return [{"sourceBlockId": source_id, "fieldName": field_name, "status": "missing", "path": [*path, source_id]}]
    config = source_block.get("config") or {}
    block_type = source_block.get("type")
    provenance = output_field_provenance(config, field_name)
    if block_type == "streaming":
        source_type = normalize_text((provenance or {}).get("sourceType"))
        status = "live-polled" if source_type in {"runtime_fetched", "live_polled"} else "runtime-adapter-required"
        return [
            {
                "sourceBlockId": source_id,
                "sourceBlockType": block_type,
                "fieldName": field_name,
                "status": status,
                "actuallyPolled": status == "live-polled",
                "sourceType": source_type or "runtime_adapter_required",
                "path": [*path, source_id],
            }
        ]
    refs = expression_references(config)
    if refs:
        origins: List[Dict[str, Any]] = []
        for nested_id, nested_field, _raw in refs:
            origins.extend(trace_formula_origin(graph, nested_id, nested_field, [*path, source_id], seen.copy()))
        return origins
    source_type = normalize_text((provenance or {}).get("sourceType"))
    status_text = normalize_text((provenance or {}).get("status"))
    if source_type in {"computed_from_proven_inputs"}:
        return [
            {
                "sourceBlockId": source_id,
                "sourceBlockType": block_type,
                "fieldName": field_name,
                "status": "computed",
                "actuallyPolled": False,
                "sourceType": source_type,
                "path": [*path, source_id],
            }
        ]
    if source_type in {"agent_contract_resolution_stage", "runtime_adapter_required"} or status_text in {"unresolved", "required"}:
        return [
            {
                "sourceBlockId": source_id,
                "sourceBlockType": block_type,
                "fieldName": field_name,
                "status": "runtime-adapter-required",
                "actuallyPolled": False,
                "sourceType": source_type or "runtime_adapter_required",
                "path": [*path, source_id],
            }
        ]
    if source_type in {"evidence_backed_static", "evidence_backed"}:
        return [
            {
                "sourceBlockId": source_id,
                "sourceBlockType": block_type,
                "fieldName": field_name,
                "status": "evidence-backed-static",
                "actuallyPolled": False,
                "sourceType": source_type,
                "path": [*path, source_id],
            }
        ]
    return [
        {
            "sourceBlockId": source_id,
            "sourceBlockType": block_type,
            "fieldName": field_name,
            "status": "missing-provenance",
            "actuallyPolled": False,
            "sourceType": source_type or "missing",
            "path": [*path, source_id],
        }
    ]


def build_formula_lineage_audit(graph: Dict[str, Any]) -> Dict[str, Any]:
    checked: List[Dict[str, Any]] = []
    errors: List[str] = []
    warnings: List[str] = []
    for item in graph.get("blocks", []) or []:
        block_id = item.get("id")
        block_type = item.get("type")
        config = item.get("config") or {}
        refs = expression_references(config)
        if not refs:
            continue
        origins: List[Dict[str, Any]] = []
        for source_id, field_name, raw in refs:
            origins.extend(trace_formula_origin(graph, source_id, field_name, [block_id]))
        statuses = {origin.get("status") for origin in origins}
        if "missing" in statuses or "missing-provenance" in statuses or "cycle" in statuses:
            status = "invalid"
            errors.append(f"formula block {block_id} has missing or unproven input lineage")
        elif "runtime-adapter-required" in statuses:
            status = "runtime-adapter-required"
            warnings.append(f"formula block {block_id} depends on inputs that require runtime adapters")
        elif "live-polled" in statuses:
            status = "live-polled"
        else:
            status = "evidence-backed"
        checked.append(
            {
                "blockId": block_id,
                "blockType": block_type,
                "status": status,
                "references": [
                    {"blockId": source_id, "fieldName": field_name, "raw": raw, "inferred": False}
                    for source_id, field_name, raw in refs
                ],
                "origins": origins,
            }
        )
    if errors:
        status = "invalid"
    elif any(item.get("status") == "runtime-adapter-required" for item in checked):
        status = "runtime_adapter_required"
    elif checked:
        status = "live_or_evidence_backed"
    else:
        status = "not_applicable"
    return {"status": status, "checked": checked, "errors": errors, "warnings": warnings}


def validate_plain_korean_logic_description(text: str) -> bool:
    if not text:
        return False
    required = [
        "1. 어떤 데이터를 받아와서:",
        "2. 어떤 동작을 수행하고:",
        "3. 어떤 output을 내는지:",
    ]
    if not all(item in text for item in required):
        return False
    forbidden = ["const ", "let ", "return ", "function ", "::", "&&", "||", "=>", "{", "}"]
    return not any(item in text for item in forbidden)


def validate_agent_loop_contract(graph: Dict[str, Any]) -> Dict[str, Any]:
    errors: List[str] = []
    warnings: List[str] = []
    blocks = graph.get("blocks") if isinstance(graph.get("blocks"), list) else []
    connections = graph.get("connections") if isinstance(graph.get("connections"), list) else []
    metadata = graph.get("metadata") if isinstance(graph.get("metadata"), dict) else {}
    block_ids = [item.get("id") for item in blocks if item.get("id")]
    block_set = set(block_ids)
    by_id = block_by_id(graph)
    if graph.get("kind") != "hershy-strategy-graph":
        errors.append("runtimeGraph.kind must be hershy-strategy-graph")
    if not blocks:
        errors.append("runtimeGraph.blocks must contain visible trading blocks")
    if not connections:
        errors.append("runtimeGraph.connections must connect the block map")
    if metadata.get("agenticWorkflow") is not True:
        errors.append("metadata.agenticWorkflow must be true")
    if metadata.get("aiLoopInternalized") is not True:
        errors.append("metadata.aiLoopInternalized must be true")
    if metadata.get("visibleGraphScope") != "trading-logic-only":
        errors.append("metadata.visibleGraphScope must be trading-logic-only")
    groups = metadata.get("workflowGroups") if isinstance(metadata.get("workflowGroups"), list) else []
    strategy_block = metadata.get("strategyBlock") if isinstance(metadata.get("strategyBlock"), dict) else {}
    if set(strategy_block.get("nodeIds", []) or []) != block_set:
        errors.append("metadata.strategyBlock.nodeIds must list every runtime block")
    membership: Dict[str, List[str]] = {block_id: [] for block_id in block_ids}
    group_by_id = {}
    for group in groups:
        group_id = group.get("id")
        if not group_id:
            errors.append("workflowGroup id is required")
            continue
        group_by_id[group_id] = group
        node_ids = group.get("nodeIds") if isinstance(group.get("nodeIds"), list) else []
        if not node_ids:
            errors.append(f"workflowGroup {group_id} must list nodeIds")
        for node_id in node_ids:
            if node_id not in block_set:
                errors.append(f"workflowGroup {group_id} references missing block {node_id}")
            else:
                membership.setdefault(node_id, []).append(group_id)
    for block_id, owners in membership.items():
        if len(owners) == 0:
            errors.append(f"block {block_id} is not assigned to any workflowGroup")
        if len(owners) > 1:
            errors.append(f"block {block_id} belongs to multiple workflowGroups")
    for item in blocks:
        block_id = item.get("id")
        block_type = item.get("type")
        config = item.get("config") or {}
        if block_type == "streaming" and not isinstance(config.get("outputBlocks"), list):
            errors.append(f"streaming block {block_id} must expose outputBlocks")
        if block_type in {"normal", "trigger", "action"}:
            if not isinstance(config.get("inputBlocks"), list):
                errors.append(f"{block_type} block {block_id} must expose inputBlocks")
            if not isinstance(config.get("outputBlocks"), list):
                errors.append(f"{block_type} block {block_id} must expose outputBlocks")
        if block_type == "trigger":
            outputs = config.get("outputBlocks") if isinstance(config.get("outputBlocks"), list) else []
            if not any(output.get("name") == "trigger" and output.get("id") == "trigger" for output in outputs):
                errors.append(f"trigger formula {block_id} must expose canonical output block trigger")
        if block_type in {"normal", "trigger"}:
            description = normalize_text(config.get("logicDescription"))
            if not validate_plain_korean_logic_description(description):
                errors.append(f"indicator logic {block_id} must use the required plain Korean three-line format")
    for group in groups:
        group_id = group.get("id")
        seq_type = normalize_text(group.get("sequenceType")).lower()
        node_ids = group.get("nodeIds") if isinstance(group.get("nodeIds"), list) else []
        if seq_type == "data-pipeline":
            if group.get("sharedDataPipeline") is not True:
                errors.append(f"data-pipeline group {group_id} must set sharedDataPipeline=true")
            for node_id in node_ids:
                if by_id.get(node_id, {}).get("type") not in {"streaming", "normal"}:
                    errors.append(f"data-pipeline group {group_id} may not contain {node_id}")
        if seq_type == "check-effect":
            check_effect = group.get("checkEffect") if isinstance(group.get("checkEffect"), dict) else {}
            check_node = check_effect.get("checkNodeId")
            effect_node = check_effect.get("effectNodeId")
            if check_node not in node_ids or effect_node not in node_ids:
                errors.append(f"check-effect group {group_id} must declare checkNodeId/effectNodeId inside the group")
            action_count = sum(1 for node_id in node_ids if by_id.get(node_id, {}).get("type") == "action")
            if action_count != 1:
                errors.append(f"check-effect group {group_id} must contain exactly one action effect, found {action_count}")
            if by_id.get(effect_node, {}).get("type") != "action":
                errors.append(f"effect node {effect_node} in group {group_id} must be an action block")
        if seq_type == "monitoring":
            for node_id in node_ids:
                if by_id.get(node_id, {}).get("type") != "monitoring":
                    errors.append(f"monitoring group {group_id} may only contain monitoring blocks")
    block_group = group_by_block_id(graph)
    for conn in connections:
        conn_id = conn.get("id")
        source = conn.get("fromId")
        target = conn.get("toId")
        kind = conn.get("kind")
        if source not in block_set:
            errors.append(f"connection {conn_id} references missing source block {source}")
        if target not in block_set:
            errors.append(f"connection {conn_id} references missing target block {target}")
        if not normalize_text(conn.get("easyLabel")):
            warnings.append(f"connection {conn_id} should include a short Korean easyLabel")
        if kind == "action-input":
            errors.append(f"check-effect graph must not use action-input edge {conn_id}")
        source_group = block_group.get(source)
        target_group = block_group.get(target)
        if not source_group or not target_group or source_group.get("id") == target_group.get("id"):
            continue
        source_type = normalize_text(source_group.get("sequenceType")).lower()
        target_type = normalize_text(target_group.get("sequenceType")).lower()
        allowed_pipeline_to_check = (
            source_type == "data-pipeline"
            and target_type == "check-effect"
            and kind == "data-flow"
            and conn.get("sharedDataPipeline") is True
            and target == (target_group.get("checkEffect") or {}).get("checkNodeId")
        )
        allowed_monitoring_inbound = target_type == "monitoring" and kind in {"stream-monitor", "action-result", "data-flow"}
        if not allowed_pipeline_to_check and not allowed_monitoring_inbound:
            errors.append(f"cross-sequence edge {conn_id} is forbidden ({source_group.get('id')} -> {target_group.get('id')})")
    lineage = build_formula_lineage_audit(graph)
    warnings.extend(lineage.get("warnings", []))
    errors.extend(lineage.get("errors", []))
    return {
        "ok": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "formulaLineageAudit": lineage,
        "contractVersion": HERSHY_BLOCK_MAP_CONTRACT_VERSION,
    }


def validate_block_map_node(state: AgentState) -> Dict[str, Any]:
    graph = state.get("runtime_graph") or {}
    contract_validation = validate_agent_loop_contract(graph)
    issues = [
        *[{"level": "error", "message": item} for item in contract_validation.get("errors", [])],
        *[{"level": "warning", "message": item} for item in contract_validation.get("warnings", [])],
    ]
    validation = {
        "ok": contract_validation.get("ok", False),
        "issues": issues,
        "errors": contract_validation.get("errors", []),
        "warnings": contract_validation.get("warnings", []),
        "stdout": "",
        "stderr": "",
        "validator": "python-native-agent-loop-contract",
    }
    runtime_graph = {
        **graph,
        "metadata": {
            **(graph.get("metadata") or {}),
            "agentLoopContractValidation": contract_validation,
            "agentLoopFormulaLineageAudit": contract_validation.get("formulaLineageAudit"),
        },
    }
    return {
        "runtime_graph": runtime_graph,
        "agent_loop_contract_validation": contract_validation,
        "validation": validation,
        "trace": append_trace(
            state,
            "validation",
            "Python LangGraph validation node completed",
            {"ok": validation["ok"], "issueCount": len(issues), "lineage": contract_validation.get("formulaLineageAudit", {}).get("status")},
        ),
    }


def route_after_validation(state: AgentState) -> str:
    validation = state.get("validation") or {}
    attempts = int(state.get("repair_attempts") or 0)
    if validation.get("ok") is not True and attempts < 2:
        return "repair"
    return "readiness"


def repair_block_map_node(state: AgentState) -> Dict[str, Any]:
    graph = json.loads(json.dumps(state.get("runtime_graph") or {}))
    attempts = int(state.get("repair_attempts") or 0) + 1
    for conn in graph.get("connections", []) or []:
        if not normalize_text(conn.get("easyLabel")):
            conn["easyLabel"] = normalize_text(conn.get("label")) or "데이터 전달"
    for item in graph.get("blocks", []) or []:
        config = item.get("config") if isinstance(item.get("config"), dict) else {}
        if item.get("type") in {"normal", "trigger"} and not validate_plain_korean_logic_description(normalize_text(config.get("logicDescription"))):
            config["logicDescription"] = logic_description(
                "이전 블록에서 필요한 시장 데이터와 지갑 상태를 받아옵니다.",
                "조건에 맞는지 사람이 이해할 수 있는 기준으로 확인합니다.",
                "다음 단계가 사용할 판단 결과를 내보냅니다.",
            )
            config["logicDescriptionAuthor"] = "python-langgraph-native-repair"
    return {
        "runtime_graph": graph,
        "repair_attempts": attempts,
        "trace": append_trace(state, "repair", "Python LangGraph repair node completed", {"attempt": attempts}),
    }


def audit_execution_readiness_node(state: AgentState) -> Dict[str, Any]:
    graph = state.get("runtime_graph") or {}
    validation = state.get("validation") or {}
    actions = [item for item in graph.get("blocks", []) or [] if item.get("type") == "action"]
    blockers: List[str] = []
    for action in actions:
        config = action.get("config") or {}
        contract_address = normalize_text(config.get("contractAddress"))
        if contract_address.endswith("_REQUIRED") or "REQUIRED" in contract_address:
            blockers.append(f"{action.get('id')}: contractAddress is unresolved")
        if normalize_text(config.get("executionMode")) != "live":
            blockers.append(f"{action.get('id')}: executionMode is {normalize_text(config.get('executionMode')) or 'unset'}")
    lineage_status = (state.get("agent_loop_contract_validation") or {}).get("formulaLineageAudit", {}).get("status")
    if lineage_status == "runtime_adapter_required":
        blockers.append("formula inputs require runtime adapters before live execution")
    readiness = {
        "status": "paper_only" if blockers or validation.get("ok") is not True else "live_ready",
        "liveExecutable": not blockers and validation.get("ok") is True,
        "blockers": uniq(blockers),
        "requiresEOA": True,
        "requiresRuntimeAdapters": bool(blockers),
        "checkedActionBlocks": [action.get("id") for action in actions],
    }
    runtime_graph = {
        **graph,
        "metadata": {
            **(graph.get("metadata") or {}),
            "executionReadiness": readiness,
        },
    }
    return {
        "runtime_graph": runtime_graph,
        "execution_readiness": readiness,
        "trace": append_trace(state, "execution-readiness", "Python LangGraph execution-readiness node completed", {"status": readiness["status"]}),
    }


def write_strategy_summary_node(state: AgentState) -> Dict[str, Any]:
    intent = state.get("intent") or {}
    readiness = state.get("execution_readiness") or {}
    graph = state.get("runtime_graph") or {}
    if intent.get("id") == "base_dex_arbitrage":
        summary_text = "Base DEX quote와 컨트랙트 해석 결과를 공통 파이프라인으로 읽고, 승인/시뮬레이션/실행을 각각 독립 check-effect 시퀀스로 분리한 아비트라지 전략입니다."
        key_points = [
            "공통 데이터 파이프라인만 여러 시퀀스가 공유하고, 실행 액션은 시퀀스마다 분리했습니다.",
            "executor 주소, routeData, quote/simulation adapter가 없으면 live 실행이 막힙니다.",
            "공유 파이프라인 간선은 UI에서 빨간색으로 표시되도록 표시했습니다.",
        ]
    else:
        summary_text = "Base에서 BTC 계열 자산을 이자농사에 넣기 위한 전략입니다. 시장/지갑/컨트랙트 상태를 공통 파이프라인으로 읽고, 승인/예치/보상수령/출금을 각각 독립 시퀀스로 실행합니다."
        key_points = [
            "APR, 잔고, allowance, 유동성은 실제 어댑터가 붙기 전까지 unresolved 데이터로 남깁니다.",
            "컨트랙트 주소와 함수가 증거로 확정되지 않으면 모든 DEX 액션은 paper-only입니다.",
            "각 trigger formula는 output block trigger를 내보내고, action은 해당 trigger만 받습니다.",
        ]
    summary = {
        "summaryText": summary_text,
        "keyPoints": key_points,
        "executionReadinessText": "실행 불가: runtime adapter와 검증된 컨트랙트 주소가 필요합니다." if readiness.get("status") == "paper_only" else "실행 준비 완료",
        "riskNotes": [
            "실제 EOA 지갑 주소 없이는 balanceOf와 allowance를 조회할 수 없습니다.",
            "증거 없는 APR, 가격, 유동성, 컨트랙트 주소는 생성하지 않습니다.",
        ],
        "provider": "python-native-langgraph",
        "model": "deterministic-graph-summary",
        "generatedAt": utc_now(),
    }
    runtime_graph = {
        **graph,
        "metadata": {
            **(graph.get("metadata") or {}),
            "strategyAISummary": summary,
        },
    }
    return {
        "runtime_graph": runtime_graph,
        "strategy_ai_summary": summary,
        "trace": append_trace(state, "summary", "Python LangGraph strategy summary node completed", {"provider": summary["provider"]}),
    }


def build_agent_loop_runtime(trace: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "engine": "python-langgraph-native",
        "package": "langgraph",
        "packageVersion": langgraph_package_version(),
        "graphVersion": HERSHY_NATIVE_LANGGRAPH_VERSION,
        "compiled": True,
        "nodes": GRAPH_NODE_IDS,
        "trace": trace,
        "nodeBridge": "node-server-json-stdio-only",
    }


def finalize_result_node(state: AgentState) -> Dict[str, Any]:
    trace = append_trace(state, "finalize", "Python LangGraph final response node completed", {"ok": (state.get("validation") or {}).get("ok")})
    agent_runtime = build_agent_loop_runtime(trace)
    runtime_graph = {
        **(state.get("runtime_graph") or {}),
        "metadata": {
            **((state.get("runtime_graph") or {}).get("metadata") or {}),
            "agentLoopRuntime": agent_runtime,
        },
    }
    result = {
        "ok": (state.get("validation") or {}).get("ok") is not False,
        "generatedAt": utc_now(),
        "prompt": state.get("prompt"),
        "initialWorkflowPlan": state.get("intent"),
        "workflowPlan": state.get("intent"),
        "webDiscovery": {"status": "not_used_in_python_native_runner", "results": []},
        "apiResearch": {"status": "not_used_in_python_native_runner", "apiSources": []},
        "research": {"status": "local_evidence_only", "searches": []},
        "contractResolution": state.get("contract_resolution"),
        "evidenceBundle": state.get("evidence_bundle"),
        "strategyPackage": {
            "intentPlan": state.get("intent"),
            "logicIR": {
                "id": (state.get("intent") or {}).get("id"),
                "dataSourceAudit": state.get("data_source_audit"),
                "formulaLineageAudit": (state.get("agent_loop_contract_validation") or {}).get("formulaLineageAudit"),
            },
            "runtimeGraph": runtime_graph,
        },
        "strategy": runtime_graph,
        "validation": state.get("validation"),
        "agentLoopContractValidation": state.get("agent_loop_contract_validation"),
        "executionReadiness": state.get("execution_readiness"),
        "strategyAISummary": state.get("strategy_ai_summary"),
        "agentLoopRuntime": agent_runtime,
        "orchestration": {
            "engine": "python-langgraph-native",
            "graphVersion": HERSHY_NATIVE_LANGGRAPH_VERSION,
            "trace": trace,
        },
        "persistence": {
            "runID": f"python-native-{uuid.uuid4()}",
            "status": "not_persisted",
            "reason": "Native Python runner returned JSON directly; DB persistence is not part of the Node bridge.",
        },
    }
    return {
        "result": result,
        "runtime_graph": runtime_graph,
        "trace": trace,
    }


def build_native_graph():
    workflow = StateGraph(AgentState)
    workflow.add_node("infer_intent", infer_intent_node)
    workflow.add_node("collect_local_evidence", collect_local_evidence_node)
    workflow.add_node("resolve_contracts", resolve_contracts_node)
    workflow.add_node("audit_data_sources", audit_data_sources_node)
    workflow.add_node("generate_hershy_code", generate_hershy_code_node)
    workflow.add_node("static_analyze_hershy_code_to_ui", static_analyze_hershy_code_to_ui_node)
    workflow.add_node("materialize_block_map", materialize_block_map_node)
    workflow.add_node("validate_block_map", validate_block_map_node)
    workflow.add_node("repair_block_map", repair_block_map_node)
    workflow.add_node("audit_execution_readiness", audit_execution_readiness_node)
    workflow.add_node("write_strategy_summary", write_strategy_summary_node)
    workflow.add_node("finalize_result", finalize_result_node)

    workflow.add_edge(START, "infer_intent")
    workflow.add_edge("infer_intent", "collect_local_evidence")
    workflow.add_edge("collect_local_evidence", "resolve_contracts")
    workflow.add_edge("resolve_contracts", "audit_data_sources")
    workflow.add_edge("audit_data_sources", "generate_hershy_code")
    workflow.add_edge("generate_hershy_code", "static_analyze_hershy_code_to_ui")
    workflow.add_edge("static_analyze_hershy_code_to_ui", "materialize_block_map")
    workflow.add_edge("materialize_block_map", "validate_block_map")
    workflow.add_conditional_edges(
        "validate_block_map",
        route_after_validation,
        {
            "repair": "repair_block_map",
            "readiness": "audit_execution_readiness",
        },
    )
    workflow.add_edge("repair_block_map", "validate_block_map")
    workflow.add_edge("audit_execution_readiness", "write_strategy_summary")
    workflow.add_edge("write_strategy_summary", "finalize_result")
    workflow.add_edge("finalize_result", END)
    return workflow.compile()


def run_native_agent_loop(prompt: str, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    graph = build_native_graph()
    state = graph.invoke(
        {
            "prompt": prompt,
            "options": options or {},
            "trace": [],
            "repair_attempts": 0,
        }
    )
    return state["result"]


def main() -> None:
    raw = sys.stdin.read().strip()
    payload = json.loads(raw) if raw else {}
    prompt = normalize_text(payload.get("prompt"))
    if not prompt:
        raise ValueError("prompt is required")
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    result = run_native_agent_loop(prompt, options)
    json.dump(result, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
