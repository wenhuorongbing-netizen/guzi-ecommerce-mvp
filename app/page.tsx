"use client";

import { useState } from "react";
import { ImageTagger } from "../components/ImageTagger";
import { useProductStore } from "../store/productStore";

export default function Home() {
  const { imageUrl, setImageUrl, hotspots, setHotspots } = useProductStore();
  const [eventId, setEventId] = useState("draft-event-uuid-1234");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Lightning Tagger State
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [referenceText, setReferenceText] = useState("");
  const [isAutoTagging, setIsAutoTagging] = useState(false);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const url = URL.createObjectURL(file);
      setImageUrl(url);
    }
  };

  const handleAutoTag = async () => {
    if (!imageFile || !referenceText.trim()) {
      alert("Please provide both an image and a reference list text to use Auto-Tag.");
      return;
    }

    setIsAutoTagging(true);
    try {
      const formData = new FormData();
      formData.append("file", imageFile);
      formData.append("reference_text", referenceText);

      const res = await fetch("http://localhost:8000/api/vision/auto-tag", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.ok && data.status === "success") {
        // Map AI response to internal Hotspot model
        const { v4: uuidv4 } = await import('uuid');
        const aiHotspots = data.items.map((item: any) => ({
          id: uuidv4(),
          name: item.name,
          price: item.price,
          stock: item.stock || 1,
          x: item.x,
          y: item.y
        }));
        setHotspots(aiHotspots);
        alert(`Successfully mapped ${aiHotspots.length} items from the list.`);
      } else {
        alert(`Failed to auto-tag: ${data.detail || "Unknown AI error"}`);
      }
    } catch (err) {
      console.error(err);
      alert("Network error. Could not connect to AI Vision service.");
    } finally {
      setIsAutoTagging(false);
    }
  };

  const handleBatchSubmit = async () => {
    setIsSubmitting(true);
    try {
      const payload = {
        event_id: eventId,
        image_url: imageUrl || "", // In a real app, this should be a CDN URL after actual upload
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
    <main className="min-h-screen bg-gray-50 p-8 text-gray-800">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="border-b pb-4">
          <h1 className="text-3xl font-bold mb-2">Guzi Drop Admin (MVP)</h1>
          <p className="text-gray-500">Human-in-the-loop (HITL) Interactive Item Tagger</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left panel: Image Upload & Lightning Tagger Inputs */}
          <div className="col-span-1 space-y-4">
            <div className="bg-white p-4 shadow rounded-lg space-y-4">
              <h2 className="font-semibold text-lg text-gray-700 border-b pb-2">1. Upload Image</h2>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="file:border file:border-gray-300 file:rounded file:px-4 file:py-2 file:bg-gray-50 file:text-sm hover:file:bg-gray-100 cursor-pointer text-sm w-full block"
              />
            </div>

            <div className="bg-white p-4 shadow rounded-lg space-y-4">
              <h2 className="font-semibold text-lg text-gray-700 border-b pb-2">2. Lightning Tagger</h2>
              <p className="text-xs text-gray-500 leading-tight">
                Paste your original purchase receipt/list. The AI will strictly map only the items in this list to the image.
              </p>
              <textarea
                value={referenceText}
                onChange={(e) => setReferenceText(e.target.value)}
                placeholder={"e.g.\n1x Haikyuu Badge - Hinata $10\n2x Kageyama Stand $15"}
                className="w-full text-sm border rounded p-2 h-32 focus:ring focus:ring-blue-200"
              />
              <button
                onClick={handleAutoTag}
                disabled={isAutoTagging || !imageFile || !referenceText}
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-md transition-colors flex items-center justify-center gap-2"
              >
                {isAutoTagging ? "AI Analyzing..." : "⚡ Auto Tag with AI"}
              </button>
            </div>

            <div className="bg-white p-4 shadow rounded-lg space-y-4">
              <h2 className="font-semibold text-lg text-gray-700 border-b pb-2">3. Publish</h2>
              <p className="text-sm text-gray-600">Total Items Tagged: {hotspots.length}</p>
              <button
                onClick={handleBatchSubmit}
                disabled={isSubmitting || hotspots.length === 0}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-md transition-colors"
              >
                {isSubmitting ? "Submitting..." : "Publish Batch to DB"}
              </button>
            </div>
          </div>

          {/* Right panel: Image Tagging UI */}
          <div className="col-span-1 md:col-span-2 bg-white p-4 rounded-lg shadow min-h-[500px]">
             {/* Core interactive mapping component */}
             <ImageTagger />
          </div>
        </div>

      </div>
    </main>
  );
}