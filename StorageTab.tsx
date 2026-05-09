import { useRef, useState } from 'react';
import { Dimensions, PanResponder, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type ViewMode = '1day' | '3days' | '1week';

const HOUR_HEIGHT = 56;
const TIME_GUTTER = 52;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function formatHour(h: number): string {
  if (h === 0) return '';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
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

interface Props {
  onSwitchTab: () => void;
}

export default function StorageTab({ onSwitchTab }: Props) {
  const [mode, setMode] = useState<ViewMode>('1week');
  const [offset, setOffset] = useState(0);

  // Keep a ref so the PanResponder (created once) always calls the latest callback
  const onSwitchTabRef = useRef(onSwitchTab);
  onSwitchTabRef.current = onSwitchTab;

  const panResponder = useRef(
    PanResponder.create({
      // Only activate for predominantly horizontal swipes
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 15 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
      onPanResponderRelease: (_, gs) => {
        if (Math.abs(gs.dx) < 40) return;
        const startY = gs.y0;
        const screenH = Dimensions.get('window').height;
        if (startY < screenH * 0.75) {
          // Top 3/4: navigate calendar (swipe left = forward, right = back)
          if (gs.dx < 0) setOffset(o => o + 1);
          else setOffset(o => o - 1);
        } else {
          // Bottom 1/4: switch tabs
          onSwitchTabRef.current();
        }
      },
    })
  ).current;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

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

  const days = Array.from({ length: daysCount }, (_, i) => addDays(pageStart, i));

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      {/* Navigation row */}
      <View style={styles.navRow}>
        <TouchableOpacity style={styles.navBtn} onPress={() => setOffset(o => o - 1)}>
          <Text style={styles.navArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.rangeLabel}>{rangeLabel(days, mode)}</Text>
        <TouchableOpacity style={styles.navBtn} onPress={() => setOffset(o => o + 1)}>
          <Text style={styles.navArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* View mode buttons */}
      <View style={styles.modeRow}>
        {(['1day', '3days', '1week'] as ViewMode[]).map(m => (
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
      </View>

      {/* Day name + number headers */}
      <View style={styles.dayHeaderRow}>
        <View style={{ width: TIME_GUTTER }} />
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

      {/* Scrollable hour grid */}
      <ScrollView style={styles.grid} showsVerticalScrollIndicator={false}>
        {HOURS.map(h => (
          <View key={h} style={styles.hourRow}>
            <View style={styles.timeGutter}>
              {h > 0 && <Text style={styles.timeLabel}>{formatHour(h)}</Text>}
            </View>
            {days.map((_, di) => (
              <View
                key={di}
                style={[styles.cell, di > 0 && styles.cellBorderLeft]}
              />
            ))}
          </View>
        ))}
      </ScrollView>
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
  hourRow: {
    flexDirection: 'row',
    height: HOUR_HEIGHT,
  },
  timeGutter: {
    width: TIME_GUTTER,
    alignItems: 'flex-end',
    paddingRight: 6,
  },
  timeLabel: {
    fontSize: 10,
    color: '#70757a',
    marginTop: -6,
  },
  cell: {
    flex: 1,
    borderTopWidth: 1,
    borderTopColor: '#e8eaed',
  },
  cellBorderLeft: {
    borderLeftWidth: 1,
    borderLeftColor: '#e8eaed',
  },
});
