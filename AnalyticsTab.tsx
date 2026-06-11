import { useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';
import { getEntriesForTrackingDateRange } from './database';

interface Props {
  onSwitchTab: () => void;
}

const SVG_SIZE = 280;
const CX = SVG_SIZE / 2;
const CY = SVG_SIZE / 2;
const R = 110;
const LABEL_R = R * 0.62;
const MIN_LABEL_ANGLE = 22;

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatDuration(ms: number): string {
  const totalMins = Math.round(ms / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function addMonths(d: Date, n: number): Date {
  const result = new Date(d);
  result.setMonth(result.getMonth() + n);
  return result;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfWeek(d: Date): Date {
  const result = new Date(d);
  result.setHours(0, 0, 0, 0);
  const dow = result.getDay();
  result.setDate(result.getDate() - (dow === 0 ? 6 : dow - 1));
  return result;
}

function polarXY(angleDeg: number, r: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function slicePath(startAngle: number, endAngle: number): string {
  const s = polarXY(startAngle, R);
  const e = polarXY(endAngle, R);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${CX} ${CY} L ${s.x} ${s.y} A ${R} ${R} 0 ${large} 1 ${e.x} ${e.y} Z`;
}

export default function AnalyticsTab({ onSwitchTab }: Props) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [singleDay, setSingleDay] = useState(false);
  const [startDate, setStartDate] = useState(() => startOfWeek(today));
  const [endDate, setEndDate] = useState(() => {
    const d = startOfWeek(today);
    d.setDate(d.getDate() + 6);
    return d;
  });
  const [pickerTarget, setPickerTarget] = useState<'start' | 'end' | null>(null);
  const [pickerMonth, setPickerMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );

  const onSwitchTabRef = useRef(onSwitchTab);
  onSwitchTabRef.current = onSwitchTab;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 15 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
      onPanResponderRelease: (_, gs) => {
        if (Math.abs(gs.dx) < 40) return;
        const screenH = Dimensions.get('window').height;
        if (gs.y0 >= screenH * 0.75) {
          onSwitchTabRef.current();
        }
      },
    })
  ).current;

  const pieData = useMemo(() => {
    const end = singleDay ? startDate : endDate;
    const entries = getEntriesForTrackingDateRange(toDateKey(startDate), toDateKey(end));

    const map = new Map<number, { name: string; color: string; ms: number }>();
    for (const e of entries) {
      const existing = map.get(e.category_id);
      if (existing) {
        existing.ms += e.elapsed_ms;
      } else {
        map.set(e.category_id, {
          name: e.category_name,
          color: e.category_color,
          ms: e.elapsed_ms,
        });
      }
    }

    const totals = Array.from(map.entries()).map(([id, v]) => ({ id, ...v }));
    const totalMs = totals.reduce((s, t) => s + t.ms, 0);
    if (totalMs === 0) return { slices: [], totalMs: 0 };

    let angle = 0;
    const slices = totals.map(t => {
      const sweep = (t.ms / totalMs) * 360;
      const slice = { ...t, pct: (t.ms / totalMs) * 100, startAngle: angle, endAngle: angle + sweep };
      angle += sweep;
      return slice;
    });

    return { slices, totalMs };
  }, [startDate, endDate, singleDay]);

  function openPicker(target: 'start' | 'end') {
    const ref = target === 'start' ? startDate : endDate;
    setPickerMonth(new Date(ref.getFullYear(), ref.getMonth(), 1));
    setPickerTarget(target);
  }

  function handleSelectDay(day: Date) {
    if (pickerTarget === 'start') {
      setStartDate(day);
      if (!singleDay && day > endDate) setEndDate(new Date(day));
    } else {
      setEndDate(day);
      if (day < startDate) setStartDate(new Date(day));
    }
    setPickerTarget(null);
  }

  // Calendar grid
  const firstDow = new Date(pickerMonth.getFullYear(), pickerMonth.getMonth(), 1).getDay();
  const daysInMonth = new Date(pickerMonth.getFullYear(), pickerMonth.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push(new Date(pickerMonth.getFullYear(), pickerMonth.getMonth(), i));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const selectedForPicker = pickerTarget === 'start' ? startDate : endDate;
  const { slices, totalMs } = pieData;

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <View style={styles.controlRow}>
        <Text style={styles.labelText}>single day</Text>
        <TouchableOpacity style={styles.checkbox} onPress={() => setSingleDay(v => !v)}>
          {singleDay && <View style={styles.checkmark} />}
        </TouchableOpacity>
        <TouchableOpacity style={styles.dateBox} onPress={() => openPicker('start')}>
          <Text style={styles.dateBoxText}>{formatDate(startDate)}</Text>
        </TouchableOpacity>
        {!singleDay && (
          <>
            <Text style={styles.toText}>to</Text>
            <TouchableOpacity style={styles.dateBox} onPress={() => openPicker('end')}>
              <Text style={styles.dateBoxText}>{formatDate(endDate)}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {totalMs === 0 ? (
        <Text style={styles.emptyText}>No entries for this period</Text>
      ) : (
        <View style={styles.chartContainer}>
          <Text style={styles.totalLabel}>{formatDuration(totalMs)} total</Text>
          <Svg width={SVG_SIZE} height={SVG_SIZE}>
            {slices.length === 1 ? (
              <Circle cx={CX} cy={CY} r={R} fill={slices[0].color} />
            ) : (
              slices.map(slice => (
                <Path
                  key={slice.id}
                  d={slicePath(slice.startAngle, slice.endAngle)}
                  fill={slice.color}
                />
              ))
            )}
            {slices.map(slice => {
              const span = slice.endAngle - slice.startAngle;
              if (span < MIN_LABEL_ANGLE) return null;
              const mid = (slice.startAngle + slice.endAngle) / 2;
              const pos = polarXY(mid, LABEL_R);
              return (
                <G key={`label-${slice.id}`}>
                  <SvgText
                    x={pos.x}
                    y={pos.y - 7}
                    textAnchor="middle"
                    fill="white"
                    fontSize={12}
                    fontWeight="bold"
                  >
                    {`${Math.round(slice.pct)}%`}
                  </SvgText>
                  <SvgText
                    x={pos.x}
                    y={pos.y + 7}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.85)"
                    fontSize={10}
                  >
                    {formatDuration(slice.ms)}
                  </SvgText>
                </G>
              );
            })}
          </Svg>
          <View style={styles.legend}>
            {slices.map(slice => (
              <View key={slice.id} style={styles.legendRow}>
                <View style={[styles.legendSwatch, { backgroundColor: slice.color }]} />
                <Text style={styles.legendName}>{slice.name}</Text>
                <Text style={styles.legendDuration}>{`${Math.round(slice.pct)}% · ${formatDuration(slice.ms)}`}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <Modal visible={pickerTarget !== null} transparent animationType="fade">
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setPickerTarget(null)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.pickerCard} onPress={() => {}}>
            <View style={styles.pickerHeader}>
              <TouchableOpacity
                style={styles.pickerNavBtn}
                onPress={() => setPickerMonth(m => addMonths(m, -1))}
              >
                <Text style={styles.pickerNavText}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.pickerMonthLabel}>
                {pickerMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </Text>
              <TouchableOpacity
                style={styles.pickerNavBtn}
                onPress={() => setPickerMonth(m => addMonths(m, 1))}
              >
                <Text style={styles.pickerNavText}>›</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.pickerDowRow}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                <Text key={i} style={styles.pickerDowText}>{d}</Text>
              ))}
            </View>

            {weeks.map((week, wi) => (
              <View key={wi} style={styles.pickerWeekRow}>
                {week.map((day, di) => {
                  const selected = day != null && isSameDay(day, selectedForPicker);
                  return (
                    <TouchableOpacity
                      key={di}
                      style={[styles.pickerDay, selected && styles.pickerDaySelected]}
                      onPress={day ? () => handleSelectDay(day) : undefined}
                      disabled={!day}
                    >
                      <Text style={[styles.pickerDayText, selected && styles.pickerDayTextSelected]}>
                        {day ? day.getDate() : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: Platform.OS === 'ios' ? 50 : 24,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 40,
    gap: 8,
    flexWrap: 'wrap',
  },
  labelText: {
    fontSize: 14,
    color: '#202124',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: '#1a6bcc',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    width: 11,
    height: 11,
    backgroundColor: '#1a6bcc',
    borderRadius: 2,
  },
  dateBox: {
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  dateBoxText: {
    fontSize: 14,
    color: '#202124',
  },
  toText: {
    fontSize: 14,
    color: '#70757a',
  },
  chartContainer: {
    alignItems: 'center',
    marginTop: 16,
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#202124',
    marginBottom: 8,
  },
  legend: {
    marginTop: 16,
    width: SVG_SIZE,
    gap: 8,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  legendSwatch: {
    width: 14,
    height: 14,
    borderRadius: 3,
  },
  legendName: {
    flex: 1,
    fontSize: 14,
    color: '#202124',
  },
  legendDuration: {
    fontSize: 14,
    color: '#70757a',
  },
  emptyText: {
    textAlign: 'center',
    color: '#aaa',
    fontSize: 15,
    marginTop: 60,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    width: 300,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  pickerNavBtn: {
    padding: 8,
  },
  pickerNavText: {
    fontSize: 28,
    color: '#1a6bcc',
    lineHeight: 30,
  },
  pickerMonthLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#202124',
  },
  pickerDowRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  pickerDowText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    color: '#70757a',
    fontWeight: '600',
  },
  pickerWeekRow: {
    flexDirection: 'row',
  },
  pickerDay: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 100,
  },
  pickerDaySelected: {
    backgroundColor: '#1a6bcc',
  },
  pickerDayText: {
    fontSize: 14,
    color: '#202124',
  },
  pickerDayTextSelected: {
    color: '#fff',
    fontWeight: '700',
  },
});
