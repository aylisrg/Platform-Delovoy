"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type NavItem = {
  label: string;
  href: string;
  icon: string;
  section: string;
};

type NavGroup = {
  id: string;
  label: string;
  itemIds: string[]; // section keys
};

type SidebarLayout = {
  order: string[]; // top-level items: section keys or group ids
  groups: NavGroup[];
};

const ALL_NAVIGATION: NavItem[] = [
  { label: "Дашборд", href: "/admin/dashboard", icon: "📊", section: "dashboard" },
  { label: "Барбекю Парк", href: "/admin/gazebos", icon: "🏕", section: "gazebos" },
  { label: "Плей Парк", href: "/admin/ps-park", icon: "🎮", section: "ps-park" },
  { label: "Кафе", href: "/admin/cafe", icon: "☕", section: "cafe" },
  { label: "Аренда", href: "/admin/rental", icon: "🏢", section: "rental" },
  { label: "Модули", href: "/admin/modules", icon: "📦", section: "modules" },
  { label: "Пользователи", href: "/admin/users", icon: "👥", section: "users" },
  { label: "Клиенты", href: "/admin/clients", icon: "👤", section: "clients" },
  { label: "Telegram", href: "/admin/telegram", icon: "📨", section: "telegram" },
  { label: "Склад", href: "/admin/inventory", icon: "📋", section: "inventory" },
  { label: "Аналитика", href: "/admin/analytics", icon: "📈", section: "analytics" },
  { label: "Обратная связь", href: "/admin/feedback", icon: "💬", section: "feedback" },
  { label: "Мониторинг", href: "/admin/monitoring", icon: "🔍", section: "monitoring" },
  { label: "Архитектор", href: "/admin/architect", icon: "🗺", section: "architect" },
];

const STORAGE_KEY = "admin-sidebar-layout";
const BADGE_POLL_INTERVAL = 30_000;

function defaultLayout(): SidebarLayout {
  return {
    order: ALL_NAVIGATION.map((n) => n.section),
    groups: [],
  };
}

function loadLayout(): SidebarLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return defaultLayout();
}

function saveLayout(layout: SidebarLayout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {}
}

// ---- Drag handle icon ----
function GripIcon() {
  return (
    <svg
      width="12"
      height="16"
      viewBox="0 0 12 16"
      fill="none"
      className="text-zinc-400"
    >
      {[2, 6, 10].map((x) =>
        [3, 7, 11].map((y) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={1.5} fill="currentColor" />
        ))
      )}
    </svg>
  );
}

