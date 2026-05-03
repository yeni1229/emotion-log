"use client";

import Calendar, { type TileArgs } from "react-calendar";
import type { Value } from "react-calendar/dist/shared/types.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";

export type SymptomSubGroup = {
  id: string;
  title: string;
};

type BranchKey =
  | "causes"
  | "status"
  | "coping"
  | "positive_causes"
  | "positive_status";
type RecordCategory =
  | "causes"
  | "status"
  | "coping"
  | "positive_causes"
  | "positive_status";
type HeaderItem = {
  id: string;
  branch: BranchKey;
  subId: string;
  title: string;
};
type TagItem = {
  id: string;
  parentId: string;
  branch: BranchKey;
  subId: string;
  label: string;
};

type CustomItemRow = {
  id: string;
  parentId: string | null;
  rawKey: string;
  label: string;
  category: string;
};

const HEADER_MAP: Record<
  string,
  { branch: BranchKey; subId: string; title: string }
> = {
  environmental: { branch: "causes", subId: "environmental", title: "환경적" },
  social: { branch: "causes", subId: "social", title: "상황적" },
  physiological: { branch: "causes", subId: "physiological", title: "생리/심리적" },
  mental: { branch: "status", subId: "mental", title: "정신적" },
  physical: { branch: "status", subId: "physical", title: "신체적" },
  rest: { branch: "coping", subId: "rest", title: "휴식" },
  activity: { branch: "coping", subId: "activity", title: "활동" },
  positive_causes: { branch: "positive_causes", subId: "positive_causes", title: "긍정 원인" },
  positive_status: { branch: "positive_status", subId: "positive_status", title: "긍정 기분" },
};

const STORAGE_KEY = "my-symptom-app.byDay.v1";
const STORAGE_MOOD_KEY = "my-symptom-app.moodByDay.v1";

function toDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toNormalizedDayKey(value: unknown): string {
  if (value instanceof Date) return toDayKey(value);
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  // Postgres DATE / 문자열: "YYYY-MM-DD" — 타임존 변환 없이 그대로(WeekStrip의 toDayKey와 동일한 달력일)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // timestamptz 등: 선행 YYYY-MM-DD를 달력 키로 사용(UTC·로컬 파싱으로 하루 밀림 방지)
  const isoHead = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s]|$)/i);
  if (isoHead) return isoHead[1];

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return toDayKey(parsed);

  return raw.slice(0, 10);
}

function normalizeRecordCategory(raw: unknown): RecordCategory | null {
  const s = String(raw ?? "")
    .replace(/\uFEFF/g, "")
    .trim()
    .toLowerCase()
    // 하이픈·일반 공백·NBSP 등 → 언더스코어 (positive-causes → positive_causes)
    .replace(/[\s\u00A0\-]+/g, "_")
    .replace(/_+/g, "_");

  if (!s) return null;

  // DB 값 positive_causes / positive_status(및 하이픈·공백 정규화 결과)를 명시적으로 허용
  switch (s) {
    case "causes":
    case "status":
    case "coping":
    case "positive_causes":
    case "positive_status":
      return s;
    default:
      return null;
  }
}

type UserRecordRow = {
  record_date: unknown;
  category: unknown;
  item_id: unknown;
  mood_score?: unknown;
};

/** Supabase user_records 전체를 날짜 키별 문자열 배열로 묶음(긍정 카테고리 포함, 키 중복 제거). */
function groupRecordsByDay(rows: UserRecordRow[] | null | undefined): {
  byDay: Record<string, string[]>;
  moodByDay: Record<string, number>;
} {
  const byDay: Record<string, string[]> = {};
  const moodByDay: Record<string, number> = {};
  const keysByDate = new Map<string, Set<string>>();

  for (const row of rows ?? []) {
    const date = toNormalizedDayKey(row.record_date);
    if (!date) continue;

    const category = normalizeRecordCategory(row.category);
    if (!category) continue;

    const itemId = String(row.item_id ?? "").trim();
    const fullKey = itemId.length > 0 ? `${category}:${itemId}` : category;

    let set = keysByDate.get(date);
    if (!set) {
      set = new Set<string>();
      keysByDate.set(date, set);
    }
    set.add(fullKey);

    if (!(date in moodByDay)) {
      const rawScore = row.mood_score;
      const score =
        typeof rawScore === "number"
          ? rawScore
          : typeof rawScore === "string"
            ? Number(rawScore)
            : 0;
      moodByDay[date] = Number.isFinite(score) ? score : 0;
    }
  }

  for (const [date, set] of keysByDate) {
    byDay[date] = Array.from(set);
  }

  return { byDay, moodByDay };
}

function pickDate(value: Value): Date | null {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    const first = value[0];
    if (first instanceof Date) return first;
  }
  return null;
}

