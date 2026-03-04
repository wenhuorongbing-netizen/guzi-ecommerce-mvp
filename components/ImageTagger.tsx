"use client"
import React, { useRef } from 'react';
import { useProductStore } from '../store/productStore';
import { v4 as uuidv4 } from 'uuid';

export const ImageTagger = () => {
  const {
    imageUrl,
    hotspots,
    activeHotspotId,
    addHotspot,
    setActiveHotspot,
    updateHotspot,
    removeHotspot
  } = useProductStore();

  const imageRef = useRef<HTMLImageElement>(null);

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!imageRef.current) return;

    // Calculate percentage coordinates relative to the bounding box
    const rect = imageRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    // Create a new hotspot draft
    addHotspot({
      id: uuidv4(),
      x,
      y,
      name: '',
      price: 0,
      stock: 1
    });
  };

  const handleInputClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div className="relative inline-block border rounded bg-gray-50 p-2 shadow-sm min-h-[400px] min-w-[300px]">
      {!imageUrl ? (
        <div className="flex items-center justify-center h-full text-gray-400">
          Upload an image to start tagging
        </div>
      ) : (
        <div className="relative inline-block">
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Merch Drop Layout"
            onClick={handleImageClick}
            className="max-w-full cursor-crosshair rounded shadow"
            // For MVP mock purposes, fixing max-width so hotspots are easy to see
            style={{ maxWidth: '800px' }}
          />

          {/* Render Hotspots */}
          {hotspots.map((hotspot) => {
            const isActive = activeHotspotId === hotspot.id;

            return (
              <div
                key={hotspot.id}
                className={`absolute w-6 h-6 -ml-3 -mt-3 border-2 rounded-full cursor-pointer transition-transform shadow-md flex items-center justify-center text-xs font-bold ${
                  isActive ? 'bg-blue-500 border-white scale-110 z-20 text-white' : 'bg-white border-red-500 hover:scale-110 z-10 text-red-500'
                }`}
                style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%` }}
                onClick={(e) => {
                  e.stopPropagation(); // Prevent creating a new hotspot underneath
                  setActiveHotspot(hotspot.id);
                }}
              >
                {/* Visual marker inside dot */}
                {hotspot.stock > 0 ? hotspot.stock : '!'}

                {/* Popover Form (if active) */}
                {isActive && (
                  <div
                    className="absolute top-8 left-1/2 -translate-x-1/2 bg-white p-3 rounded shadow-xl border w-48 z-30"
                    onClick={handleInputClick}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-semibold text-gray-700">Edit Product</span>
                      <button
                        onClick={() => removeHotspot(hotspot.id)}
                        className="text-red-500 text-xs hover:underline"
                      >
                        Delete
                      </button>
                    </div>

                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="Product Name"
                        value={hotspot.name}
                        onChange={(e) => updateHotspot(hotspot.id, { name: e.target.value })}
                        className="w-full text-sm border rounded p-1"
                      />
                      <div className="flex gap-2">
                        <input
                          type="number"
                          placeholder="Price"
                          value={hotspot.price}
                          onChange={(e) => updateHotspot(hotspot.id, { price: parseFloat(e.target.value) || 0 })}
                          className="w-1/2 text-sm border rounded p-1"
                        />
                        <input
                          type="number"
                          placeholder="Stock"
                          value={hotspot.stock}
                          onChange={(e) => updateHotspot(hotspot.id, { stock: parseInt(e.target.value, 10) || 0 })}
                          className="w-1/2 text-sm border rounded p-1"
                        />
                      </div>
                      <button
                        className="w-full bg-blue-500 text-white text-xs py-1 rounded hover:bg-blue-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveHotspot(null);
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};