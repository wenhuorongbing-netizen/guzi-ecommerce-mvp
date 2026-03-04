"use client"
import React, { useRef, useEffect } from 'react';
import { useProductStore } from '../store/productStore';
import { v4 as uuidv4 } from 'uuid';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";

export const ImageTagger = () => {
  const {
    imageUrl,
    hotspots,
    activeHotspotId,
    activePendingItemId,
    addHotspot,
    setActiveHotspot,
    updateHotspot,
    removeHotspot,
    placePendingItemAsHotspot,
    undoHotspot
  } = useProductStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z') {
        undoHotspot();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoHotspot]);

  const imageRef = useRef<HTMLImageElement>(null);

  // Magnifier State
  const [showMagnifier, setShowMagnifier] = React.useState(false);
  const [magnifierPos, setMagnifierPos] = React.useState({ x: 0, y: 0 });
  const [bgPos, setBgPos] = React.useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!activePendingItemId || !imageRef.current) return;

    // Determine cursor position relative to the image
    const rect = imageRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Percentage for background position inside magnifier
    const bgX = (x / rect.width) * 100;
    const bgY = (y / rect.height) * 100;

    setMagnifierPos({ x: e.clientX, y: e.clientY });
    setBgPos({ x: bgX, y: bgY });
  };

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!imageRef.current) return;

    // Calculate percentage coordinates relative to the bounding box
    const rect = imageRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    // If a chip is active in the sidebar, place it.
    if (activePendingItemId) {
      placePendingItemAsHotspot(x, y);
    } else {
      // Otherwise, manual drop
      addHotspot({
        id: uuidv4(),
        x,
        y,
        name: '',
        price: 0,
        stock: 1
      });
    }
  };

  const handleInputClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className="relative inline-block border rounded bg-gray-50 p-2 shadow-sm min-h-[400px] w-full flex items-center justify-center overflow-hidden"
    >
      {!imageUrl ? (
        <div className="flex flex-col items-center justify-center h-full text-gray-400 p-10">
          <svg className="w-12 h-12 mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
          </svg>
          <span className="text-sm font-medium">Upload an image to start tagging</span>
        </div>
      ) : (
        <TransformWrapper
          initialScale={1}
          minScale={0.5}
          maxScale={4}
          centerOnInit
          disabled={!!activePendingItemId} // Disable panning when dropping a chip
        >
          {({ zoomIn, zoomOut, resetTransform, centerView }) => (
            <>
              <div className="absolute top-2 right-2 z-10 flex gap-2 bg-white/80 backdrop-blur rounded shadow px-2 py-1">
                <button onClick={() => zoomIn()} className="px-2 hover:bg-gray-100 rounded">+</button>
                <button onClick={() => zoomOut()} className="px-2 hover:bg-gray-100 rounded">-</button>
                <button onClick={() => centerView()} className="px-2 hover:bg-gray-100 rounded">Reset</button>
                <button onClick={() => undoHotspot()} title="Ctrl+Z" className="px-2 text-red-500 hover:bg-gray-100 rounded border-l border-gray-300 ml-1">Undo</button>
              </div>

              <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }}>
                <div className="relative inline-block max-w-full">
                  <img
                    ref={imageRef}
                    src={imageUrl}
                    alt="Merch Drop Layout"
                    onClick={handleImageClick}
                    onMouseMove={handleMouseMove}
                    onMouseEnter={() => activePendingItemId && setShowMagnifier(true)}
                    onMouseLeave={() => setShowMagnifier(false)}
                    className={`max-w-full rounded shadow ${activePendingItemId ? 'cursor-crosshair' : 'cursor-default'}`}
                    style={{ maxHeight: '75vh', width: 'auto' }}
                  />

                  {/* Magnifier Glass Overlay (only visible when dropping a chip) */}
                  {showMagnifier && activePendingItemId && imageUrl && (
                    <div
                      className="fixed z-50 pointer-events-none rounded-full border-2 border-blue-500 shadow-xl overflow-hidden bg-no-repeat"
                      style={{
                        width: '120px',
                        height: '120px',
                        left: `${magnifierPos.x - 60}px`,
                        top: `${magnifierPos.y - 60}px`,
                        backgroundImage: `url(${imageUrl})`,
                        backgroundPosition: `${bgPos.x}% ${bgPos.y}%`,
                        backgroundSize: `${imageRef.current ? imageRef.current.width * 2 : '200'}%`, // 2x zoom
                      }}
                    >
                      {/* Crosshair inside magnifier */}
                      <div className="absolute inset-0 m-auto w-4 h-4 text-blue-500 opacity-50 flex items-center justify-center">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14m-7-7h14" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                    </div>
                  )}

                  {/* Render Hotspots */}
                  {hotspots.map((hotspot) => {
                    const isActive = activeHotspotId === hotspot.id;

                    return (
                      <div
                        key={hotspot.id}
                        className={`absolute w-8 h-8 -ml-4 -mt-4 border-2 rounded-full cursor-move transition-transform shadow-md flex items-center justify-center text-xs font-bold ${
                          isActive ? 'bg-blue-500 border-white scale-110 z-20 text-white' : 'bg-black/50 backdrop-blur-md border-white/50 hover:scale-110 z-10 text-white'
                        }`}
                        style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%`, textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveHotspot(hotspot.id);
                        }}
                        title={hotspot.name}
                      >
                        {hotspot.stock > 0 ? hotspot.stock : '!'}

                        {/* Popover Form (if active) */}
                        {isActive && (
                          <div
                            className="absolute top-10 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-lg p-3 rounded-lg shadow-2xl border w-56 z-30 text-gray-800"
                            onClick={handleInputClick}
                          >
                            <div className="flex justify-between items-center mb-2 border-b pb-1">
                              <span className="text-xs font-semibold text-gray-700 truncate w-32">{hotspot.name || 'Edit Product'}</span>
                              <button
                                onClick={() => removeHotspot(hotspot.id)}
                                className="text-red-500 text-xs hover:text-red-700 hover:bg-red-50 px-1 rounded transition-colors font-bold"
                              >
                                Delete
                              </button>
                            </div>

                    <div className="space-y-2 mt-2">
                      <div>
                        <label className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1 block">Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Hinata Badge"
                          value={hotspot.name}
                          onChange={(e) => updateHotspot(hotspot.id, { name: e.target.value })}
                          className="w-full text-sm border rounded p-1.5 focus:ring-1 focus:ring-blue-400 focus:border-blue-400 outline-none transition-shadow"
                        />
                      </div>
                      <div className="flex gap-2">
                        <div className="w-1/2">
                          <label className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1 block">Price</label>
                          <input
                            type="number"
                            placeholder="$0.00"
                            value={hotspot.price}
                            onChange={(e) => updateHotspot(hotspot.id, { price: parseFloat(e.target.value) || 0 })}
                            className="w-full text-sm border rounded p-1.5 focus:ring-1 focus:ring-blue-400 focus:border-blue-400 outline-none transition-shadow"
                          />
                        </div>
                        <div className="w-1/2">
                          <label className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1 block">Stock</label>
                          <input
                            type="number"
                            min="1"
                            value={hotspot.stock}
                            onChange={(e) => updateHotspot(hotspot.id, { stock: parseInt(e.target.value, 10) || 1 })}
                            className="w-full text-sm border rounded p-1.5 focus:ring-1 focus:ring-blue-400 focus:border-blue-400 outline-none transition-shadow"
                          />
                        </div>
                      </div>
                      <button
                        className="w-full bg-blue-500 text-white text-xs py-1.5 mt-1 rounded hover:bg-blue-600 transition-colors shadow-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveHotspot(null);
                        }}
                      >
                        Done
                      </button>
                    </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </TransformComponent>
            </>
          )}
        </TransformWrapper>
      )}
    </div>
  );
};