function tagKey(
  branch: BranchKey,
  subId: string,
  tag: string,
): string {
  return `${branch}:${subId}:${tag}`;
}

function parseFullKey(fullKey: string) {
  const parts = fullKey.split(":");
  const branch = parts[0] ?? "";
  const subId = parts[1] ?? "";
  const tag = parts.slice(2).join(":");
  return { branch, subId, tag };
}

function normalizeCustomItem(row: Record<string, unknown>): CustomItemRow | null {
  const id = String(row.id ?? "");
  const parentIdRaw = row.parent_id ?? row.parentId ?? null;
  const parentId = parentIdRaw === null ? null : String(parentIdRaw);
  const rawKey = String(row.key ?? row.code ?? row.slug ?? row.label ?? row.name ?? "").trim().toLowerCase();
  const label = String(row.label ?? row.item_label ?? row.name ?? "").trim();
  const category = String(row.category ?? "").trim().toLowerCase();

  if (!id || !label) return null;
  return { id, parentId, rawKey, label, category };
}

function mapHeaderFromRow(row: CustomItemRow): HeaderItem | null {
  const mapped = HEADER_MAP[row.rawKey] ?? HEADER_MAP[row.label.toLowerCase()] ?? null;
  if (mapped) {
    return {
      id: row.id,
      branch: mapped.branch,
      subId: mapped.subId,
      title: mapped.title,
    };
  }

  const categoryBranch =
    row.category === "causes" ||
    row.category === "status" ||
    row.category === "coping" ||
    row.category === "positive_causes" ||
    row.category === "positive_status"
      ? (row.category as BranchKey)
      : null;

  if (!categoryBranch) return null;

  const subId = row.rawKey || row.label.toLowerCase().replace(/\s+/g, "_");
  return {
    id: row.id,
    branch: categoryBranch,
    subId,
    title: row.label,
  };
}

