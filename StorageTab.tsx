import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
import { getEntriesByDate, getEntriesByTrackingDate, getAllEntries, getCategories, saveEntry, updateEntry, deleteEntry, EntryRow, CategoryRow, TRACKING_CUTOFF_MS } from './database';

const totalMinutes = TRACKING_CUTOFF_MS / 60000;
const CUTOFF_DISPLAY = `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, '0')} AM`;

type ViewMode = '1day' | '3days' | '1week';
type DisplayMode = 'calendar' | 'list';

const DEFAULT_HOUR_HEIGHT = 56;
const TIME_GUTTER = 52;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MIN_LABEL_HEIGHT = 18;
const MIN_DESCRIPTION_HEIGHT = 30;

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

function findOverlappingIds(entries: EntryRow[]): Set<number> {
  const overlapping = new Set<number>();
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      if (a.start_ms < b.end_ms && b.start_ms < a.end_ms) {
        overlapping.add(a.id);
        overlapping.add(b.id);
      }
    }
  }
  return overlapping;
}

// Parses "2:34 PM" relative to the start of a given day (epoch ms).
// Returns null if the input is invalid.
function parseTimeInput(input: string, startOfDay: number): number | null {
  const match = input.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (h < 1 || h > 12 || m < 0 || m > 59) return null;
  if (period === 'AM') { if (h === 12) h = 0; }
  else { if (h !== 12) h += 12; }
  return startOfDay + h * 3600000 + m * 60000;
}

interface Props {
  onSwitchTab: () => void;
  onSwitchToAnalytics: () => void;
}

