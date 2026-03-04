import { create } from 'zustand'

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
  hotspots: Hotspot[];
  activeHotspotId: string | null;

  setImageUrl: (url: string) => void;
  setHotspots: (hotspots: Hotspot[]) => void;
  addHotspot: (hotspot: Hotspot) => void;
  updateHotspot: (id: string, data: Partial<Hotspot>) => void;
  removeHotspot: (id: string) => void;
  setActiveHotspot: (id: string | null) => void;
}

export const useProductStore = create<ProductStore>((set) => ({
  imageUrl: null,
  hotspots: [],
  activeHotspotId: null,

  setImageUrl: (url) => set({ imageUrl: url, hotspots: [], activeHotspotId: null }),

  setHotspots: (hotspots) => set({ hotspots }),

  addHotspot: (hotspot) => set((state) => ({
    hotspots: [...state.hotspots, hotspot],
    activeHotspotId: hotspot.id // Select the newly created hotspot
  })),

  updateHotspot: (id, data) => set((state) => ({
    hotspots: state.hotspots.map((hs) => hs.id === id ? { ...hs, ...data } : hs)
  })),

  removeHotspot: (id) => set((state) => ({
    hotspots: state.hotspots.filter((hs) => hs.id !== id),
    activeHotspotId: state.activeHotspotId === id ? null : state.activeHotspotId
  })),

  setActiveHotspot: (id) => set({ activeHotspotId: id })
}))