function normalizeDate(d: Date): Date {
  // Local midnight normalization to keep day keys stable.
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function getWeekDays(anchor: Date): Date[] {
  const start = normalizeDate(anchor);
  start.setDate(start.getDate() - start.getDay()); // Sunday start
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function getDayDotFlags(keys: string[] | undefined) {
  const allKeysString = (keys ?? []).join("|"); // ["a:b", "c:d"] -> "a:b|c:d"

  return {
    causes: allKeysString.includes("causes:"),
    status: allKeysString.includes("status:"),
    coping: allKeysString.includes("coping:"),
    // 하이픈이나 언더바, 공백 이슈를 피하기 위해 includes로 체크
    positiveCauses: allKeysString.includes("positive_causes"),
    positiveStatus: allKeysString.includes("positive_status"),
  };
}

/*
function getDayDotFlags(keys: string[] | undefined) {
  const categories = new Set(
    (keys ?? []).map((k) => {
      // ":"가 있으면 분리하고, 없으면 전체를 사용 (공백 제거 포함)
      const rawCategory = k.includes(":") ? k.split(":")[0] : k;
      return rawCategory.trim() as RecordCategory;
    }),
  );
  return {
    causes: categories.has("causes"),
    status: categories.has("status"),
    coping: categories.has("coping"),
    positiveCauses: categories.has("positive_causes"),
    positiveStatus: categories.has("positive_status"),
  };
}
*/
function WeekStrip({
  anchorDate,
  selectedDate,
  onSelect,
  byDay,
}: {
  anchorDate: Date;
  selectedDate: Date;
  onSelect: (d: Date) => void;
  byDay: Record<string, string[]>;
}) {
  const days = getWeekDays(anchorDate);
  return (
    <div className="px-2 pb-0 pt-0 sm:px-4">
      <div className="grid grid-cols-7 gap-1.5 px-0.5 text-[10px] font-semibold text-stone-400">
        {WEEKDAY_SHORT.map((w) => (
          <div key={w} className="text-center">
            {w}
          </div>
        ))}
      </div>

      <div className="mt-0.5 grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const k = toDayKey(d);
          const isSelected = toDayKey(selectedDate) === k;
          const dots = getDayDotFlags(byDay[k]);
          const hasEntry =
            dots.causes ||
            dots.status ||
            dots.coping ||
            dots.positiveCauses ||
            dots.positiveStatus;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onSelect(d)}
              className={`relative min-h-[98px] overflow-visible rounded-2xl border px-1.5 py-3 text-center transition-all duration-200 ${
                isSelected
                  ? "border-rose-400 bg-rose-200/70 shadow-sm"
                  : "border-stone-200 bg-white/70 hover:bg-white"
              }`}
            >
              <div className="text-[12px] font-bold leading-none text-stone-800">
                {d.getDate()}
              </div>
              {hasEntry ? (
                <div className="relative z-10 mx-auto mt-2 flex w-full max-w-[42px] flex-col items-center">
                  {/* 위쪽 3점: 원인/상태/대처 */}
                  <div className="flex items-center justify-center gap-[4px]">
                    {dots.causes ? (
                      <span className="relative z-10 h-[6px] w-[6px] rounded-full bg-rose-400" />
                    ) : (
                      <span className="h-[6px] w-[6px] rounded-full opacity-0" />
                    )}
                    {dots.status ? (
                      <span className="relative z-10 h-[6px] w-[6px] rounded-full bg-sky-400" />
                    ) : (
                      <span className="h-[6px] w-[6px] rounded-full opacity-0" />
                    )}
                    {dots.coping ? (
                      <span className="relative z-10 h-[6px] w-[6px] rounded-full bg-emerald-400" />
                    ) : (
                      <span className="h-[6px] w-[6px] rounded-full opacity-0" />
                    )}
                  </div>
                  {/* 아래 2점: positive 원인/상태 */}
                  <div className="mt-[4px] flex items-center justify-center gap-[6px]">
                    {dots.positiveCauses ? (
                      <span
                        className="relative z-10 h-[6px] w-[6px] rounded-full"
                        style={{ backgroundColor: "#C084FC" }}
                      />
                    ) : (
                      <span className="h-[6px] w-[6px] rounded-full opacity-0" />
                    )}
                    {dots.positiveStatus ? (
                      <span
                        className="relative z-10 h-[6px] w-[6px] rounded-full"
                        style={{ backgroundColor: "#FDE047" }}
                      />
                    ) : (
                      <span className="h-[6px] w-[6px] rounded-full opacity-0" />
                    )}
                  </div>
                </div>
              ) : (
                <div className="mx-auto mt-2 h-[15px] w-[20px]" aria-hidden />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [byDay, setByDay] = useState<Record<string, string[]>>({});
  const [moodByDay, setMoodByDay] = useState<Record<string, number>>({});
  const [moodScore, setMoodScore] = useState(0);
  const [selectedEmotion, setSelectedEmotion] = useState<string | null>(null);
  const [headersByBranch, setHeadersByBranch] = useState<Record<BranchKey, HeaderItem[]>>({
    causes: [],
    status: [],
    coping: [],
    positive_causes: [],
    positive_status: [],
  });
  const [tagItems, setTagItems] = useState<TagItem[]>([]);
  const [newItemInput, setNewItemInput] = useState<Record<string, string>>({});
  const dirtyDaysRef = useRef<Set<string>>(new Set());
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pressedItemRef = useRef<string | null>(null);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const fetchCustomItems = useCallback(async () => {
    const { data, error } = await supabase
      .from("custom_items")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("❌ custom_items 로드 실패:", error);
      return;
    }

    const rows = (data ?? [])
      .map((row) => normalizeCustomItem(row as Record<string, unknown>))
      .filter((v): v is CustomItemRow => v !== null);

    const parents = rows.filter((r) => r.parentId === null);
    const parentById = new Map<string, HeaderItem>();
    const branchHeaders: Record<BranchKey, HeaderItem[]> = {
      causes: [],
      status: [],
      coping: [],
      positive_causes: [],
      positive_status: [],
    };

    for (const p of parents) {
      const mapped = mapHeaderFromRow(p);
      if (!mapped) continue;
      parentById.set(p.id, mapped);
      branchHeaders[mapped.branch].push(mapped);
    }

    const children: TagItem[] = rows
      .filter((r) => r.parentId !== null)
      .flatMap((r) => {
        if (!r.parentId) return [];
        const parent = parentById.get(r.parentId);
        if (!parent) return [];
        return [
          {
            id: r.id,
            parentId: r.parentId,
            branch: parent.branch,
            subId: parent.subId,
            label: r.label,
          },
        ];
      });

    setHeadersByBranch(branchHeaders);
    setTagItems(children);
  }, []);

  const fetchRecords = useCallback(async () => {
    try {
      // 1. Supabase에서 모든 기록 가져오기
      const { data, error } = await supabase
        .from('user_records')
        .select('record_date, category, item_id, mood_score');
  
      if (error) throw error;
      console.log("가져온 레코드 데이터:", data);

      const { byDay: groupedByDay, moodByDay: groupedMood } = groupRecordsByDay(
        data as UserRecordRow[],
      );
      console.log("날짜별 그룹화된 키 목록:", Object.keys(groupedByDay));

      // 변환된 데이터를 로컬 상태에 병합 (로컬에서 바꾼 날짜는 덮어쓰지 않음)
      setByDay((prev) => {
        const next = { ...prev };
        for (const [date, keys] of Object.entries(groupedByDay)) {
          if (dirtyDaysRef.current.has(date)) continue;
          next[date] = keys;
        }
        console.log("최종 구성된 byDay:", next);
        return next;
      });
      setMoodByDay((prev) => {
        const next = { ...prev };
        for (const [date, score] of Object.entries(groupedMood)) {
          if (dirtyDaysRef.current.has(date)) continue;
          next[date] = score;
        }
        return next;
      });
      console.log("📥 Supabase에서 데이터를 성공적으로 동기화했습니다.");
    } catch (error) {
      console.error("❌ 데이터 로드 실패:", error);
    }
  }, []);
  

  useEffect(() => {
    setMounted(true);
  }, []);
  

  // 1. 데이터 초기 복원 로직 (localStorage 확인 후 Supabase 동기화)
  useEffect(() => {
  if (!mounted) return;

  const initData = async () => {
    // [Step 1] 먼저 로컬스토리지에 있는 데이터를 빠르게 불러와 화면을 띄웁니다.
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string[]>;
        setByDay(parsed);
      }
      const rawMood = window.localStorage.getItem(STORAGE_MOOD_KEY);
      if (rawMood) {
        const parsedMood = JSON.parse(rawMood) as Record<string, number>;
        setMoodByDay(parsedMood);
      }
    } catch (e) {
      console.error("로컬 데이터 파싱 실패", e);
    }

    // [Step 2] 그 다음, 서버(Supabase)에서 '진짜 최신' 데이터를 가져와 업데이트합니다.
    // 아까 정의한 fetchRecords 함수를 여기서 호출합니다.
    await Promise.all([fetchRecords(), fetchCustomItems()]);
  };

  initData();
  }, [mounted, fetchRecords, fetchCustomItems]); // ✅ 의존성에 fetch 함수 포함

  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, [clearLongPressTimer]);

  // 기록 변경 시 localStorage에 저장(디바운스)
  useEffect(() => {
    if (!mounted) return;
    const t = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(byDay));
      } catch {
        // 저장 실패 무시
      }
    }, 200);
    return () => window.clearTimeout(t);
  }, [byDay, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const t = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_MOOD_KEY, JSON.stringify(moodByDay));
      } catch {
        // 저장 실패 무시
      }
    }, 200);
    return () => window.clearTimeout(t);
  }, [moodByDay, mounted]);

  const dayKey = useMemo(
    () => (selectedDate ? toDayKey(selectedDate) : ""),
    [selectedDate],
  );

  const dayKeys = useMemo(() => (dayKey ? byDay[dayKey] ?? [] : []), [byDay, dayKey]);
  const selectedSet = useMemo(() => new Set(dayKeys), [dayKeys]);
  const isPositiveMode = moodScore >= 0;
  const moodEmoji = moodScore >= 4 ? "😄" : moodScore >= 1 ? "🙂" : moodScore >= 0 ? "😐" : moodScore >= -3 ? "😔" : "😭";

  // 태그/날짜에 맞춰 정신적(mental) 대표 감정만 반영 (byDay 변경 시에도 실행)
  useEffect(() => {
    if (!selectedDate) {
      setSelectedEmotion(null);
      return;
    }
    const keys = byDay[dayKey] ?? [];
    const mental = keys
      .map(parseFullKey)
      .find((p) => p.branch === "status" && p.subId === "mental" && p.tag);
    setSelectedEmotion(mental?.tag ?? null);
  }, [byDay, dayKey, selectedDate]);

  // 기분: 날짜 전환·저장소 동기화 시에만 불러오고, 같은 날에서 태그만 바꿀 때는 건드리지 않음.
  // 편집 중(dirty)인 날은 슬라이더/미저장 값이 서버·moodByDay에 덮이지 않게 함.
  useEffect(() => {
    if (!selectedDate) {
      setMoodScore(0);
      return;
    }
    if (dirtyDaysRef.current.has(dayKey)) {
      return;
    }
    setMoodScore(moodByDay[dayKey] ?? 0);
  }, [dayKey, moodByDay, selectedDate]);

  const toggle = useCallback(
    (key: string) => {
      if (!selectedDate) return;
      dirtyDaysRef.current.add(dayKey);
      const parsed = parseFullKey(key);
      if (parsed.branch === "status" && parsed.subId === "mental") {
        setSelectedEmotion((prev) => (prev === parsed.tag ? null : parsed.tag));
      }
      setByDay((prev) => {
        const current = prev[dayKey] ?? [];
        const next = current.includes(key)
          ? current.filter((k) => k !== key)
          : [...current, key];
        return { ...prev, [dayKey]: next };
      });
    },
    [dayKey, selectedDate],
  );

  const onCalendarChange = useCallback((value: Value) => {
    const d = pickDate(value);
    if (d) setSelectedDate(normalizeDate(d));
  }, []);

  const onCalendarDayClick = useCallback((d: Date) => {
    setSelectedDate(normalizeDate(d));
  }, []);

  const onMoodScoreChange = useCallback(
    (value: number) => {
      if (!selectedDate) return;
      dirtyDaysRef.current.add(dayKey);
      setMoodScore(value);
    },
    [dayKey, selectedDate],
  );

  const tileClassName = useCallback(
    ({ date, view }: TileArgs) => {
      if (view !== "month") return undefined;
      const k = toDayKey(date);
      const symptoms = byDay[k] || [];
      
      if (symptoms.length === 0) return undefined;
  
      // 어떤 종류의 데이터들이 들어있는지 세트로 확인 (중복 제거)
      const types = new Set(symptoms.map(s => s.split(":")[0]));
      
      const classes = [];
      if (types.has("causes")) classes.push("has-causes");
      if (types.has("status")) classes.push("has-status");
      if (types.has("coping")) classes.push("has-coping");
      if (types.has("positive_causes")) classes.push("has-positive-causes");
      if (types.has("positive_status")) classes.push("has-positive-status");
  
      // "has-causes has-status has-coping" 형태의 문자열로 반환
      return classes.join(" ");
    },
    [byDay]
  ); 

  const formattedLabel = useMemo(
    () =>
      selectedDate
        ? selectedDate.toLocaleDateString("ko-KR", {
            year: "numeric",
            month: "long",
            day: "numeric",
            weekday: "long",
          })
        : "",
    [selectedDate],
  );

  const renderSubgroup = (branch: BranchKey, sub: HeaderItem) => (
    <div
      key={sub.id}
      className={
        branch === "causes"
          ? "rounded-2xl border border-rose-100/80 bg-white/80 p-3 shadow-sm sm:p-4"
          : branch === "status"
            ? "rounded-2xl border border-sky-100/80 bg-white/80 p-3 shadow-sm sm:p-4"
            : branch === "coping"
              ? "rounded-2xl border border-emerald-100/80 bg-white/80 p-3 shadow-sm sm:p-4"
              : "rounded-2xl border border-amber-100/80 bg-white/90 p-3 shadow-sm sm:p-4"
      }
    >
      <h3
        className={
          branch === "causes"
            ? "mb-2 text-[13px] font-semibold tracking-wide text-rose-900/80"
            : branch === "status"
              ? "mb-2 text-[13px] font-semibold tracking-wide text-sky-900/80"
              : branch === "coping"
                ? "mb-2 text-[13px] font-semibold tracking-wide text-emerald-900/80"
                : "mb-2 text-[13px] font-semibold tracking-wide text-amber-900"
        }
      >
        <div className="flex items-center justify-between gap-2">
          <span>{sub.title}</span>
          <button
            type="button"
            onClick={() => void addCustomItem(sub)}
            className={
              branch === "causes"
                ? "h-6 w-6 rounded-full bg-rose-200/80 text-rose-900"
                : branch === "status"
                  ? "h-6 w-6 rounded-full bg-sky-200/80 text-sky-900"
                  : branch === "coping"
                    ? "h-6 w-6 rounded-full bg-emerald-200/80 text-emerald-900"
                    : "h-6 w-6 rounded-full bg-amber-200/90 text-amber-900"
            }
            aria-label={`${sub.title} 항목 추가`}
            title={`${sub.title} 항목 추가`}
          >
            +
          </button>
        </div>
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {tagItems
          .filter((item) => item.branch === branch && item.subId === sub.subId)
          .map((item) => {
          const k = tagKey(branch, sub.subId, item.label);
          const isOn = selectedSet.has(k);
          return (
            <button
              key={item.id}
              type="button"
              onPointerDown={() => {
                pressedItemRef.current = item.id;
                longPressTriggeredRef.current = false;
                clearLongPressTimer();
                longPressTimerRef.current = window.setTimeout(async () => {
                  longPressTriggeredRef.current = true;
                  const ok = window.confirm(`'${item.label}' 항목을 삭제할까요?`);
                  if (!ok) return;

                  const { error } = await supabase
                    .from("custom_items")
                    .delete()
                    .eq("id", item.id);

                  if (error) {
                    console.error("❌ custom_items 삭제 실패:", error);
                    return;
                  }

                  setTagItems((prev) => prev.filter((x) => x.id !== item.id));
                  setByDay((prev) => {
                    const next: Record<string, string[]> = {};
                    for (const [date, keys] of Object.entries(prev)) {
                      next[date] = keys.filter((x) => x !== k);
                    }
                    return next;
                  });
                }, 1000);
              }}
              onPointerUp={clearLongPressTimer}
              onPointerLeave={clearLongPressTimer}
              onPointerCancel={clearLongPressTimer}
              onClick={() => {
                const isLongPressClick =
                  longPressTriggeredRef.current && pressedItemRef.current === item.id;
                longPressTriggeredRef.current = false;
                pressedItemRef.current = null;
                if (isLongPressClick) return;
                toggle(k);
              }}
              className={`rounded-full px-2 py-1 text-[11px] font-medium transition-all ${
                isOn
                  ? branch === "causes"
                    ? "bg-rose-400 text-white shadow-md shadow-rose-200/60"
                    : branch === "status"
                      ? "bg-sky-400 text-white shadow-md shadow-sky-200/60"
                      : branch === "coping"
                        ? "bg-emerald-400 text-white shadow-md shadow-emerald-200/60"
                        : "bg-amber-400 text-white shadow-md shadow-amber-200/60"
                  : branch === "causes"
                    ? "bg-rose-50/90 text-stone-600 ring-1 ring-rose-100 hover:bg-rose-100/70"
                    : branch === "status"
                      ? "bg-sky-50/90 text-stone-600 ring-1 ring-sky-100 hover:bg-sky-100/70"
                      : branch === "coping"
                        ? "bg-emerald-50/90 text-stone-600 ring-1 ring-emerald-100 hover:bg-emerald-100/70"
                        : "bg-amber-50/90 text-stone-600 ring-1 ring-amber-100 hover:bg-amber-100/70"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={newItemInput[sub.id] ?? ""}
          onChange={(e) =>
            setNewItemInput((prev) => ({ ...prev, [sub.id]: e.target.value }))
          }
          placeholder={`${sub.title} 항목 추가`}
          className="h-7 flex-1 rounded-xl border border-stone-200/80 bg-white/90 px-2.5 text-xs outline-none placeholder:text-stone-400"
        />
      </div>
    </div>
  );

  const addCustomItem = useCallback(
    async (parent: HeaderItem) => {
      const label = (newItemInput[parent.id] ?? "").trim();
      if (!label) return;

      const payload = {
        category: parent.branch,
        label,
        parent_id: parent.id,
      };
      const { data, error } = await supabase
        .from("custom_items")
        .insert(payload)
        .select("*")
        .single();

      if (error) {
        console.error("❌ custom_items 추가 실패:", error);
        return;
      }

      const normalized = normalizeCustomItem(data as Record<string, unknown>);
      if (normalized) {
        setTagItems((prev) => [
          ...prev,
          {
            id: normalized.id,
            parentId: parent.id,
            branch: parent.branch,
            subId: parent.subId,
            label: normalized.label,
          },
        ]);
      }
      setNewItemInput((prev) => ({ ...prev, [parent.id]: "" }));
    },
    [newItemInput],
  );

  const commitDay = useCallback(async () => {
    if (!selectedDate) return;
    const keysToSave = byDay[dayKey] ?? [];
    const scoreToSave = Math.max(-5, Math.min(5, moodScore));
    setMoodByDay((prev) => ({ ...prev, [dayKey]: scoreToSave }));
  
    // B. [DB 동기화] Supabase 서버에 데이터를 전송합니다.
    try {
      // 1. 해당 날짜에 이미 저장된 데이터가 있다면 싹 지웁니다. (Overwrite 전략)
      const { error: deleteError } = await supabase
        .from('user_records')
        .delete()
        .eq('record_date', dayKey);
  
      if (deleteError) throw deleteError;
  
      // 2. 체크된 항목이 있을 때만 DB에 한 줄씩 넣습니다.
      if (keysToSave.length > 0) {
        const rowsToInsert = keysToSave.map((fullKey: string) => {
          // 'causes:stress' 형태를 분리해서 DB 컬럼에 맞게 매핑합니다.
          const [category, ...rest] = fullKey.split(":");
          const item_id = rest.join(":");
          return {
            record_date: dayKey,
            category,
            item_id,
            mood_score: scoreToSave,
          };
        });
  
        const { error: insertError } = await supabase
          .from('user_records')
          .insert(rowsToInsert);
        
        if (insertError) throw insertError;
      }
  
      console.log(`✅ ${dayKey} 데이터가 Supabase에 성공적으로 동기화되었습니다.`);
      // 서버 저장까지 성공했으면, 이 날짜는 이제 덮어써도 되는 상태로 전환
      dirtyDaysRef.current.delete(dayKey);
      // 저장 직후 즉시 재조회해서 달력 점/기록 상태를 최신 서버값으로 반영
      await fetchRecords();
    } catch (error) {
      // 네트워크 오류 등으로 실패할 경우 콘솔에 찍습니다.
      console.error("❌ Supabase 저장 중 오류 발생:", error);
    }
  
    // 작업이 끝나면 대시보드 닫기
    setSelectedDate(null);
  }, [byDay, dayKey, fetchRecords, moodScore, selectedDate]);

  return (
    <main
      className={`relative min-h-svh px-3 pb-2 pt-6 text-stone-800 sm:px-5 sm:pt-8 ${
        isPositiveMode
          ? "bg-gradient-to-b from-amber-50 via-sky-50 to-cyan-100"
          : "bg-gradient-to-b from-indigo-100 via-slate-100 to-gray-200"
      }`}
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-6 sm:gap-8 md:max-w-3xl">
        <header className="space-y-1 text-center sm:text-left">
          <p className="text-sm font-medium text-stone-500">CodedByYeni&apos;s Tracker</p>
          <h1 className="text-xl font-bold tracking-tight text-stone-900 sm:text-2xl">
            달력 기록 대시보드
          </h1>
          <p className="text-stone-600">
            날짜를 선택하면 달력이 1주일치로 줄어들고, 기록 섹션이 아래에서 위로 올라와요.
          </p>
        </header>

        <section
          className="rounded-3xl border border-white/60 bg-white/50 p-3 shadow-sm backdrop-blur-sm sm:p-5"
          aria-label="달력"
        >
          <div className="overflow-hidden">
            {/* Month -> Week collapsible */}
            <div
              className={`transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] overflow-hidden ${
                selectedDate
                  ? "max-h-0 opacity-0 pointer-events-none"
                  : "max-h-[520px] opacity-100"
              }`}
            >
              {mounted ? (
                <div className="flex w-full justify-center pb-1">
                  <Calendar
                    className="pastel-calendar"
                    value={selectedDate ?? normalizeDate(new Date())}
                    onChange={onCalendarChange}
                    onClickDay={onCalendarDayClick}
                    locale="ko-KR"
                    calendarType="iso8601"
                    tileClassName={tileClassName}
                  />
                </div>
              ) : (
                <div
                  className="mx-auto flex h-[min(22rem,55vw)] max-w-md items-center justify-center rounded-2xl bg-white/40 text-sm text-stone-400"
                  aria-hidden
                >
                  달력 불러오는 중…
                </div>
              )}
            </div>

            <div
              className={`transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] overflow-hidden ${
                selectedDate
                  ? "max-h-[220px] opacity-100"
                  : "max-h-0 opacity-0 pointer-events-none"
              }`}
            >
              {mounted && selectedDate ? (
                <WeekStrip
                  anchorDate={selectedDate}
                  selectedDate={selectedDate}
                  onSelect={(d) => setSelectedDate(normalizeDate(d))}
                  byDay={byDay}
                />
              ) : null}
            </div>
          </div>
        </section>
      </div>

      {/* Bottom Sheet (Slide-up record panel) */}
      {/*
        Wrapper는 항상 렌더되어 transition이 끊기지 않게 하고,
        내부 컨텐츠는 selectedDate가 있을 때만 렌더합니다.
      */}
      {(() => {
        const panelOpen = mounted && !!selectedDate;
        return (
          <div
            className={`fixed inset-x-0 bottom-0 z-40 transform-gpu transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              panelOpen ? "translate-y-0" : "translate-y-full"
            }`}
            aria-hidden={!panelOpen}
          >
            <div className="mx-auto w-full max-w-3xl rounded-t-3xl border border-white/70 bg-white/90 backdrop-blur-md shadow-2xl">
              <div className="flex min-h-[52vh] max-h-[88dvh] flex-col">
                <div className="px-3 pt-2 sm:px-4">
                  <div className="mx-auto h-1.5 w-14 rounded-full bg-stone-200/80" />

                  <div className="mt-2 flex items-start justify-between gap-2 pb-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-stone-500">
                        {selectedDate ? "기록" : ""}
                      </div>
                      <div className="truncate text-base font-semibold text-stone-900 sm:text-lg">
                        {formattedLabel || "날짜를 선택해 주세요"}
                      </div>
                      <div className="mt-1 text-xs text-stone-500">
                        {selectedDate
                          ? "선택한 날짜에 해당하는 태그만 저장돼요."
                          : "달력에서 날짜를 눌러 기록을 시작해 보세요."}
                      </div>
                      {selectedDate ? (
                        <div className="mt-2 rounded-xl border border-stone-200/80 bg-white/80 p-2">
                          <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-stone-600">
                            <span>기분 수치</span>
                            <span>
                              {moodEmoji} {moodScore}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={-5}
                            max={5}
                            step={1}
                            value={moodScore}
                            onChange={(e) => onMoodScoreChange(Number(e.target.value))}
                            className="w-full accent-rose-400"
                          />
                          <div className="mt-0.5 flex justify-between text-[10px] text-stone-400">
                            <span>-5 매우 나쁨</span>
                            <span>+5 매우 좋음</span>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedDate(null)}
                      className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-2xl border border-stone-200/70 bg-white/70 text-stone-500 transition hover:bg-white"
                      aria-label="기록 닫기"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-3 pb-2 sm:px-4">
                  {selectedDate ? (
                    <div className="space-y-4">
                      {isPositiveMode ? (
                        <>
                          <article className="space-y-4 rounded-3xl border border-amber-100/70 bg-gradient-to-br from-amber-50/90 to-yellow-50/60 p-4 shadow-sm sm:p-5">
                            <div className="flex items-center gap-3 border-b border-amber-100/80 pb-2">
                              <span
                                className="flex h-7 w-7 items-center justify-center rounded-2xl bg-amber-200/80 text-[12px]"
                                aria-hidden
                              >
                                ✨
                              </span>
                              <div>
                                <h2 className="text-base leading-tight font-bold text-amber-950 sm:text-lg">
                                  긍정 기분
                                </h2>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              {headersByBranch.positive_status.map((sub) =>
                                renderSubgroup("positive_status", sub),
                              )}
                            </div>
                          </article>

                          <article className="space-y-4 rounded-3xl border border-sky-100/70 bg-gradient-to-br from-sky-50/90 to-cyan-50/60 p-4 shadow-sm sm:p-5">
                            <div className="flex items-center gap-3 border-b border-sky-100/80 pb-2">
                              <span
                                className="flex h-7 w-7 items-center justify-center rounded-2xl bg-sky-200/80 text-[12px]"
                                aria-hidden
                              >
                                ☀️
                              </span>
                              <div>
                                <h2 className="text-base leading-tight font-bold text-sky-950 sm:text-lg">
                                  긍정 원인
                                </h2>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              {headersByBranch.positive_causes.map((sub) =>
                                renderSubgroup("positive_causes", sub),
                              )}
                            </div>
                          </article>
                        </>
                      ) : (
                        <>
                          <article className="space-y-4 rounded-3xl border border-rose-100/70 bg-gradient-to-br from-rose-50/90 to-amber-50/50 p-4 shadow-sm sm:p-5">
                            <div className="flex items-center gap-3 border-b border-rose-100/80 pb-2">
                              <span
                                className="flex h-7 w-7 items-center justify-center rounded-2xl bg-rose-200/70 text-[11px] font-bold text-rose-900"
                                aria-hidden
                              >
                                원
                              </span>
                              <div>
                                <h2 className="text-base leading-tight font-bold text-rose-950 sm:text-lg">
                                  원인
                                </h2>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                              {headersByBranch.causes.map((sub) =>
                                renderSubgroup("causes", sub),
                              )}
                            </div>
                          </article>

                          <article className="space-y-4 rounded-3xl border border-sky-100/70 bg-gradient-to-br from-sky-50/90 to-violet-50/40 p-4 shadow-sm sm:p-5">
                            <div className="flex items-center gap-3 border-b border-sky-100/80 pb-2">
                              <span
                                className="flex h-7 w-7 items-center justify-center rounded-2xl bg-sky-200/70 text-[13px]"
                                aria-hidden
                              >
                                ◎
                              </span>
                              <div>
                                <h2 className="text-base leading-tight font-bold text-sky-950 sm:text-lg">
                                  상태
                                </h2>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              {headersByBranch.status.map((sub) =>
                                renderSubgroup("status", sub),
                              )}
                            </div>
                          </article>

                          <article className="space-y-4 rounded-3xl border border-emerald-100/70 bg-gradient-to-br from-emerald-50/90 to-teal-50/40 p-4 shadow-sm sm:p-5">
                            <div className="flex items-center gap-3 border-b border-emerald-100/80 pb-2">
                              <span
                                className="flex h-7 w-7 items-center justify-center rounded-2xl bg-emerald-200/70 text-[11px] font-bold text-emerald-900"
                                aria-hidden
                              >
                                대
                              </span>
                              <div>
                                <h2 className="text-base leading-tight font-bold text-emerald-950 sm:text-lg">
                                  대처
                                </h2>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              {headersByBranch.coping.map((sub) =>
                                renderSubgroup("coping", sub),
                              )}
                            </div>
                          </article>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>

                {/* Action button */}
                <div className="sticky bottom-0 border-t border-stone-200/80 bg-white/80 px-3 py-2 backdrop-blur-md sm:px-4">
                  <button
                    type="button"
                    onClick={commitDay}
                    className="w-full rounded-2xl bg-stone-900 py-2 text-center text-sm font-semibold text-white shadow-lg shadow-stone-900/10 transition hover:bg-stone-800 sm:text-base"
                  >
                    기록 완료 ({selectedSet.size}개 선택됨)
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </main>
  );
}
