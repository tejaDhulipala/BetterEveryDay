import { useEffect, useRef, useState } from 'react';
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
  TouchableOpacity,
  View,
} from 'react-native';
import { Audio } from 'expo-av';
import {
  getHabits,
  getHabitsActiveOnDate,
  insertHabit,
  updateHabitName,
  deactivateHabit,
  getHabitEntriesByTrackingDate,
  upsertHabitEntry,
  upsertHabitExcused,
  HabitRow,
  TRACKING_CUTOFF_MS,
} from './database';

interface Props {
  onSwitchTab: () => void;
}

function getTodayTrackingKey(): string {
  const now = Date.now();
  const d = new Date(now);
  const msFromMidnight = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) * 1000;
  const trackingMs = msFromMidnight < TRACKING_CUTOFF_MS ? now - 86400000 : now;
  const td = new Date(trackingMs);
  return `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, '0')}-${String(td.getDate()).padStart(2, '0')}`;
}

function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

async function playKaching() {
  try {
    const { sound } = await Audio.Sound.createAsync(require('./assets/kaching.wav'));
    await sound.playAsync();
    sound.setOnPlaybackStatusUpdate(status => {
      if (status.isLoaded && status.didJustFinish) sound.unloadAsync();
    });
  } catch (_) {}
}

