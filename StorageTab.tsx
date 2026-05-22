import { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, PanResponder, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getEntriesByDate, getAllEntries, EntryRow } from './database';

type ViewMode = '1day' | '3days' | '1week';
type DisplayMode = 'calendar' | 'list';

const DEFAULT_HOUR_HEIGHT = 56;
const TIME_GUTTER = 52;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MIN_LABEL_HEIGHT = 18;

function formatHour(h: number): string {
  if (h === 0) return '';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatElapsedHuman(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function rangeLabel(days: Date[], mode: ViewMode): string {
  const opts = { month: 'short' as const, day: 'numeric' as const };
  if (mode === '1day') {
    return days[0].toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  }
  const start = days[0].toLocaleDateString('en-US', opts);
  const end = days[days.length - 1].toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  return `${start} – ${end}`;
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Props {
  onSwitchTab: () => void;
}

export default function StorageTab({ onSwitchTab }: Props) {
  const [mode, setMode] = useState<ViewMode>('1week');
  const [offset, setOffset] = useState(0);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('calendar');
  const [entries, setEntries] = useState<Record<string, EntryRow[]>>({});
  const [visibleMinutes, setVisibleMinutes] = useState(720); // 12h default
  const [gridHeight, setGridHeight] = useState(0);

  // hourHeight is derived: fill the visible grid area with visibleMinutes worth of time
  const hourHeight = gridHeight > 0 ? (gridHeight * 60) / visibleMinutes : DEFAULT_HOUR_HEIGHT;

  useEffect(() => {
    console.log('[BED] All DB entries:', getAllEntries());
  }, []);

  const onSwitchTabRef = useRef(onSwitchTab);
  onSwitchTabRef.current = onSwitchTab;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 15 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
      onPanResponderRelease: (_, gs) => {
        if (Math.abs(gs.dx) < 40) return;
        const startY = gs.y0;
        const screenH = Dimensions.get('window').height;
        if (startY < screenH * 0.75) {
          if (gs.dx < 0) setOffset(o => o + 1);
          else setOffset(o => o - 1);
        } else {
          onSwitchTabRef.current();
        }
      },
    })
  ).current;

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const days = useMemo(() => {
    if (displayMode === 'list') {
      return [addDays(today, offset)];
    }

    let pageStart: Date;
    let daysCount: number;

    if (mode === '1day') {
      daysCount = 1;
      pageStart = addDays(today, offset);
    } else if (mode === '3days') {
      daysCount = 3;
      pageStart = addDays(today, offset * 3);
    } else {
      daysCount = 7;
      const dow = today.getDay();
      const toMonday = dow === 0 ? -6 : 1 - dow;
      pageStart = addDays(today, toMonday + offset * 7);
    }

    return Array.from({ length: daysCount }, (_, i) => addDays(pageStart, i));
  }, [today, mode, offset, displayMode]);

  useEffect(() => {
    const result: Record<string, EntryRow[]> = {};
    for (const day of days) {
      const key = toDateKey(day);
      result[key] = getEntriesByDate(key);
    }
    setEntries(result);
  }, [days]);

  function toggleDisplayMode() {
    setOffset(0);
    setDisplayMode(d => d === 'calendar' ? 'list' : 'calendar');
  }

  function zoomIn() {
    setVisibleMinutes(m => Math.max(30, m - 30));
  }

  function zoomOut() {
    setVisibleMinutes(m => Math.min(1440, m + 30));
  }

  const listDay = days[0];
  const listEntries = entries[toDateKey(listDay)] ?? [];

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <View style={styles.navRow}>
        <TouchableOpacity style={styles.navBtn} onPress={() => setOffset(o => o - 1)}>
          <Text style={styles.navArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.rangeLabel}>{rangeLabel(days, displayMode === 'list' ? '1day' : mode)}</Text>
        <TouchableOpacity style={styles.navBtn} onPress={() => setOffset(o => o + 1)}>
          <Text style={styles.navArrow}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.modeRow}>
        {displayMode === 'calendar' && (['1day', '3days', '1week'] as ViewMode[]).map(m => (
          <TouchableOpacity
            key={m}
            style={[styles.modeBtn, mode === m && styles.modeBtnOn]}
            onPress={() => { setMode(m); setOffset(0); }}
          >
            <Text style={[styles.modeBtnText, mode === m && styles.modeBtnTextOn]}>
              {m === '1day' ? '1 Day' : m === '3days' ? '3 Days' : '1 Week'}
            </Text>
          </TouchableOpacity>
        ))}
        {displayMode === 'calendar' && (
          <View style={styles.zoomBtns}>
            <TouchableOpacity
              style={[styles.zoomBtn, visibleMinutes >= 1440 && styles.zoomBtnDisabled]}
              onPress={zoomOut}
              disabled={visibleMinutes >= 1440}
            >
              <Text style={styles.zoomBtnText}>−</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.zoomBtn, visibleMinutes <= 30 && styles.zoomBtnDisabled]}
              onPress={zoomIn}
              disabled={visibleMinutes <= 30}
            >
              <Text style={styles.zoomBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        )}
        <TouchableOpacity style={[styles.modeBtn, styles.modeBtnOn]} onPress={toggleDisplayMode}>
          <Text style={styles.modeBtnTextOn}>
            {displayMode === 'calendar' ? 'List View' : 'Calendar View'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.dayHeaderRow}>
        {displayMode === 'calendar' && <View style={{ width: TIME_GUTTER }} />}
        {days.map((d, i) => {
          const isToday = isSameDay(d, new Date());
          return (
            <View key={i} style={styles.dayHeaderCell}>
              <Text style={[styles.dayName, isToday && styles.todayAccent]}>
                {d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}
              </Text>
              <View style={[styles.dayNumCircle, isToday && styles.todayCircle]}>
                <Text style={[styles.dayNumText, isToday && styles.todayNumText]}>
                  {d.getDate()}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {displayMode === 'calendar' ? (
        <ScrollView
          style={styles.grid}
          showsVerticalScrollIndicator={false}
          onLayout={e => setGridHeight(e.nativeEvent.layout.height)}
        >
          <View style={{ height: 24 * hourHeight, flexDirection: 'row' }}>
            <View style={{ width: TIME_GUTTER }}>
              {HOURS.map(h => (
                <View key={h} style={{ height: hourHeight, alignItems: 'flex-end', paddingRight: 6 }}>
                  {h > 0 && <Text style={styles.timeLabel}>{formatHour(h)}</Text>}
                </View>
              ))}
            </View>
            {days.map((day, di) => {
              const dateKey = toDateKey(day);
              const dayEntries = entries[dateKey] ?? [];
              return (
                <View key={di} style={[styles.dayColumn, di > 0 && styles.dayColumnBorder]}>
                  {HOURS.map(h => (
                    <View key={h} style={{ height: hourHeight, borderTopWidth: 1, borderTopColor: '#e8eaed' }} />
                  ))}
                  {dayEntries.map(entry => {
                    const d = new Date(entry.start_ms);
                    const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
                    const top = ((entry.start_ms - startOfDay) / 3600000) * hourHeight;
                    const height = (entry.elapsed_ms / 3600000) * hourHeight;
                    return (
                      <View
                        key={entry.id}
                        style={[styles.entryBlock, { top, height, backgroundColor: entry.category_color }]}
                      >
                        {height >= MIN_LABEL_HEIGHT && (
                          <Text style={styles.entryText} numberOfLines={1}>
                            {entry.category_name}
                          </Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {listEntries.length === 0 ? (
            <Text style={styles.emptyText}>No entries for this day</Text>
          ) : (
            listEntries.map(entry => (
              <View key={entry.id} style={[styles.listCard, { backgroundColor: entry.category_color }]}>
                <Text style={styles.listCardTitle}>{entry.category_name}</Text>
                <View style={styles.listCardRow}>
                  <Text style={styles.listCardTime}>
                    {formatTime(entry.start_ms)} → {formatTime(entry.end_ms)}
                  </Text>
                  <Text style={styles.listCardElapsed}>{formatElapsedHuman(entry.elapsed_ms)}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: Platform.OS === 'ios' ? 50 : 24,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  navBtn: {
    paddingVertical: 32,
    paddingHorizontal: 48,
  },
  navArrow: {
    fontSize: 48,
    color: '#1a6bcc',
    lineHeight: 52,
  },
  rangeLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#202124',
  },
  modeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  modeBtn: {
    paddingVertical: 5,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dadce0',
  },
  modeBtnOn: {
    backgroundColor: '#1a6bcc',
    borderColor: '#1a6bcc',
  },
  modeBtnText: {
    fontSize: 13,
    color: '#444',
  },
  modeBtnTextOn: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  zoomBtns: {
    flexDirection: 'row',
    gap: 4,
  },
  zoomBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#dadce0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomBtnDisabled: {
    opacity: 0.3,
  },
  zoomBtnText: {
    fontSize: 18,
    color: '#444',
    lineHeight: 22,
  },
  dayHeaderRow: {
    flexDirection: 'row',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  dayHeaderCell: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  dayName: {
    fontSize: 11,
    color: '#70757a',
    letterSpacing: 0.5,
  },
  todayAccent: {
    color: '#1a6bcc',
  },
  dayNumCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCircle: {
    backgroundColor: '#1a6bcc',
  },
  dayNumText: {
    fontSize: 14,
    color: '#202124',
    fontWeight: '500',
  },
  todayNumText: {
    color: '#fff',
    fontWeight: '700',
  },
  grid: {
    flex: 1,
  },
  timeLabel: {
    fontSize: 10,
    color: '#70757a',
    marginTop: -6,
  },
  dayColumn: {
    flex: 1,
  },
  dayColumnBorder: {
    borderLeftWidth: 1,
    borderLeftColor: '#e8eaed',
  },
  entryBlock: {
    position: 'absolute',
    left: 2,
    right: 2,
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  entryText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  listCard: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  listCardTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  listCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  listCardTime: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
  },
  listCardElapsed: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyText: {
    textAlign: 'center',
    color: '#aaa',
    fontSize: 15,
    marginTop: 48,
  },
});
