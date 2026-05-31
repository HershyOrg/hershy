"use client";

import {
  Plus,
  Timer,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize,
  ChevronDown,
  Box,
  Globe,
  RotateCcw,
  RotateCw,
  Activity,
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
  onAddNode: (type: "function" | "trigger" | "branch" | "block" | "action" | "cex" | "dex" | "streaming") => void;
  onDeleteSelected: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onLayout?: () => void;
}

export function Toolbar({ onAddNode, onDeleteSelected, onUndo, onRedo, onLayout }: ToolbarProps) {
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
    <div className="flex items-center gap-2 rounded-md border border-[#2b3139] bg-[#181a20]/96 p-2 text-[#eaecef] shadow-none backdrop-blur-sm">
      {/* Add Node Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="flex h-8 items-center gap-1.5 rounded-md border-[#2b3139] bg-[#0b0e11] text-[#eaecef] hover:border-[#f0b90b] hover:bg-[#1e2329] hover:text-[#fcd535]"
          >
            <Plus className="w-4 h-4" />
            <span className="text-xs font-medium">Add</span>
            <ChevronDown className="w-3 h-3 ml-0.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48 rounded-md border-[#2b3139] bg-[#181a20] text-[#eaecef]">
          <DropdownMenuItem onClick={() => onAddNode("function")} className="gap-2 focus:bg-[#1e2329] focus:text-[#fcd535]">
            <BarChart3 className="w-4 h-4 text-[#f0b90b]" />
            <span>Indicator Logic</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-[#2b3139]" />
          <DropdownMenuItem onClick={() => onAddNode("trigger")} className="gap-2 focus:bg-[#1e2329] focus:text-[#fcd535]">
            <Timer className="w-4 h-4 text-[#b7bdc6]" />
            <span>Trigger</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAddNode("block")} className="gap-2 focus:bg-[#1e2329] focus:text-[#fcd535]">
            <Box className="w-4 h-4 text-[#848e9c]" />
            <span>Block</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-[#2b3139]" />
          <DropdownMenuItem onClick={() => onAddNode("action")} className="gap-2 focus:bg-[#1e2329] focus:text-[#fcd535]">
            <Globe className="w-4 h-4 text-[#0ecb81]" />
            <span>Action</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAddNode("streaming")} className="gap-2 focus:bg-[#1e2329] focus:text-[#fcd535]">
            <Activity className="w-4 h-4 text-[#0ecb81]" />
            <span>Streaming Node</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="h-6 w-px bg-[#2b3139]" />

      {/* Quick Add Triggers */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAddNode("function")}
          className="h-8 px-2 text-[#b7bdc6] hover:bg-[#1e2329] hover:text-[#fcd535]"
          title="Add Indicator Logic"
        >
          <BarChart3 className="w-4 h-4 text-[#f0b90b]" />
        </Button>
        <div className="h-4 w-px bg-[#2b3139]" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAddNode("trigger")}
          className="h-8 px-2 text-[#b7bdc6] hover:bg-[#1e2329] hover:text-[#fcd535]"
          title="Add Trigger"
        >
          <Timer className="w-4 h-4 text-[#b7bdc6]" />
        </Button>
        <div className="h-4 w-px bg-[#2b3139]" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAddNode("action")}
          className="h-8 px-2 text-[#b7bdc6] hover:bg-[#1e2329] hover:text-[#fcd535]"
          title="Add Action"
        >
          <Globe className="w-4 h-4 text-[#0ecb81]" />
        </Button>
        <div className="h-4 w-px bg-[#2b3139]" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAddNode("streaming")}
          className="h-8 px-2 text-[#b7bdc6] hover:bg-[#1e2329] hover:text-[#fcd535]"
          title="Add Streaming Node"
        >
          <Activity className="w-4 h-4 text-[#0ecb81]" />
        </Button>
      </div>

      <div className="h-6 w-px bg-[#2b3139]" />

      {/* Undo/Redo Controls */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-[#b7bdc6] hover:bg-[#1e2329] hover:text-[#fcd535]"
          onClick={onUndo}
          title="Undo (Ctrl+Z)"
        >
          <RotateCcw className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-[#b7bdc6] hover:bg-[#1e2329] hover:text-[#fcd535]"
          onClick={onRedo}
          title="Redo (Ctrl+Shift+Z)"
        >
          <RotateCw className="w-4 h-4" />
        </Button>
      </div>

      <div className="h-6 w-px bg-[#2b3139]" />

      {/* Zoom Controls */}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-[#b7bdc6] hover:bg-[#1e2329] hover:text-[#fcd535]" onClick={handleZoomIn} title="Zoom In">
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-[#b7bdc6] hover:bg-[#1e2329] hover:text-[#fcd535]" onClick={handleZoomOut} title="Zoom Out">
          <ZoomOut className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-[#b7bdc6] hover:bg-[#1e2329] hover:text-[#fcd535]" onClick={handleFitView} title="Fit View">
          <Maximize className="w-4 h-4" />
        </Button>
      </div>

      <div className="h-6 w-px bg-[#2b3139]" />

      {/* Auto Layout */}
      {onLayout && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="flex h-8 items-center gap-1.5 px-2 text-[#b7bdc6] hover:bg-[#1e2329] hover:text-[#fcd535]"
            onClick={onLayout}
            title="자동 정렬"
          >
            <Network className="w-4 h-4" />
            <span className="text-xs font-medium">자동 정렬</span>
          </Button>
          <div className="h-6 w-px bg-[#2b3139]" />
        </>
      )}

      {/* Delete */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-[#f6465d] hover:bg-[#f6465d]/10 hover:text-[#ff707e]"
        onClick={onDeleteSelected}
        title="Delete Selected"
      >
        <Trash2 className="w-4 h-4" />
      </Button>

      <div className="h-6 w-px bg-[#2b3139]" />

      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 rounded-md border-[#f0b90b]/50 bg-[#0b0e11] text-[#fcd535] hover:border-[#fcd535] hover:bg-[#f0b90b] hover:text-[#0b0e11]"
        onClick={() => window.dispatchEvent(new CustomEvent("saveHistorySnapshot"))}
        title="현재 상태를 새로운 탬플릿 분기로 저장합니다."
      >
        <Save className="w-4 h-4" />
        <span className="text-xs font-semibold">저장하기</span>
      </Button>

    </div>
  );
}
