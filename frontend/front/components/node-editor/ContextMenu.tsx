"use client";

import { useEffect, useRef } from "react";
import { Combine, Split, Trash2, Copy, Clipboard, Group, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  // Menu options
  canMerge?: boolean;
  canUnmerge?: boolean;
  canGroup?: boolean;
  onMerge?: () => void;
  onUnmerge?: () => void;
  onGroup?: () => void;
  onAiExplain?: () => void;
  onDelete?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onHideNodes?: () => void;
}

export function ContextMenu({
  x,
  y,
  onClose,
  canMerge,
  canUnmerge,
  canGroup,
  onMerge,
  onUnmerge,
  onGroup,
  onAiExplain,
  onDelete,
  onCopy,
  onPaste,
  onHideNodes,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const menuItems = [
    {
      label: "그룹화 (Group)",
      icon: Group,
      onClick: onGroup,
      show: canGroup,
      className: "text-emerald-600 hover:bg-emerald-50",
    },
    {
      label: "AI로 블록 설명 생성",
      icon: Sparkles,
      onClick: onAiExplain,
      show: canGroup, // If multiple items are selected (which enables group), also enable AI Explain
      className: "text-indigo-600 hover:bg-indigo-50",
    },
    {
      label: "선택 항목 묶어서 숨기기 (Tab)",
      icon: Combine,
      onClick: onHideNodes,
      show: !!onHideNodes && canGroup,
      className: "text-purple-600 hover:bg-purple-50",
    },
    { divider: true, show: canGroup },
    {
      label: "Merge Functions",
      icon: Combine,
      onClick: onMerge,
      show: canMerge,
      className: "text-blue-600 hover:bg-blue-50",
    },
    {
      label: "Unmerge Functions",
      icon: Split,
      onClick: onUnmerge,
      show: canUnmerge,
      className: "text-orange-600 hover:bg-orange-50",
    },
    { divider: true, show: (canMerge || canUnmerge) && (onCopy || onDelete) },
    {
      label: "Copy",
      icon: Copy,
      onClick: onCopy,
      show: !!onCopy,
      className: "text-gray-700 hover:bg-gray-100",
    },
    {
      label: "Paste",
      icon: Clipboard,
      onClick: onPaste,
      show: !!onPaste,
      className: "text-gray-700 hover:bg-gray-100",
    },
    { divider: true, show: onDelete && (onCopy || onPaste) },
    {
      label: "Delete",
      icon: Trash2,
      onClick: onDelete,
      show: !!onDelete,
      className: "text-red-600 hover:bg-red-50",
    },
  ];

  const visibleItems = menuItems.filter((item) => item.show);

  if (visibleItems.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[180px] bg-white rounded-lg shadow-xl border border-gray-200 py-1 overflow-hidden"
      style={{
        left: x,
        top: y,
      }}
    >
      {visibleItems.map((item, index) => {
        if ("divider" in item && item.divider) {
          return <div key={`divider-${index}`} className="h-px bg-gray-200 my-1" />;
        }

        const Icon = item.icon;
        return (
          <button
            key={item.label}
            onClick={() => {
              item.onClick?.();
              onClose();
            }}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors",
              item.className
            )}
          >
            {Icon && <Icon className="w-4 h-4" />}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