// ---- Single nav link ----
function NavLink({
  item,
  isActive,
  count,
}: {
  item: NavItem;
  isActive: boolean;
  count: number;
}) {
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        isActive
          ? "bg-blue-50 text-blue-700"
          : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
      }`}
    >
      <span>{item.icon}</span>
      {item.label}
      {count > 0 && (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white leading-none">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}

// ---- Sortable item in edit mode ----
function SortableNavItem({
  item,
  isActive,
  count,
  onMoveToGroup,
  groups,
  currentGroupId,
  onRemoveFromGroup,
}: {
  item: NavItem;
  isActive: boolean;
  count: number;
  onMoveToGroup: (section: string, groupId: string) => void;
  groups: NavGroup[];
  currentGroupId?: string;
  onRemoveFromGroup?: (section: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.section });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group/item flex items-center gap-1"
    >
      <button
        {...attributes}
        {...listeners}
        className="flex-shrink-0 cursor-grab p-1 rounded hover:bg-zinc-100 active:cursor-grabbing touch-none"
        aria-label="Перетащить"
      >
        <GripIcon />
      </button>
      <div
        className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? "bg-blue-50 text-blue-700" : "text-zinc-600 bg-zinc-50"
        }`}
      >
        <span>{item.icon}</span>
        {item.label}
        {count > 0 && (
          <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white leading-none">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </div>
      {/* Group assignment dropdown */}
      {groups.length > 0 && (
        <select
          className="ml-1 text-[10px] rounded border border-zinc-200 bg-white px-1 py-1 text-zinc-500 opacity-0 group-hover/item:opacity-100 transition-opacity cursor-pointer"
          value={currentGroupId ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "") {
              onRemoveFromGroup?.(item.section);
            } else {
              onMoveToGroup(item.section, val);
            }
          }}
          title="Переместить в группу"
        >
          <option value="">— без группы</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ---- Sortable group container ----
function SortableGroup({
  group,
  items,
  pathname,
  badgeCounts,
  editMode,
  onRename,
  onDelete,
  onMoveToGroup,
  allGroups,
  onRemoveFromGroup,
}: {
  group: NavGroup;
  items: NavItem[];
  pathname: string | null;
  badgeCounts: Record<string, number>;
  editMode: boolean;
  onRename: (groupId: string, label: string) => void;
  onDelete: (groupId: string) => void;
  onMoveToGroup: (section: string, groupId: string) => void;
  allGroups: NavGroup[];
  onRemoveFromGroup: (section: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.label);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(group.label);
  }, [group.label, editing]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border border-zinc-200 bg-zinc-50/60">
      <div className="flex items-center gap-1 px-2 py-1.5">
        {editMode && (
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab p-1 rounded hover:bg-zinc-100 active:cursor-grabbing touch-none"
          >
            <GripIcon />
          </button>
        )}

        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex-1 flex items-center gap-1.5 text-left"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            className={`text-zinc-400 transition-transform flex-shrink-0 ${collapsed ? "-rotate-90" : ""}`}
          >
            <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                onRename(group.id, draft.trim() || group.label);
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onRename(group.id, draft.trim() || group.label);
                  setEditing(false);
                }
                if (e.key === "Escape") {
                  setDraft(group.label);
                  setEditing(false);
                }
              }}
              className="text-xs font-semibold text-zinc-500 bg-white border border-blue-400 rounded px-1 w-24 outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="text-xs font-semibold uppercase tracking-wide text-zinc-400 cursor-text hover:text-zinc-600 transition-colors"
              title="Двойной клик — переименовать"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
            >
              {group.label}
            </span>
          )}
        </button>

        {editMode && (
          <div className="flex items-center gap-0.5 ml-auto">
            <button
              onClick={() => setEditing(true)}
              className="p-1 rounded hover:bg-zinc-200 text-zinc-400 hover:text-zinc-600"
              title="Переименовать"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M11 2l3 3-9 9H2v-3l9-9z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              onClick={() => onDelete(group.id)}
              className="p-1 rounded hover:bg-red-50 text-zinc-400 hover:text-red-500"
              title="Удалить группу"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="px-2 pb-2 space-y-0.5">
          <SortableContext items={items.map((i) => i.section)} strategy={verticalListSortingStrategy}>
            {items.map((item) =>
              editMode ? (
                <SortableNavItem
                  key={item.section}
                  item={item}
                  isActive={!!pathname?.startsWith(item.href)}
                  count={badgeCounts[item.section] || 0}
                  onMoveToGroup={onMoveToGroup}
                  groups={allGroups.filter((g) => g.id !== group.id)}
                  currentGroupId={group.id}
                  onRemoveFromGroup={onRemoveFromGroup}
                />
              ) : (
                <NavLink
                  key={item.section}
                  item={item}
                  isActive={!!pathname?.startsWith(item.href)}
                  count={badgeCounts[item.section] || 0}
                />
              )
            )}
          </SortableContext>
          {items.length === 0 && (
            <p className="text-[11px] text-zinc-400 px-3 py-1 italic">Пусто — перетащите сюда</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Main Sidebar ----
export function Sidebar() {
  const pathname = usePathname();
  const [allowedSections, setAllowedSections] = useState<string[] | null>(null);
  const [badgeCounts, setBadgeCounts] = useState<Record<string, number>>({});
  const [layout, setLayout] = useState<SidebarLayout>(defaultLayout);
  const [editMode, setEditMode] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Load layout from localStorage
  useEffect(() => {
    setLayout(loadLayout());
  }, []);

  // Persist layout changes
  useEffect(() => {
    saveLayout(layout);
  }, [layout]);

  // Fetch permissions
  useEffect(() => {
    fetch("/api/admin/permissions/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setAllowedSections(data.data.sections);
        else setAllowedSections([]);
      })
      .catch(() => setAllowedSections([]));
  }, []);

  // Poll badge counts
  useEffect(() => {
    let active = true;
    function poll() {
      fetch("/api/admin/badge-counts")
        .then((res) => res.json())
        .then((data) => {
          if (data.success && active) setBadgeCounts(data.data);
        })
        .catch(() => {});
    }
    poll();
    const interval = setInterval(poll, BADGE_POLL_INTERVAL);
    return () => { active = false; clearInterval(interval); };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // Resolve visible items
  const visibleSections = new Set(allowedSections ?? []);

  const navBySection = Object.fromEntries(ALL_NAVIGATION.map((n) => [n.section, n]));

  // Collect all sections that are in a group
  const groupedSections = new Set(layout.groups.flatMap((g) => g.itemIds));

  // Top-level order: items and group-ids, filtered to visible
  const topLevelIds = layout.order.filter((id) => {
    const isGroup = layout.groups.some((g) => g.id === id);
    if (isGroup) {
      const group = layout.groups.find((g) => g.id === id)!;
      return group.itemIds.some((s) => visibleSections.has(s));
    }
    return visibleSections.has(id) && !groupedSections.has(id);
  });

  // Ensure any allowed section not in layout is appended
  const allLayoutSections = new Set([...layout.order, ...layout.groups.flatMap((g) => g.itemIds)]);
  const missingSections = [...visibleSections].filter((s) => !allLayoutSections.has(s));
  if (missingSections.length > 0) {
    // Add missing to layout (fire-and-forget state update)
    setLayout((prev) => ({
      ...prev,
      order: [...prev.order, ...missingSections],
    }));
  }

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeIdStr = String(active.id);
      const overIdStr = String(over.id);

      // Check if active is a section and over is a group id
      const isSection = !!navBySection[activeIdStr];
      const overGroup = layout.groups.find((g) => g.id === overIdStr);

      if (isSection && overGroup) {
        setLayout((prev) => {
          const sourceGroup = prev.groups.find((g) => g.itemIds.includes(activeIdStr));
          const newGroups = prev.groups.map((g) => {
            if (g.id === sourceGroup?.id) {
              return { ...g, itemIds: g.itemIds.filter((id) => id !== activeIdStr) };
            }
            if (g.id === overGroup.id && !g.itemIds.includes(activeIdStr)) {
              return { ...g, itemIds: [...g.itemIds, activeIdStr] };
            }
            return g;
          });
          const newOrder = prev.order.filter((id) => id !== activeIdStr);
          return { ...prev, order: newOrder, groups: newGroups };
        });
      }
    },
    [layout.groups, navBySection]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeIdStr = String(active.id);
      const overIdStr = String(over.id);

      setLayout((prev) => {
        const isActiveGroup = prev.groups.some((g) => g.id === activeIdStr);
        const isOverGroup = prev.groups.some((g) => g.id === overIdStr);
        const isActiveSection = !!navBySection[activeIdStr];
        const isOverSection = !!navBySection[overIdStr];

        const activeInTopLevel = prev.order.includes(activeIdStr);
        const activeGroupId = prev.groups.find((g) => g.itemIds.includes(activeIdStr))?.id;

        // Case 1: reorder top-level (groups or ungrouped sections)
        if ((isActiveGroup || (isActiveSection && activeInTopLevel)) && (isOverGroup || (isOverSection && prev.order.includes(overIdStr)))) {
          const oldIdx = prev.order.indexOf(activeIdStr);
          const newIdx = prev.order.indexOf(overIdStr);
          if (oldIdx !== -1 && newIdx !== -1) {
            return { ...prev, order: arrayMove(prev.order, oldIdx, newIdx) };
          }
        }

        // Case 2: reorder within a group
        if (isActiveSection && isOverSection && activeGroupId) {
          const overGroupId = prev.groups.find((g) => g.itemIds.includes(overIdStr))?.id;
          if (overGroupId === activeGroupId) {
            const newGroups = prev.groups.map((g) => {
              if (g.id === activeGroupId) {
                const oldIdx = g.itemIds.indexOf(activeIdStr);
                const newIdx = g.itemIds.indexOf(overIdStr);
                return { ...g, itemIds: arrayMove(g.itemIds, oldIdx, newIdx) };
              }
              return g;
            });
            return { ...prev, groups: newGroups };
          }
        }

        return prev;
      });
    },
    [navBySection]
  );

  const addGroup = useCallback(() => {
    const id = `group-${Date.now()}`;
    setLayout((prev) => ({
      ...prev,
      order: [...prev.order, id],
      groups: [...prev.groups, { id, label: "Новая группа", itemIds: [] }],
    }));
  }, []);

  const renameGroup = useCallback((groupId: string, label: string) => {
    setLayout((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => (g.id === groupId ? { ...g, label } : g)),
    }));
  }, []);

  const deleteGroup = useCallback((groupId: string) => {
    setLayout((prev) => {
      const group = prev.groups.find((g) => g.id === groupId);
      const freedItems = group?.itemIds ?? [];
      return {
        order: [...prev.order.filter((id) => id !== groupId), ...freedItems],
        groups: prev.groups.filter((g) => g.id !== groupId),
      };
    });
  }, []);

  const moveToGroup = useCallback((section: string, groupId: string) => {
    setLayout((prev) => {
      const newOrder = prev.order.filter((id) => id !== section);
      const newGroups = prev.groups.map((g) => {
        if (g.itemIds.includes(section)) {
          return { ...g, itemIds: g.itemIds.filter((id) => id !== section) };
        }
        if (g.id === groupId && !g.itemIds.includes(section)) {
          return { ...g, itemIds: [...g.itemIds, section] };
        }
        return g;
      });
      return { order: newOrder, groups: newGroups };
    });
  }, []);

  const removeFromGroup = useCallback((section: string) => {
    setLayout((prev) => {
      const newGroups = prev.groups.map((g) => ({
        ...g,
        itemIds: g.itemIds.filter((id) => id !== section),
      }));
      if (prev.order.includes(section)) return { ...prev, groups: newGroups };
      return { order: [...prev.order, section], groups: newGroups };
    });
  }, []);

  const resetLayout = useCallback(() => {
    const fresh = defaultLayout();
    setLayout(fresh);
    saveLayout(fresh);
  }, []);

  // Active drag item for overlay
  const activeNavItem = activeId ? navBySection[activeId] : null;

  const renderTopLevel = () => {
    if (allowedSections === null) {
      return (
        <div className="flex flex-col gap-2 px-3 py-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded-lg bg-zinc-100" />
          ))}
        </div>
      );
    }

    return (
      <SortableContext items={topLevelIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-1">
          {topLevelIds.map((id) => {
            const group = layout.groups.find((g) => g.id === id);
            if (group) {
              const groupItems = group.itemIds
                .filter((s) => visibleSections.has(s))
                .map((s) => navBySection[s])
                .filter(Boolean);
              return (
                <SortableGroup
                  key={group.id}
                  group={group}
                  items={groupItems}
                  pathname={pathname}
                  badgeCounts={badgeCounts}
                  editMode={editMode}
                  onRename={renameGroup}
                  onDelete={deleteGroup}
                  onMoveToGroup={moveToGroup}
                  allGroups={layout.groups}
                  onRemoveFromGroup={removeFromGroup}
                />
              );
            }

            const item = navBySection[id];
            if (!item || !visibleSections.has(id)) return null;

            return editMode ? (
              <SortableNavItem
                key={id}
                item={item}
                isActive={!!pathname?.startsWith(item.href)}
                count={badgeCounts[id] || 0}
                onMoveToGroup={moveToGroup}
                groups={layout.groups}
                onRemoveFromGroup={removeFromGroup}
              />
            ) : (
              <NavLink
                key={id}
                item={item}
                isActive={!!pathname?.startsWith(item.href)}
                count={badgeCounts[id] || 0}
              />
            );
          })}
        </div>
      </SortableContext>
    );
  };

  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-white">
      <div className="flex h-16 items-center border-b border-zinc-200 px-6">
        <Link href="/admin/dashboard" className="text-lg font-bold text-zinc-900">
          Деловой Парк
        </Link>
        <button
          onClick={() => setEditMode((v) => !v)}
          className={`ml-auto rounded-lg p-1.5 transition-colors ${
            editMode
              ? "bg-blue-100 text-blue-600"
              : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
          }`}
          title={editMode ? "Сохранить порядок" : "Настроить меню"}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M11 2l3 3-9 9H2v-3l9-9z"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {editMode && (
        <div className="border-b border-zinc-200 bg-blue-50 px-4 py-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-blue-600 font-medium">Режим редактирования</span>
          <div className="flex gap-1">
            <button
              onClick={addGroup}
              className="text-[11px] rounded px-2 py-1 bg-white border border-zinc-200 text-zinc-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
            >
              + Группа
            </button>
            <button
              onClick={resetLayout}
              className="text-[11px] rounded px-2 py-1 bg-white border border-zinc-200 text-zinc-400 hover:border-red-300 hover:text-red-500 transition-colors"
              title="Сбросить порядок"
            >
              ↺
            </button>
          </div>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto p-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {renderTopLevel()}

          <DragOverlay>
            {activeNavItem ? (
              <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium bg-white shadow-lg border border-zinc-200 text-zinc-700">
                <span>{activeNavItem.icon}</span>
                {activeNavItem.label}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </nav>

      <div className="border-t border-zinc-200 p-4 space-y-3">
        <div className="relative group/logo flex items-center gap-2 px-1">
          <video
            src="/media/logo-animated.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="h-6 w-6 rounded object-cover"
          />
          <span className="text-xs text-zinc-400 font-medium">Деловой Парк</span>
          <span className="pointer-events-none absolute bottom-full left-0 mb-2 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-500 shadow-sm opacity-0 transition-opacity group-hover/logo:opacity-100">
            Работает на кофе и дедлайнах ☕
          </span>
        </div>
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-700"
        >
          ← На сайт
        </Link>
      </div>
    </aside>
  );
}
