"use client";

import Calendar, { type TileArgs } from "react-calendar";
import type { Value } from "react-calendar/dist/shared/types.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";

export type SymptomSubGroup = {
  id: string;
  title: string;
  tags: readonly string[];
};

/** 카테고리별 태그 — causes: 원인 그룹, status: 상태 그룹 */
export const groups: {
  causes: SymptomSubGroup[];
  status: SymptomSubGroup[];
  coping: SymptomSubGroup[];
} = {
  causes: [
    {
      id: "environmental",
      title: "환경적",
      tags: [
        "저기압/비/흐림",
        "추위/더위",
        "소음",
        "강한 빛/냄새",
      ],
    },
    {
      id: "social",
      title: "상황적",
      tags: [
        "사람 만남",
        "가면 써야 함",
        "할 일 많음",
        "계획 이탈",
        "예상치 못함",
      ],
    },
    {
      id: "physiological",
      title: "생리/심리적",
      tags: [
        "수면 부족",
        "식사 거름",
        "생리",
        "과거 회상",
        "자기 비판",
      ],
    },
  ],
  status: [
    {
      id: "mental",
      title: "정신적",
      tags: ["슬픔", "우울", "회피", "불안/긴장", "예민", "무기력", "감정 기복", "집중 저하"],
    },
    {
      id: "physical",
      title: "신체적",
      tags: [
        "관절통",
        "두통",
        "심박수 증가",
        "감각 예민",
        "피로감",
        "식욕 변화",
        "무기력",
      ],
    },
  ],
  coping: [
    {
      id: "rest",
      title: "휴식",
      tags: [
        "침대 눕기",
        "암전",
        "무소음",
        "전자기기 멀리하기",
        "따뜻하게 하기",
        "아무것도 안 하기",
        "잠",
        "끄적끄적"
      ],
    },
    {
      id: "activity",
      title: "활동",
      tags: [
        "가벼운 산책",
        "스트레칭",
        "샤워",
        "언어공부",
        "조용한 음악 듣기",
        "맛있는 거 먹기",
        "애니/만화 감상",
        "노래방 가기",
      ],
    },
  ],
};

const STORAGE_KEY = "my-symptom-app.byDay.v1";

function toDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  branch: keyof typeof groups,
  subId: string,
  tag: string,
): string {
  return `${branch}:${subId}:${tag}`;
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

function getDayIndicator(keys: string[] | undefined) {
  if (!keys || keys.length === 0) {
    return { emoji: "", accentBg: "bg-transparent", accentText: "text-transparent" };
  }

  const emojiBySub: Record<string, string> = {
    "causes:environmental": "🌦️",
    "causes:social": "🧑‍🤝‍🧑",
    "causes:physiological": "🧬",
    "status:mental": "🧠",
    "status:physical": "🫀",
    "coping:rest": "🛌",
    "coping:activity": "🚶",
  };

  // 첫 매칭을 우선으로 하되, fallback은 점.
  for (const k of keys) {
    const [branch, subId] = k.split(":");
    if (!branch || !subId) continue;

    const emoji = emojiBySub[`${branch}:${subId}`] ?? "•";
    const accent =
      branch === "causes"
        ? { bg: "bg-rose-100/70", text: "text-rose-900" }
        : branch === "status"
          ? { bg: "bg-sky-100/70", text: "text-sky-900" }
          : { bg: "bg-emerald-100/70", text: "text-emerald-900" };

    return { emoji, accentBg: accent.bg, accentText: accent.text };
  }

  return { emoji: "•", accentBg: "bg-stone-200/60", accentText: "text-stone-600" };
}

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

      <div className="mt-0.5 grid grid-cols-7 gap-4">
        {days.map((d) => {
          const k = toDayKey(d);
          const isSelected = toDayKey(selectedDate) === k;
          const indicator = getDayIndicator(byDay[k]);
          const hasEntry = indicator.emoji !== "";
          return (
            <button
              key={k}
              type="button"
              onClick={() => onSelect(d)}
              className={`min-h-[46px] rounded-2xl border px-1.5 py-8 text-center transition-all duration-200 ${
                isSelected
                  ? "border-rose-300 bg-rose-100/70 shadow-sm"
                  : "border-stone-200 bg-white/70 hover:bg-white"
              }`}
            >
              <div className="text-[12px] font-bold leading-none text-stone-800">
                {d.getDate()}
              </div>
              {hasEntry ? (
                <div
                  className={`mx-auto mt-1 flex h-5 w-5 items-center justify-center rounded-full ${indicator.accentBg} ${indicator.accentText} text-[11px]`}
                >
                  {indicator.emoji}
                </div>
              ) : (
                <div className="mx-auto mt-1 h-5 w-5" aria-hidden />
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
  const [draftKeys, setDraftKeys] = useState<string[]>([]);

  const fetchRecords = useCallback(async () => {
    try {
      // 1. Supabase에서 모든 기록 가져오기
      const { data, error } = await supabase
        .from('user_records')
        .select('record_date, category, item_id');
  
      if (error) throw error;
  
      // 2. DB의 한 줄 한 줄 데이터를 { "날짜": ["category:item_id", ...] } 형태로 변환
      // 전공자님, 이 과정이 바로 '데이터 가공(Reduce)'의 핵심입니다!
      const transformed = data.reduce((acc: Record<string, string[]>, row) => {
        const date = row.record_date;
        const fullKey = `${row.category}:${row.item_id}`;
        
        if (!acc[date]) acc[date] = [];
        acc[date].push(fullKey);
        return acc;
      }, {});
  
      // 3. 변환된 데이터를 로컬 상태에 반영
      setByDay(transformed);
      console.log("📥 Supabase에서 데이터를 성공적으로 동기화했습니다.");
    } catch (error) {
      console.error("❌ 데이터 로드 실패:", error);
    }
  }, [setByDay]);
  

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
        const parsed = JSON.parse(raw);
        setByDay(parsed);
      }
    } catch (e) {
      console.error("로컬 데이터 파싱 실패", e);
    }

    // [Step 2] 그 다음, 서버(Supabase)에서 '진짜 최신' 데이터를 가져와 업데이트합니다.
    // 아까 정의한 fetchRecords 함수를 여기서 호출합니다.
    await fetchRecords();
  };

  initData();
}, [mounted, fetchRecords]); // ✅ fetchRecords가 포함되어야 합니다.

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

  const dayKey = useMemo(
    () => (selectedDate ? toDayKey(selectedDate) : ""),
    [selectedDate],
  );

  const selectedSet = useMemo(() => new Set(draftKeys), [draftKeys]);

  // 선택한 날짜가 바뀔 때만 초안을 해당 날짜의 저장값으로 동기화합니다.
  useEffect(() => {
    if (!selectedDate) {
      setDraftKeys([]);
      return;
    }
    setDraftKeys(byDay[dayKey] ?? []);
  }, [byDay, dayKey, selectedDate]);

  const toggle = useCallback(
    (key: string) => {
      if (!selectedDate) return;
      setDraftKeys((prev) => {
        const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
        return next;
      });
    },
    [selectedDate],
  );

  const onCalendarChange = useCallback((value: Value) => {
    const d = pickDate(value);
    if (d) setSelectedDate(normalizeDate(d));
  }, []);

  const onCalendarDayClick = useCallback((d: Date) => {
    setSelectedDate(normalizeDate(d));
  }, []);

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

  const renderSubgroup = (branch: keyof typeof groups, sub: SymptomSubGroup) => (
    <div
      key={sub.id}
      className={
        branch === "causes"
          ? "rounded-2xl border border-rose-100/80 bg-white/80 p-3 shadow-sm sm:p-4"
          : branch === "status"
            ? "rounded-2xl border border-sky-100/80 bg-white/80 p-3 shadow-sm sm:p-4"
            : "rounded-2xl border border-emerald-100/80 bg-white/80 p-3 shadow-sm sm:p-4"
      }
    >
      <h3
        className={
          branch === "causes"
            ? "mb-2 text-[13px] font-semibold tracking-wide text-rose-900/80"
            : branch === "status"
              ? "mb-2 text-[13px] font-semibold tracking-wide text-sky-900/80"
              : "mb-2 text-[13px] font-semibold tracking-wide text-emerald-900/80"
        }
      >
        {sub.title}
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {sub.tags.map((tag) => {
          const k = tagKey(branch, sub.id, tag);
          const isOn = selectedSet.has(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggle(k)}
              className={`rounded-full px-2 py-1 text-[11px] font-medium transition-all ${
                isOn
                  ? branch === "causes"
                    ? "bg-rose-400 text-white shadow-md shadow-rose-200/60"
                    : branch === "status"
                      ? "bg-sky-400 text-white shadow-md shadow-sky-200/60"
                      : "bg-emerald-400 text-white shadow-md shadow-emerald-200/60"
                  : branch === "causes"
                    ? "bg-rose-50/90 text-stone-600 ring-1 ring-rose-100 hover:bg-rose-100/70"
                    : branch === "status"
                      ? "bg-sky-50/90 text-stone-600 ring-1 ring-sky-100 hover:bg-sky-100/70"
                      : "bg-emerald-50/90 text-stone-600 ring-1 ring-emerald-100 hover:bg-emerald-100/70"
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>
    </div>
  );

  /*const commitDay = useCallback(() => {
    if (!selectedDate) return;
    setByDay((prev) => {
      const next = { ...prev };
      if (draftKeys.length === 0) {
        delete next[dayKey];
        return next;
      }
      next[dayKey] = draftKeys;
      return next;
    });
    setSelectedDate(null);
  }, [dayKey, draftKeys, selectedDate]); */
  const commitDay = useCallback(async () => {
    if (!selectedDate) return;
  
    // A. [UI 반응성] 로컬 상태를 먼저 업데이트해서 사용자에게 즉각적인 피드백을 줍니다.
    setByDay((prev) => {
      const next = { ...prev };
      if (draftKeys.length === 0) {
        delete next[dayKey];
      } else {
        next[dayKey] = draftKeys;
      }
      return next;
    });
  
    // B. [DB 동기화] Supabase 서버에 데이터를 전송합니다.
    try {
      // 1. 해당 날짜에 이미 저장된 데이터가 있다면 싹 지웁니다. (Overwrite 전략)
      const { error: deleteError } = await supabase
        .from('user_records')
        .delete()
        .eq('record_date', dayKey);
  
      if (deleteError) throw deleteError;
  
      // 2. 체크된 항목(draftKeys)이 있을 때만 DB에 한 줄씩 넣습니다.
      if (draftKeys.length > 0) {
        const rowsToInsert = draftKeys.map(fullKey => {
          // 'causes:stress' 형태를 분리해서 DB 컬럼에 맞게 매핑합니다.
          const [category, item_id] = fullKey.split(':');
          return {
            record_date: dayKey,
            category,
            item_id
          };
        });
  
        const { error: insertError } = await supabase
          .from('user_records')
          .insert(rowsToInsert);
        
        if (insertError) throw insertError;
      }
  
      console.log(`✅ ${dayKey} 데이터가 Supabase에 성공적으로 동기화되었습니다.`);
    } catch (error) {
      // 네트워크 오류 등으로 실패할 경우 콘솔에 찍습니다.
      console.error("❌ Supabase 저장 중 오류 발생:", error);
    }
  
    // 작업이 끝나면 대시보드 닫기
    setSelectedDate(null);
  }, [dayKey, draftKeys, selectedDate, setByDay]);

  return (
    <main className="relative min-h-svh bg-gradient-to-b from-[#fdf4ff] via-[#fff7ed] to-[#f0f9ff] px-3 pb-2 pt-6 text-stone-800 sm:px-5 sm:pt-8">
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
                          {groups.causes.map((sub) =>
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
                          {groups.status.map((sub) =>
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
                          {groups.coping.map((sub) =>
                            renderSubgroup("coping", sub),
                          )}
                        </div>
                      </article>
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