export default function HabitsTab({ onSwitchTab }: Props) {
  const [viewedDateKey, setViewedDateKey] = useState(getTodayTrackingKey);
  const [habits, setHabits] = useState<HabitRow[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());
  const [excusedIds, setExcusedIds] = useState<Set<number>>(new Set());
  const [modalVisible, setModalVisible] = useState(false);
  const [editingHabit, setEditingHabit] = useState<HabitRow | null>(null);
  const [inputName, setInputName] = useState('');

  const isToday = viewedDateKey === getTodayTrackingKey();

  const onSwitchTabRef = useRef(onSwitchTab);
  onSwitchTabRef.current = onSwitchTab;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 15 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
      onPanResponderRelease: (_, gs) => {
        if (Math.abs(gs.dx) < 40) return;
        const screenH = Dimensions.get('window').height;
        if (gs.y0 >= screenH * 0.75 && gs.dx > 0) {
          onSwitchTabRef.current();
        }
      },
    })
  ).current;

  useEffect(() => {
    const loadedHabits = isToday ? getHabits() : getHabitsActiveOnDate(viewedDateKey);
    setHabits(loadedHabits);

    const entries = getHabitEntriesByTrackingDate(viewedDateKey);
    setCompletedIds(new Set(entries.filter(e => e.completed === 1).map(e => e.habit_id)));
    setExcusedIds(new Set(entries.filter(e => e.excused === 1).map(e => e.habit_id)));
  }, [viewedDateKey]);

  function goBack() {
    setViewedDateKey(prev => shiftDateKey(prev, -1));
  }

  function goForward() {
    if (!isToday) setViewedDateKey(prev => shiftDateKey(prev, 1));
  }

  function toggleCompleted(habit: HabitRow) {
    const nowDone = !completedIds.has(habit.id);
    upsertHabitEntry(habit.id, viewedDateKey, viewedDateKey, nowDone);
    setCompletedIds(prev => {
      const next = new Set(prev);
      if (nowDone) next.add(habit.id); else next.delete(habit.id);
      return next;
    });
    if (nowDone) {
      setExcusedIds(prev => { const next = new Set(prev); next.delete(habit.id); return next; });
      playKaching();
    }
  }

  function handleExcuse(habit: HabitRow) {
    const nowExcused = !excusedIds.has(habit.id);
    if (nowExcused) {
      Alert.alert('Excuse habit?', `Are you sure you want to excuse "${habit.name}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Excuse',
          onPress: () => {
            upsertHabitExcused(habit.id, viewedDateKey, viewedDateKey, true);
            setExcusedIds(prev => { const next = new Set(prev); next.add(habit.id); return next; });
            setCompletedIds(prev => { const next = new Set(prev); next.delete(habit.id); return next; });
          },
        },
      ]);
    } else {
      upsertHabitExcused(habit.id, viewedDateKey, viewedDateKey, false);
      setExcusedIds(prev => { const next = new Set(prev); next.delete(habit.id); return next; });
    }
  }

  function openAdd() {
    setEditingHabit(null);
    setInputName('');
    setModalVisible(true);
  }

  function openEdit(habit: HabitRow) {
    setEditingHabit(habit);
    setInputName(habit.name);
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setInputName('');
    setEditingHabit(null);
  }

  function handleSave() {
    const name = inputName.trim();
    if (!name) return;
    if (editingHabit) {
      updateHabitName(editingHabit.id, name);
      setHabits(prev => prev.map(h => h.id === editingHabit.id ? { ...h, name } : h));
    } else {
      const tdKey = getTodayTrackingKey();
      const id = insertHabit(name, tdKey);
      setHabits(prev => [...prev, { id, name, is_active: 1, created_tracking_date: tdKey, deactivated_tracking_date: null }]);
    }
    closeModal();
  }

  function handleDelete(habit: HabitRow) {
    Alert.alert('Delete habit?', habit.name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deactivateHabit(habit.id, getTodayTrackingKey());
          setHabits(prev => prev.filter(h => h.id !== habit.id));
        },
      },
    ]);
  }

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.navBtn} onPress={goBack}>
          <Text style={styles.navBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.trackingDate}>{formatDateKey(viewedDateKey)}</Text>
        <TouchableOpacity
          style={[styles.navBtn, isToday && styles.navBtnDisabled]}
          onPress={goForward}
          disabled={isToday}
        >
          <Text style={[styles.navBtnText, isToday && styles.navBtnTextDisabled]}>›</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {habits.length === 0 ? (
          <Text style={styles.emptyText}>
            {isToday ? 'No habits yet. Tap + to add one.' : 'No habits existed on this day.'}
          </Text>
        ) : (
          habits.map(habit => {
            const done = completedIds.has(habit.id);
            const excused = excusedIds.has(habit.id);
            return (
              <View
                key={habit.id}
                style={[
                  styles.habitRow,
                  done && styles.habitRowDone,
                  excused && styles.habitRowExcused,
                ]}
              >
                {isToday && (
                  <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(habit)}>
                    <Text style={styles.editBtnText}>Edit</Text>
                  </TouchableOpacity>
                )}
                <Text style={[
                  styles.habitName,
                  done && styles.habitNameDone,
                  excused && styles.habitNameExcused,
                ]}>
                  {habit.name}
                </Text>
                <TouchableOpacity
                  style={[styles.checkbox, excused && styles.checkboxExcused]}
                  onPress={() => handleExcuse(habit)}
                >
                  <Text style={[styles.checkboxLabel, excused && styles.checkboxLabelActive]}>E</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.checkbox, done && styles.checkboxDone]}
                  onPress={() => toggleCompleted(habit)}
                >
                  {done && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
                {isToday && (
                  <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(habit)}>
                    <Text style={styles.deleteBtnText}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      {isToday && (
        <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
          <Text style={styles.addBtnText}>＋</Text>
        </TouchableOpacity>
      )}

      <Modal visible={modalVisible} transparent animationType="fade">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeModal}>
            <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
              <Text style={styles.modalTitle}>{editingHabit ? 'Edit Habit' : 'New Habit'}</Text>
              <TextInput
                style={styles.input}
                placeholder="Habit name"
                placeholderTextColor="#888"
                value={inputName}
                onChangeText={setInputName}
                autoFocus
                onSubmitEditing={handleSave}
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                  <Text style={styles.saveBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 40,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  navBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
  },
  navBtnDisabled: {
    backgroundColor: '#f8f8f8',
  },
  navBtnText: {
    fontSize: 28,
    color: '#202124',
    lineHeight: 32,
  },
  navBtnTextDisabled: {
    color: '#ccc',
  },
  trackingDate: {
    fontSize: 20,
    fontWeight: '700',
    color: '#202124',
    textAlign: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
    gap: 10,
  },
  emptyText: {
    color: '#aaa',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 40,
  },
  habitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 10,
  },
  habitRowDone: {
    backgroundColor: '#d4edda',
  },
  habitRowExcused: {
    backgroundColor: '#f5efe0',
  },
  editBtn: {
    backgroundColor: '#e8f0fe',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  editBtnText: {
    color: '#1a6bcc',
    fontSize: 13,
    fontWeight: '600',
  },
  habitName: {
    flex: 1,
    fontSize: 16,
    color: '#202124',
  },
  habitNameDone: {
    color: '#155724',
  },
  habitNameExcused: {
    color: '#7a6040',
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#aaa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: {
    backgroundColor: '#28a745',
    borderColor: '#28a745',
  },
  checkboxExcused: {
    backgroundColor: '#c8a96e',
    borderColor: '#c8a96e',
  },
  checkboxLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#aaa',
  },
  checkboxLabelActive: {
    color: '#fff',
  },
  checkmark: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 18,
  },
  deleteBtn: {
    backgroundColor: '#fce8e6',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  deleteBtnText: {
    color: '#d93025',
    fontSize: 13,
    fontWeight: '600',
  },
  addBtn: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#1a6bcc',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  addBtnText: {
    color: '#fff',
    fontSize: 26,
    lineHeight: 30,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '80%',
    gap: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#111',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  cancelBtnText: {
    fontSize: 16,
    color: '#888',
  },
  saveBtn: {
    backgroundColor: '#1a6bcc',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
