"use client";

import {
  Plus,
  Timer,
  MousePointer2,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize,
  ChevronDown,
  Box,
  Building2,
  Globe,
  Clock,
  RotateCcw,
  RotateCw,
  Activity,
  TerminalSquare,
  Network,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useReactFlow } from "@xyflow/react";
import { useCallback } from "react";
import { Save } from "lucide-react";

interface ToolbarProps {
  onAddNode: (type: "function" | "time" | "click" | "branch" | "block" | "cex" | "dex" | "timeline" | "monitoring" | "streaming") => void;
  onDeleteSelected: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onToggleTerminal?: () => void;
  onLayout?: () => void;
}

export function Toolbar({ onAddNode, onDeleteSelected, onUndo, onRedo, onToggleTerminal, onLayout }: ToolbarProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const handleZoomIn = useCallback(() => {
    zoomIn({ duration: 200 });
  }, [zoomIn]);

  const handleZoomOut = useCallback(() => {
    zoomOut({ duration: 200 });
  }, [zoomOut]);

  const handleFitView = useCallback(() => {
    fitView({ duration: 200, padding: 0.2 });
  }, [fitView]);

  return (
    <div className="flex items-center gap-2 bg-white/95 backdrop-blur-sm rounded-lg shadow-md p-2 border border-gray-200">
      {/* Add Node Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="flex items-center gap-1.5">
            <Plus className="w-4 h-4" />
            <span className="text-xs font-medium">Add</span>
            <ChevronDown className="w-3 h-3 ml-0.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onClick={() => onAddNode("function")} className="gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-500" />
            <span>Indicator Logic</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onAddNode("time")} className="gap-2">
            <Timer className="w-4 h-4 text-purple-500" />
            <span>TIME Trigger</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAddNode("click")} className="gap-2">
            <MousePointer2 className="w-4 h-4 text-gray-700" />
            <span>CLICK Trigger</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAddNode("block")} className="gap-2">
            <Box className="w-4 h-4 text-gray-500" />
            <span>Block</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onAddNode("cex")} className="gap-2">
            <Building2 className="w-4 h-4 text-amber-500" />
            <span>CEX Action</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAddNode("dex")} className="gap-2">
            <Globe className="w-4 h-4 text-cyan-500" />
            <span>DEX Action</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAddNode("timeline")} className="gap-2">
            <Clock className="w-4 h-4 text-purple-500" />
            <span>Timeline Frame</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onAddNode("monitoring")} className="gap-2">
            <Activity className="w-4 h-4 text-emerald-500" />
            <span>Visual Monitor</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAddNode("streaming")} className="gap-2">
            <Activity className="w-4 h-4 text-emerald-600" />
            <span>Streaming Node</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="w-px h-6 bg-gray-200" />

      {/* Quick Add Triggers */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAddNode("function")}
          className="px-2 h-8"
          title="Add Indicator Logic"
        >
          <BarChart3 className="w-4 h-4 text-emerald-500" />
        </Button>
        <div className="w-px h-4 bg-gray-300" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAddNode("time")}
          className="px-2 h-8"
          title="Add TIME Trigger"
        >
          <Timer className="w-4 h-4 text-purple-500" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAddNode("click")}
          className="px-2 h-8"
          title="Add CLICK Trigger"
        >
          <MousePointer2 className="w-4 h-4 text-gray-700" />
        </Button>
        <div className="w-px h-4 bg-gray-300" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAddNode("cex")}
          className="px-2 h-8"
          title="Add CEX Action"
        >
          <Building2 className="w-4 h-4 text-amber-500" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAddNode("dex")}
          className="px-2 h-8"
          title="Add DEX Action"
        >
          <Globe className="w-4 h-4 text-cyan-500" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAddNode("timeline")}
          className="px-2 h-8"
          title="Add Timeline Frame"
        >
          <Clock className="w-4 h-4 text-purple-500" />
        </Button>
        <div className="w-px h-4 bg-gray-300" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAddNode("monitoring")}
          className="px-2 h-8"
          title="Add Monitoring Block"
        >
          <Activity className="w-4 h-4 text-emerald-500" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAddNode("streaming")}
          className="px-2 h-8"
          title="Add Streaming Node"
        >
          <Activity className="w-4 h-4 text-emerald-600" />
        </Button>
      </div>

      <div className="w-px h-6 bg-gray-200" />

      {/* Undo/Redo Controls */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8"
          onClick={onUndo}
          title="Undo (Ctrl+Z)"
        >
          <RotateCcw className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8"
          onClick={onRedo}
          title="Redo (Ctrl+Shift+Z)"
        >
          <RotateCw className="w-4 h-4" />
        </Button>
      </div>

      <div className="w-px h-6 bg-gray-200" />

      {/* Zoom Controls */}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="w-8 h-8" onClick={handleZoomIn} title="Zoom In">
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" className="w-8 h-8" onClick={handleZoomOut} title="Zoom Out">
          <ZoomOut className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" className="w-8 h-8" onClick={handleFitView} title="Fit View">
          <Maximize className="w-4 h-4" />
        </Button>
      </div>

      <div className="w-px h-6 bg-gray-200" />

      {/* Auto Layout */}
      {onLayout && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="px-2 h-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50 flex items-center gap-1.5"
            onClick={onLayout}
            title="자동 정렬"
          >
            <Network className="w-4 h-4" />
            <span className="text-xs font-medium">자동 정렬</span>
          </Button>
          <div className="w-px h-6 bg-gray-200" />
        </>
      )}

      {/* Delete */}
      <Button
        variant="ghost"
        size="icon"
        className="w-8 h-8 text-red-500 hover:text-red-600 hover:bg-red-50"
        onClick={onDeleteSelected}
        title="Delete Selected"
      >
        <Trash2 className="w-4 h-4" />
      </Button>

      <div className="w-px h-6 bg-gray-200" />

      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-indigo-600 border-indigo-200 hover:bg-indigo-50"
        onClick={() => window.dispatchEvent(new CustomEvent("saveHistorySnapshot"))}
        title="현재 상태를 새로운 탬플릿 분기로 저장합니다."
      >
        <Save className="w-4 h-4" />
        <span className="text-xs font-semibold">저장하기</span>
      </Button>

      <div className="w-px h-6 bg-gray-200" />

      {/* Toggle Terminal */}
      <Button
        variant="outline"
        size="icon"
        className="w-8 h-8 text-emerald-600 border-emerald-200 hover:bg-emerald-50"
        onClick={onToggleTerminal}
        title="Toggle Terminal"
      >
        <TerminalSquare className="w-4 h-4" />
      </Button>
    </div>
  );
}