export default function StorageTab({ onSwitchTab, onSwitchToAnalytics }: Props) {
  const [mode, setMode] = useState<ViewMode>('1week');
  const [offset, setOffset] = useState(0);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('calendar');
  const [entries, setEntries] = useState<Record<string, EntryRow[]>>({});
  const [visibleMinutes, setVisibleMinutes] = useState(720);
  const [gridHeight, setGridHeight] = useState(0);

  const [categories, setCategories] = useState<CategoryRow[]>([]);

  const [editingEntry, setEditingEntry] = useState<EntryRow | null>(null);
  const [editStartInput, setEditStartInput] = useState('');
  const [editEndInput, setEditEndInput] = useState('');
  const [editDescriptionInput, setEditDescriptionInput] = useState('');
  const [editError, setEditError] = useState('');

  const [addModalVisible, setAddModalVisible] = useState(false);
  const [addCategoryId, setAddCategoryId] = useState<number | null>(null);
  const [addStartInput, setAddStartInput] = useState('');
  const [addEndInput, setAddEndInput] = useState('');
  const [addDescriptionInput, setAddDescriptionInput] = useState('');
  const [addError, setAddError] = useState('');

  const hourHeight = gridHeight > 0 ? (gridHeight * 60) / visibleMinutes : DEFAULT_HOUR_HEIGHT;

  useEffect(() => {
    setCategories(getCategories());
    console.log('[BED] All DB entries:', getAllEntries());
  }, []);

  const onSwitchTabRef = useRef(onSwitchTab);
  onSwitchTabRef.current = onSwitchTab;

  const onSwitchToAnalyticsRef = useRef(onSwitchToAnalytics);
  onSwitchToAnalyticsRef.current = onSwitchToAnalytics;

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
          if (gs.dx > 0) onSwitchTabRef.current();
          else onSwitchToAnalyticsRef.current();
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

  function refreshEntries() {
    const result: Record<string, EntryRow[]> = {};
    const fetchFn = displayMode === 'list' ? getEntriesByTrackingDate : getEntriesByDate;
    for (const day of days) {
      const key = toDateKey(day);
      result[key] = fetchFn(key);
    }
    setEntries(result);
  }

  useEffect(() => {
    const result: Record<string, EntryRow[]> = {};
    let hasOverlaps = false;
    const fetchFn = displayMode === 'list' ? getEntriesByTrackingDate : getEntriesByDate;
    for (const day of days) {
      const key = toDateKey(day);
      const dayEntries = fetchFn(key);
      result[key] = dayEntries;
      if (displayMode === 'list' && findOverlappingIds(dayEntries).size > 0) {
        hasOverlaps = true;
      }
    }
    setEntries(result);
    if (hasOverlaps && Platform.OS === 'android') {
      ToastAndroid.show('Some entries overlap on this day', ToastAndroid.SHORT);
    }
  }, [days, displayMode]);

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

  function openEditModal(entry: EntryRow) {
    setEditingEntry(entry);
    setEditStartInput(formatTime(entry.start_ms));
    setEditEndInput(formatTime(entry.end_ms));
    setEditDescriptionInput(entry.description);
    setEditError('');
  }

  function handleSaveEdit() {
    if (!editingEntry) return;
    const d = new Date(editingEntry.start_ms);
    const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const newStartMs = parseTimeInput(editStartInput, startOfDay);
    const newEndMs = parseTimeInput(editEndInput, startOfDay);
    if (newStartMs === null || newEndMs === null) {
      setEditError('Invalid format — use "2:34 PM"');
      return;
    }
    if (newEndMs <= newStartMs) {
      setEditError('End time must be after start time');
      return;
    }
    updateEntry(editingEntry.id, newStartMs, newEndMs, editDescriptionInput.trim());
    setEditingEntry(null);
    refreshEntries();
  }

  function openAddModal() {
    setAddCategoryId(categories.length > 0 ? categories[0].id : null);
    setAddStartInput('');
    setAddEndInput('');
    setAddDescriptionInput('');
    setAddError('');
    setAddModalVisible(true);
  }

  function handleAddEntry() {
    if (addCategoryId === null) {
      setAddError('Select a category');
      return;
    }
    const startOfDay = listDay.getTime();
    const newStartMs = parseTimeInput(addStartInput, startOfDay);
    const newEndMs = parseTimeInput(addEndInput, startOfDay);
    if (newStartMs === null || newEndMs === null) {
      setAddError('Invalid format — use "2:34 PM"');
      return;
    }
    if (newEndMs <= newStartMs) {
      setAddError('End time must be after start time');
      return;
    }
    const cat = categories.find(c => c.id === addCategoryId)!;
    saveEntry({ categoryId: cat.id, description: addDescriptionInput.trim(), startMs: newStartMs, endMs: newEndMs, elapsedMs: newEndMs - newStartMs });
    setAddModalVisible(false);
    refreshEntries();
  }

  function handleDeleteEntry() {
    if (!editingEntry) return;
    Alert.alert(
      'Delete entry?',
      `${editingEntry.category_name} · ${formatTime(editingEntry.start_ms)} – ${formatTime(editingEntry.end_ms)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteEntry(editingEntry.id);
            setEditingEntry(null);
            refreshEntries();
          },
        },
      ],
    );
  }

  const listDay = days[0];
  const listEntries = entries[toDateKey(listDay)] ?? [];
  const overlappingIds = findOverlappingIds(listEntries);

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <View style={styles.navRow}>
        <TouchableOpacity style={styles.navBtn} onPress={() => setOffset(o => o - 1)}>
          <Text style={styles.navArrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.navCenter}>
          <Text style={styles.rangeLabel}>{rangeLabel(days, displayMode === 'list' ? '1day' : mode)}</Text>
          {displayMode === 'calendar' ? (
            <Text style={styles.navSubLabel}>displaying calendar date</Text>
          ) : (
            <Text style={styles.navSubLabel}>displaying tracking date (ends at {CUTOFF_DISPLAY})</Text>
          )}
        </View>
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
                    const height = Math.min((entry.elapsed_ms / 3600000) * hourHeight, 24 * hourHeight - top);
                    return (
                      <View
                        key={entry.id}
                        style={[styles.entryBlock, { top, height, backgroundColor: entry.category_color }]}
                      >
                        {height >= MIN_LABEL_HEIGHT && (
                          <Text style={styles.entryText} numberOfLines={1} ellipsizeMode="tail">
                            {entry.category_name}
                          </Text>
                        )}
                        {height >= MIN_DESCRIPTION_HEIGHT && entry.description ? (
                          <Text style={styles.entryDescription} numberOfLines={1} ellipsizeMode="tail">
                            {entry.description}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>
        </ScrollView>
      ) : (
        <View style={styles.listContainer}>
          <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
            {listEntries.length === 0 ? (
              <Text style={styles.emptyText}>No entries for this day</Text>
            ) : (
              listEntries.map(entry => (
                <TouchableOpacity
                  key={entry.id}
                  activeOpacity={0.8}
                  onPress={() => openEditModal(entry)}
                  style={[styles.listCard, { backgroundColor: entry.category_color }]}
                >
                  {overlappingIds.has(entry.id) && (
                    <View style={styles.overlapBadge}>
                      <Text style={styles.overlapBadgeText}>!</Text>
                    </View>
                  )}
                  <View style={styles.listCardTitleRow}>
                    <Text style={styles.listCardTitle}>{entry.category_name}</Text>
                    {entry.description ? (
                      <Text style={styles.listCardDescription} numberOfLines={1} ellipsizeMode="tail">
                        {entry.description}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.listCardRow}>
                    <Text style={styles.listCardTime}>
                      {formatTime(entry.start_ms)} → {formatTime(entry.end_ms)}
                    </Text>
                    <Text style={styles.listCardElapsed}>{formatElapsedHuman(entry.elapsed_ms)}</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
          <TouchableOpacity style={styles.fab} onPress={openAddModal}>
            <Text style={styles.fabText}>＋</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={addModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Entry</Text>
            <Text style={styles.navSubLabel}>saving times according to calendar date</Text>

            <Text style={styles.modalLabel}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
              {categories.map(cat => (
                <TouchableOpacity
                  key={cat.id}
                  onPress={() => setAddCategoryId(cat.id)}
                  style={[
                    styles.categoryPill,
                    { backgroundColor: cat.color },
                    addCategoryId === cat.id && styles.categoryPillSelected,
                  ]}
                >
                  <Text style={styles.categoryPillText}>{cat.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.modalLabel}>Start Time</Text>
            <TextInput
              style={styles.modalInput}
              value={addStartInput}
              onChangeText={t => { setAddStartInput(t); setAddError(''); }}
              placeholder="e.g. 2:34 PM"
              autoCapitalize="characters"
            />

            <Text style={styles.modalLabel}>End Time</Text>
            <TextInput
              style={styles.modalInput}
              value={addEndInput}
              onChangeText={t => { setAddEndInput(t); setAddError(''); }}
              placeholder="e.g. 3:15 PM"
              autoCapitalize="characters"
            />

            <Text style={styles.modalLabel}>Description</Text>
            <TextInput
              style={styles.modalInput}
              value={addDescriptionInput}
              onChangeText={setAddDescriptionInput}
              placeholder="What did you work on? (optional)"
            />

            {addError ? <Text style={styles.editError}>{addError}</Text> : null}

            <View style={styles.modalBtnRow}>
              <View style={styles.modalBtnRight}>
                <TouchableOpacity style={styles.modalBtnCancel} onPress={() => setAddModalVisible(false)}>
                  <Text style={styles.modalBtnCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalBtnSave} onPress={handleAddEntry}>
                  <Text style={styles.modalBtnSaveText}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={editingEntry !== null} transparent animationType="fade">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <View style={[styles.categoryPill, { backgroundColor: editingEntry?.category_color }]}>
              <Text style={styles.categoryPillText}>{editingEntry?.category_name}</Text>
            </View>

            <Text style={styles.modalLabel}>Description</Text>
            <TextInput
              style={styles.modalInput}
              value={editDescriptionInput}
              onChangeText={setEditDescriptionInput}
              placeholder="What did you work on?"
            />

            <Text style={styles.modalLabel}>Start Time</Text>
            <TextInput
              style={styles.modalInput}
              value={editStartInput}
              onChangeText={t => { setEditStartInput(t); setEditError(''); }}
              placeholder="e.g. 2:34 PM"
              autoCapitalize="characters"
            />

            <Text style={styles.modalLabel}>End Time</Text>
            <TextInput
              style={styles.modalInput}
              value={editEndInput}
              onChangeText={t => { setEditEndInput(t); setEditError(''); }}
              placeholder="e.g. 3:15 PM"
              autoCapitalize="characters"
            />

            {editError ? <Text style={styles.editError}>{editError}</Text> : null}

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalBtnDelete} onPress={handleDeleteEntry}>
                <Text style={styles.modalBtnDeleteText}>Delete</Text>
              </TouchableOpacity>
              <View style={styles.modalBtnRight}>
                <TouchableOpacity style={styles.modalBtnCancel} onPress={() => setEditingEntry(null)}>
                  <Text style={styles.modalBtnCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalBtnSave} onPress={handleSaveEdit}>
                  <Text style={styles.modalBtnSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
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
  navCenter: {
    alignItems: 'center',
    gap: 2,
  },
  rangeLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#202124',
  },
  navSubLabel: {
    fontSize: 11,
    color: '#70757a',
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
  entryDescription: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 9,
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
  listCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  listCardTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 0,
  },
  listCardDescription: {
    flex: 1,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
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
  overlapBadge: {
    position: 'absolute',
    top: 8,
    right: 10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlapBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#e74c3c',
    lineHeight: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '82%',
    gap: 10,
  },
  categoryPill: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  categoryPillText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  modalLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#70757a',
    marginBottom: -4,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#202124',
  },
  editError: {
    fontSize: 12,
    color: '#e74c3c',
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  modalBtnDelete: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e74c3c',
  },
  modalBtnDeleteText: {
    color: '#e74c3c',
    fontSize: 14,
    fontWeight: '600',
  },
  modalBtnRight: {
    flexDirection: 'row',
    gap: 8,
  },
  modalBtnCancel: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  modalBtnCancelText: {
    color: '#70757a',
    fontSize: 14,
  },
  modalBtnSave: {
    backgroundColor: '#1a6bcc',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  modalBtnSaveText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  listContainer: {
    flex: 1,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1a6bcc',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabText: {
    color: '#fff',
    fontSize: 28,
    lineHeight: 32,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#202124',
    marginBottom: 4,
  },
  categoryScroll: {
    marginBottom: 4,
  },
  categoryPillSelected: {
    borderWidth: 2.5,
    borderColor: '#fff',
  },
});
