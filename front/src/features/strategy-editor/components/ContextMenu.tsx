"use client";

import { useEffect, useRef } from "react";
import { Combine, Split, Trash2, Copy, Clipboard, Group, FileText } from "@/shared/components/icons";
import { cn } from "@/shared/utils/utils";

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  // Menu options
  canMerge?: boolean;
  canUnmerge?: boolean;
  canCreateSequenceGroup?: boolean;
  canCreateMasterGroup?: boolean;
  onMerge?: () => void;
  onUnmerge?: () => void;
  onCreateSequenceGroup?: () => void;
  onCreateMasterGroup?: () => void;
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
  canCreateSequenceGroup,
  canCreateMasterGroup,
  onMerge,
  onUnmerge,
  onCreateSequenceGroup,
  onCreateMasterGroup,
  onAiExplain,
  onDelete,
  onCopy,
  onPaste,
  onHideNodes,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const canGroup = Boolean(canCreateSequenceGroup || canCreateMasterGroup);

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
      label: "Create Sequence Group",
      icon: Group,
      onClick: onCreateSequenceGroup,
      show: canCreateSequenceGroup,
      className: "text-[#0ecb81] hover:bg-[#1e2329]",
    },
    {
      label: "Create Master Group",
      icon: Combine,
      onClick: onCreateMasterGroup,
      show: canCreateMasterGroup,
      className: "text-[#f0b90b] hover:bg-[#1e2329]",
    },
    {
      label: "Generate Block Description",
      icon: FileText,
      onClick: onAiExplain,
      show: canGroup,
      className: "text-[#b7bdc6] hover:bg-[#1e2329] hover:text-[#fcd535]",
    },
    {
      label: "Hide Selection as Group (Tab)",
      icon: Combine,
      onClick: onHideNodes,
      show: !!onHideNodes && canGroup,
      className: "text-[#b7bdc6] hover:bg-[#1e2329] hover:text-[#fcd535]",
    },
    { divider: true, show: canGroup },
    {
      label: "Merge Functions",
      icon: Combine,
      onClick: onMerge,
      show: canMerge,
      className: "text-[#b7bdc6] hover:bg-[#1e2329] hover:text-[#fcd535]",
    },
    {
      label: "Unmerge Functions",
      icon: Split,
      onClick: onUnmerge,
      show: canUnmerge,
      className: "text-[#f0b90b] hover:bg-[#1e2329]",
    },
    { divider: true, show: (canMerge || canUnmerge) && (onCopy || onDelete) },
    {
      label: "Copy",
      icon: Copy,
      onClick: onCopy,
      show: !!onCopy,
      className: "text-[#b7bdc6] hover:bg-[#1e2329] hover:text-[#fcd535]",
    },
    {
      label: "Paste",
      icon: Clipboard,
      onClick: onPaste,
      show: !!onPaste,
      className: "text-[#b7bdc6] hover:bg-[#1e2329] hover:text-[#fcd535]",
    },
    { divider: true, show: onDelete && (onCopy || onPaste) },
    {
      label: "Delete",
      icon: Trash2,
      onClick: onDelete,
      show: !!onDelete,
      className: "text-[#f6465d] hover:bg-[#f6465d]/10 hover:text-[#ff707e]",
    },
  ];

  const visibleItems = menuItems.filter((item) => item.show);

  if (visibleItems.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[180px] overflow-hidden rounded-md border border-[#2b3139] bg-[#181a20] py-1 text-[#eaecef] shadow-none"
      style={{
        left: x,
        top: y,
      }}
    >
      {visibleItems.map((item, index) => {
        if ("divider" in item && item.divider) {
          return <div key={`divider-${index}`} className="my-1 h-px bg-[#2b3139]" />;
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
