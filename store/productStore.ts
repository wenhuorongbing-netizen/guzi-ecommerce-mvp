import { create } from 'zustand'

export interface PendingItem {
  id: string; // generated via uuidv4
  name: string;
  price: number;
  qty: number; // Always 1 per instance based on the parser rules
}

export interface Hotspot {
  id: string; // generated via uuidv4
  x: number;
  y: number;
  name: string;
  price: number;
  stock: number;
}

interface ProductStore {
  imageUrl: string | null;

  // Text-to-Chips state
  pendingItems: PendingItem[];
  activePendingItemId: string | null;

  // Placed items on the image
  hotspots: Hotspot[];
  history: Hotspot[][]; // For Undo functionality
  activeHotspotId: string | null; // Currently editing on the image

  // Actions
  setImageUrl: (url: string) => void;
  setPendingItems: (items: PendingItem[]) => void;
  setActivePendingItem: (id: string | null) => void;
  removePendingItem: (id: string) => void;

  setHotspots: (hotspots: Hotspot[]) => void;
  addHotspot: (hotspot: Hotspot) => void;
  updateHotspot: (id: string, data: Partial<Hotspot>) => void;
  removeHotspot: (id: string) => void;
  setActiveHotspot: (id: string | null) => void;

  // Point-and-Click Integration action
  placePendingItemAsHotspot: (x: number, y: number) => void;
  undoHotspot: () => void;
  saveHistory: () => void;
}

export const useProductStore = create<ProductStore>((set, get) => ({
  imageUrl: null,

  pendingItems: [],
  activePendingItemId: null,

  hotspots: [],
  history: [],
  activeHotspotId: null,

  setImageUrl: (url) => set({ imageUrl: url, hotspots: [], history: [], pendingItems: [], activeHotspotId: null, activePendingItemId: null }),

  setPendingItems: (items) => set({ pendingItems: items }),

  setActivePendingItem: (id) => set({ activePendingItemId: id, activeHotspotId: null }), // Deactivate map editing when holding a chip

  removePendingItem: (id) => set((state) => ({
    pendingItems: state.pendingItems.filter((item) => item.id !== id),
    activePendingItemId: state.activePendingItemId === id ? null : state.activePendingItemId
  })),

  setHotspots: (hotspots) => set(state => {
    state.saveHistory();
    return { hotspots };
  }),

  addHotspot: (hotspot) => set((state) => {
    state.saveHistory();
    return {
      hotspots: [...state.hotspots, hotspot],
      activeHotspotId: hotspot.id // Select the newly created hotspot
    }
  }),

  updateHotspot: (id, data) => set((state) => {
    state.saveHistory();
    return {
      hotspots: state.hotspots.map((hs) => hs.id === id ? { ...hs, ...data } : hs)
    }
  }),

  removeHotspot: (id) => set((state) => {
    state.saveHistory();
    // Re-add to pending list if it was a chip
    const removedItem = state.hotspots.find(h => h.id === id);
    let newPending = [...state.pendingItems];
    if (removedItem) {
        newPending.push({
            id: removedItem.id,
            name: removedItem.name,
            price: removedItem.price,
            qty: removedItem.stock
        });
    }
    return {
      hotspots: state.hotspots.filter((hs) => hs.id !== id),
      activeHotspotId: state.activeHotspotId === id ? null : state.activeHotspotId,
      pendingItems: newPending
    }
  }),

  saveHistory: () => set(state => {
    const newHistory = [...state.history, [...state.hotspots]];
    // Keep max 20 states
    if (newHistory.length > 20) newHistory.shift();
    return { history: newHistory };
  }),

  undoHotspot: () => set(state => {
    if (state.history.length === 0) return state;
    const previousState = state.history[state.history.length - 1];

    // Find what was removed by this undo operation
    const removedHotspots = state.hotspots.filter(h => !previousState.find(ph => ph.id === h.id));

    let newPending = [...state.pendingItems];
    removedHotspots.forEach(removedItem => {
      // Try to find if a pending chip with the same name exists to increment its qty back
      const existingPending = newPending.find(p => p.name === removedItem.name && p.price === removedItem.price);
      if (existingPending) {
         existingPending.qty += 1;
      } else {
         newPending.push({
             id: crypto.randomUUID(),
             name: removedItem.name,
             price: removedItem.price,
             qty: 1
         });
      }
    });

    return {
      hotspots: previousState,
      history: state.history.slice(0, -1),
      pendingItems: newPending,
      activeHotspotId: null
    };
  }),

  setActiveHotspot: (id) => set({ activeHotspotId: id, activePendingItemId: null }), // Deactivate chip holding when editing map

  placePendingItemAsHotspot: (x, y) => {
    const { pendingItems, activePendingItemId, addHotspot, removePendingItem, setPendingItems } = get();

    if (!activePendingItemId) return;

    const chipIndex = pendingItems.findIndex(p => p.id === activePendingItemId);
    if (chipIndex === -1) return;
    const chip = pendingItems[chipIndex];

    const newHotspotId = crypto.randomUUID();

    // Convert to a placed hotspot. Note: placed hotspot gets stock=1
    addHotspot({
      id: newHotspotId,
      x,
      y,
      name: chip.name,
      price: chip.price,
      stock: 1
    });

    if (chip.qty > 1) {
       // Decrement quantity if more than 1
       const updatedItems = [...pendingItems];
       updatedItems[chipIndex] = { ...chip, qty: chip.qty - 1 };
       setPendingItems(updatedItems);
    } else {
       // Remove from the pending sidebar list entirely
       removePendingItem(chip.id);
    }
  }
}))