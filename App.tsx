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
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import StorageTab from './StorageTab';
import { getCategories, insertCategory, updateCategory, deactivateCategory, saveEntry } from './database';

const LEGACY_STORAGE_KEY = 'bed_categories';

const PALETTE = [
  '#e74c3c', '#e67e22', '#f39c12', '#2ecc71', '#1abc9c',
  '#3498db', '#9b59b6', '#e91e63', '#ff5722', '#00bcd4',
];

type Category = { id: number; name: string; color: string; description: string };
type Tab = 'tracking' | 'storage';

function getEasternTime(): string {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const centiseconds = Math.floor((ms % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('tracking');
  const [time, setTime] = useState(getEasternTime());
  const [elapsed, setElapsed] = useState(0);
  const [appState, setAppState] = useState<'base' | 'running' | 'paused'>('base');

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryIndex, setSelectedCategoryIndex] = useState<number>(0);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [inputName, setInputName] = useState('');
  const [inputDescription, setInputDescription] = useState('');

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);
  const runCategoryRef = useRef<Category | null>(null);

  const trackingPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 15 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
      onPanResponderRelease: (_, gs) => {
        if (Math.abs(gs.dx) < 40) return;
        const screenH = Dimensions.get('window').height;
        if (gs.y0 >= screenH * 0.75) {
          setActiveTab('storage');
        }
      },
    })
  ).current;

  useEffect(() => {
    const id = setInterval(() => setTime(getEasternTime()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    async function init() {
      // One-time migration from SecureStore
      const raw = await SecureStore.getItemAsync(LEGACY_STORAGE_KEY);
      if (raw) {
        const parsed: unknown[] = JSON.parse(raw);
        if (parsed.length > 0 && typeof parsed[0] !== 'string') {
          for (const c of parsed as Partial<{ name: string; color: string; description: string }>[]) {
            insertCategory(c.name ?? '', c.color ?? PALETTE[0], c.description ?? '');
          }
        }
        await SecureStore.deleteItemAsync(LEGACY_STORAGE_KEY);
      }

      const cats = getCategories();
      setCategories(cats);
      if (cats.length > 0) setSelectedCategoryIndex(cats.length - 1);
    }
    init();
  }, []);

  function openAdd() {
    setEditingIndex(null);
    setInputName('');
    setInputDescription('');
    setModalVisible(true);
  }

  function openEdit(index: number) {
    setEditingIndex(index);
    setInputName(categories[index].name);
    setInputDescription(categories[index].description);
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setInputName('');
    setInputDescription('');
    setEditingIndex(null);
  }

  function handleSave() {
    const name = inputName.trim();
    if (!name) return;

    let updated: Category[];
    if (editingIndex === null) {
      const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      const id = insertCategory(name, color, inputDescription.trim());
      updated = [...categories, { id, name, color, description: inputDescription.trim() }];
    } else {
      const cat = categories[editingIndex];
      updateCategory(cat.id, name, inputDescription.trim());
      updated = categories.map((c, i) =>
        i === editingIndex ? { ...c, name, description: inputDescription.trim() } : c
      );
    }

    setCategories(updated);
    if (editingIndex === null) setSelectedCategoryIndex(updated.length - 1);
    closeModal();
  }

  function handleDelete(index: number) {
    deactivateCategory(categories[index].id);
    const updated = categories.filter((_, i) => i !== index);
    setCategories(updated);
    if (updated.length === 0) {
      setSelectedCategoryIndex(0);
    } else if (selectedCategoryIndex >= updated.length) {
      setSelectedCategoryIndex(updated.length - 1);
    }
  }

  function handleStart() {
    const now = Date.now();
    startRef.current = now;
    runCategoryRef.current = categories[selectedCategoryIndex] ?? null;
    intervalRef.current = setInterval(() => {
      setElapsed(Date.now() - startRef.current);
    }, 10);
    setAppState('running');
  }

  function handlePause() {
    clearInterval(intervalRef.current!);
    intervalRef.current = null;
    pauseTimeRef.current = Date.now();
    setAppState('paused');
  }

  function handleNewActivity() {
    const cat = runCategoryRef.current;
    if (cat) {
      saveEntry({
        categoryId: cat.id,
        title: '',
        startMs: startRef.current,
        endMs: pauseTimeRef.current,
        elapsedMs: pauseTimeRef.current - startRef.current,
      });
    }
    const now = Date.now();
    startRef.current = now;
    runCategoryRef.current = categories[selectedCategoryIndex] ?? null;
    setElapsed(0);
    intervalRef.current = setInterval(() => {
      setElapsed(Date.now() - startRef.current);
    }, 10);
    setAppState('running');
  }

  return (
    <View style={styles.root}>
      <StatusBar style={activeTab === 'tracking' ? 'light' : 'dark'} />

      {activeTab === 'tracking' ? (
        <View
          style={[styles.storageContainer, { backgroundColor: categories[selectedCategoryIndex]?.color ?? '#1a6bcc' }]}
          {...trackingPan.panHandlers}
        >
          <Text style={styles.clock}>{time} ET</Text>

          <ScrollView
            style={styles.categoryScroll}
            contentContainerStyle={styles.categoryStack}
            showsVerticalScrollIndicator={false}
          >
            {[...categories]
              .map((cat, originalIndex) => ({ cat, originalIndex }))
              .reverse()
              .map(({ cat, originalIndex }) => (
                <TouchableOpacity
                  key={cat.id}
                  activeOpacity={0.85}
                  onPress={appState !== 'running' ? () => setSelectedCategoryIndex(originalIndex) : undefined}
                  style={[
                    styles.categoryBox,
                    { backgroundColor: cat.color },
                    selectedCategoryIndex === originalIndex && styles.categoryBoxSelected,
                  ]}
                >
                  <View style={styles.categoryInfo}>
                    <Text style={styles.categoryText} numberOfLines={1}>{cat.name}</Text>
                    {cat.description ? (
                      <Text style={styles.categoryDescription} numberOfLines={1}>{cat.description}</Text>
                    ) : null}
                  </View>
                  <View style={styles.categoryActions}>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => openEdit(originalIndex)}>
                      <Text style={styles.actionBtnText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() =>
                        Alert.alert('Delete category?', cat.name, [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Delete', style: 'destructive', onPress: () => handleDelete(originalIndex) },
                        ])
                      }
                    >
                      <Text style={styles.actionBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              ))}
          </ScrollView>

          <TouchableOpacity style={styles.addButton} onPress={openAdd}>
            <Text style={styles.addButtonText}>＋  add category</Text>
          </TouchableOpacity>

          <Text style={styles.stopwatch}>{formatElapsed(elapsed)}</Text>

          <View style={styles.buttons}>
            {appState === 'base' && (
              <TouchableOpacity style={[styles.btn, styles.btnStart]} onPress={handleStart}>
                <Text style={styles.btnText}>Start</Text>
              </TouchableOpacity>
            )}
            {appState === 'running' && (
              <TouchableOpacity style={[styles.btn, styles.btnPause]} onPress={handlePause}>
                <Text style={styles.btnText}>Pause</Text>
              </TouchableOpacity>
            )}
            {appState === 'paused' && (
              <TouchableOpacity style={[styles.btn, styles.btnReset]} onPress={handleNewActivity}>
                <Text style={styles.btnText}>New Activity</Text>
              </TouchableOpacity>
            )}
          </View>

          {categories[selectedCategoryIndex] && (
            <View style={styles.selectedBar}>
              <Text style={styles.selectedBarText}>
                {categories[selectedCategoryIndex].name}
              </Text>
            </View>
          )}

          <Modal visible={modalVisible} transparent animationType="fade">
            <KeyboardAvoidingView
              style={styles.modalOverlay}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>
                  {editingIndex === null ? 'New Category' : 'Edit Category'}
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Name (e.g. Deep Work)"
                  placeholderTextColor="#888"
                  value={inputName}
                  onChangeText={setInputName}
                  autoFocus
                />
                <TextInput
                  style={[styles.input, styles.inputMultiline]}
                  placeholder="Description (optional)"
                  placeholderTextColor="#888"
                  value={inputDescription}
                  onChangeText={setInputDescription}
                  maxLength={24}
                  multiline
                  numberOfLines={3}
                />
                <View style={styles.modalButtons}>
                  <TouchableOpacity style={styles.modalBtnCancel} onPress={closeModal}>
                    <Text style={styles.modalBtnCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.modalBtnSave} onPress={handleSave}>
                    <Text style={styles.modalBtnSaveText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        </View>
      ) : (
        <StorageTab onSwitchTab={() => setActiveTab('tracking')} />
      )}

      <View style={styles.tabBar}>
        {(['tracking', 'storage'] as Tab[]).map(tab => (
          <TouchableOpacity
            key={tab}
            style={styles.tab}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab}
            </Text>
            {activeTab === tab && <View style={styles.tabIndicator} />}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  storageContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    paddingVertical: 14,
    marginBottom: Platform.OS === 'android' ? 32 : 0,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  tabText: {
    fontSize: 17,
    color: '#888888',
  },
  tabTextActive: {
    color: '#1a6bcc',
    fontWeight: '700',
  },
  tabIndicator: {
    height: 3,
    width: 36,
    borderRadius: 2,
    backgroundColor: '#1a6bcc',
  },
  clock: {
    position: 'absolute',
    top: 60,
    left: 20,
    fontSize: 14,
    color: '#c0d8f5',
  },
  categoryScroll: {
    width: '80%',
    maxHeight: 260,
    marginBottom: 12,
  },
  categoryStack: {
    gap: 8,
  },
  categoryBox: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryBoxSelected: {
    borderWidth: 3,
    borderColor: '#ffffff',
  },
  selectedBar: {
    position: 'absolute',
    bottom: 24,
    left: 24,
    right: 24,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  selectedBarText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  categoryInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryText: {
    flexShrink: 1,
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  categoryDescription: {
    flexShrink: 1,
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    fontStyle: 'italic',
  },
  categoryActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  deleteBtn: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  actionBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  addButton: {
    backgroundColor: '#000000',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginBottom: 40,
    width: '80%',
    alignItems: 'center',
  },
  addButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  stopwatch: {
    fontSize: 56,
    fontWeight: 'bold',
    color: '#ffffff',
    fontVariant: ['tabular-nums'],
  },
  buttons: {
    flexDirection: 'row',
    marginTop: 48,
    gap: 16,
  },
  btn: {
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 32,
  },
  btnStart: {
    backgroundColor: '#ffffff',
  },
  btnPause: {
    backgroundColor: '#ff4d4d',
  },
  btnReset: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  btnText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a6bcc',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    backgroundColor: '#ffffff',
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
  inputMultiline: {
    height: 80,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalBtnCancel: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  modalBtnCancelText: {
    fontSize: 16,
    color: '#888',
  },
  modalBtnSave: {
    backgroundColor: '#1a6bcc',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  modalBtnSaveText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
});
