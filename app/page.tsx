"use client";

import { useState } from "react";
import { ImageTagger } from "../components/ImageTagger";
import { useProductStore } from "../store/productStore";

export default function Home() {
  const {
    imageUrl,
    setImageUrl,
    hotspots,
    setPendingItems,
    pendingItems,
    activePendingItemId,
    setActivePendingItem
  } = useProductStore();

  const [eventId, setEventId] = useState("draft-event-uuid-1234");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Text-to-Chips State
  const [referenceText, setReferenceText] = useState("");
  const [isParsing, setIsParsing] = useState(false);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setImageUrl(url);
    }
  };

  const handleParseText = async () => {
    if (!referenceText.trim()) {
      alert("Please paste your receipt/order text first.");
      return;
    }

    setIsParsing(true);
    try {
      const res = await fetch("http://localhost:8000/api/parser/extract-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference_text: referenceText }),
      });

      const data = await res.json();

      if (res.ok && data.status === "success") {
        const { v4: uuidv4 } = await import('uuid');
        // Convert to internal PendingItem format
        const items = data.items.map((item: any) => ({
          id: uuidv4(),
          name: item.name,
          price: item.price,
          qty: item.qty
        }));
        setPendingItems(items);
        alert(`Successfully extracted ${items.length} items to pending chips.`);
      } else {
        alert(`Failed to parse text: ${data.detail || "Unknown error"}`);
      }
    } catch (err) {
      console.error(err);
      alert("Network error. Could not connect to AI Parser service.");
    } finally {
      setIsParsing(false);
    }
  };

  const handleBatchSubmit = async () => {
    if (hotspots.length === 0) return;
    setIsSubmitting(true);
    try {
      const payload = {
        event_id: eventId,
        image_url: imageUrl || "",
        hotspots: hotspots.map(h => ({
          id: h.id,
          x: h.x,
          y: h.y,
          name: h.name,
          price: h.price,
          stock: h.stock
        }))
      };

      const res = await fetch("http://localhost:8000/api/products/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (res.ok) {
        alert("Products created successfully!");
        console.log("Success:", data);
      } else {
        alert(`Error: ${data.detail || "Unknown error"}`);
      }
    } catch (err) {
      alert("Network error, could not reach API.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-gray-800 font-sans">
      <div className="max-w-[1400px] mx-auto space-y-6">
        <header className="border-b border-gray-200 pb-4 flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 mb-1">Guzi Drop Admin</h1>
            <p className="text-gray-500 font-medium">Text-to-Chips & Point-and-Click Mapping UI</p>
          </div>
          <div className="flex gap-4">
            {/* Sprint 6: Generate Announcement */}
            <button
              onClick={async () => {
                try {
                  const res = await fetch(`http://localhost:8000/api/admin/events/${eventId}/notif-template`);
                  const data = await res.json();
                  if (res.ok) {
                    navigator.clipboard.writeText(data.template);
                    alert("Notification text copied to clipboard!");
                  } else {
                    alert("Failed to generate template.");
                  }
                } catch (e) {
                  alert("Network error.");
                }
              }}
              className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-bold py-2 px-4 rounded-md shadow-sm transition-all flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
              Announce
            </button>

            {/* Sprint 5: Export CSV Button */}
            <button
              onClick={() => window.open(`http://localhost:8000/api/admin/events/${eventId}/export`, '_blank')}
              className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold py-2 px-4 rounded-md shadow-sm transition-all flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
              Export CSV
            </button>

            <button
              onClick={handleBatchSubmit}
              disabled={isSubmitting || hotspots.length === 0}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold py-2 px-6 rounded-md shadow-sm transition-all focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
            >
              {isSubmitting ? "Publishing..." : `Publish ${hotspots.length} Items`}
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[calc(100vh-160px)]">
          {/* Left panel: Reference Text & Pending Chips Sidebar */}
          <div className="col-span-1 flex flex-col gap-4 overflow-y-auto pr-2 pb-10 custom-scrollbar">

            <div className="bg-white p-5 shadow-sm rounded-xl border border-gray-100 flex-shrink-0">
              <h2 className="font-bold text-sm text-gray-700 uppercase tracking-wider mb-3">1. Background Image</h2>
              <div className="relative">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="block w-full text-sm text-gray-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-full file:border-0
                    file:text-sm file:font-semibold
                    file:bg-blue-50 file:text-blue-700
                    hover:file:bg-blue-100 cursor-pointer"
                />
              </div>
            </div>

            <div className="bg-white p-5 shadow-sm rounded-xl border border-gray-100 flex-shrink-0 flex flex-col">
              <h2 className="font-bold text-sm text-gray-700 uppercase tracking-wider mb-2">2. Text Parser</h2>
              <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                Paste your messy receipt here. We will extract it into placeable chips.
              </p>
              <textarea
                value={referenceText}
                onChange={(e) => setReferenceText(e.target.value)}
                placeholder={"Taobao receipt text here...\ne.g.\nMa Lin Badge x2 50.0\nKageyama Stand x1 120.0"}
                className="w-full text-sm border-gray-300 rounded-lg p-3 h-32 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none mb-3 shadow-inner bg-gray-50"
              />
              <button
                onClick={handleParseText}
                disabled={isParsing || !referenceText}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold py-2.5 rounded-lg transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                {isParsing ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Extracting...
                  </span>
                ) : (
                  "Extract Chips"
                )}
              </button>
            </div>

            {/* Pending Chips List */}
            <div className="bg-white p-5 shadow-sm rounded-xl border border-gray-100 flex-grow flex flex-col min-h-[300px]">
              <div className="flex justify-between items-center mb-4">
                 <h2 className="font-bold text-sm text-gray-700 uppercase tracking-wider">3. Pending Chips</h2>
                 <span className="bg-gray-100 text-gray-600 text-xs py-1 px-2 rounded-full font-bold">{pendingItems.length}</span>
              </div>

              <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                Click a chip to pick it up, then click on the image to place it.
              </p>

              <div className="space-y-2 overflow-y-auto flex-grow custom-scrollbar pr-1">
                {pendingItems.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-200 rounded-lg p-6 text-center">
                    <p className="text-sm">No pending chips.<br/>Extract text to generate them.</p>
                  </div>
                ) : (
                  pendingItems.map(item => (
                    <div
                      key={item.id}
                      onClick={() => setActivePendingItem(item.id)}
                      className={`
                        p-3 rounded-lg border cursor-pointer transition-all duration-200
                        ${activePendingItemId === item.id
                          ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200 shadow-md transform scale-[1.02]'
                          : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50 shadow-sm'
                        }
                      `}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-semibold text-sm text-gray-800 line-clamp-1 flex-1 pr-2" title={item.name}>{item.name}</span>
                        <span className="bg-blue-100 text-blue-800 text-[10px] px-1.5 py-0.5 rounded font-bold whitespace-nowrap">x{item.qty}</span>
                      </div>
                      <div className="text-xs text-gray-500 font-mono">
                        ${item.price.toFixed(2)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

          {/* Right panel: Image Tagging UI */}
          <div className="col-span-1 lg:col-span-3 bg-white p-2 rounded-xl shadow-sm border border-gray-200 h-full flex flex-col relative">
             {/* Dynamic Cursor Hint overlay */}
             {activePendingItemId && imageUrl && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900/80 text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg backdrop-blur flex items-center gap-2 animate-pulse pointer-events-none">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"></path></svg>
                  Click anywhere on the image to place the chip
                </div>
             )}

             {/* Core interactive mapping component */}
             <div className="flex-1 w-full relative overflow-hidden flex items-center justify-center bg-gray-50 rounded-lg border border-dashed border-gray-300">
               <ImageTagger />
             </div>
          </div>
        </div>

      </div>

      {/* Global styles for custom scrollbar hidden in normal tailwind classes */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 20px;
        }
      `}} />
    </main>
  );
}