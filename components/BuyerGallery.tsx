"use client"
import React, { useState } from 'react';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { motion, AnimatePresence } from "framer-motion";
import { ShoppingCart } from "lucide-react";

export interface GalleryProduct {
  id: string;
  name: string;
  price: number;
  stock: number;
  x: number;
  y: number;
}

export interface BuyerGalleryProps {
  imageUrl: string;
  products: GalleryProduct[];
}

export const BuyerGallery: React.FC<BuyerGalleryProps> = ({ imageUrl, products }) => {
  const [cart, setCart] = useState<{product: GalleryProduct, qty: number}[]>([]);
  const [showToast, setShowToast] = useState<{id: string, message: string} | null>(null);

  const handleClaim = (product: GalleryProduct, e: React.MouseEvent) => {
    e.stopPropagation();
    if (product.stock <= 0) return;

    // Trigger Toast
    const toastId = Math.random().toString(36);
    setShowToast({ id: toastId, message: `Added ${product.name} to cart!` });
    setTimeout(() => {
      setShowToast(prev => prev?.id === toastId ? null : prev);
    }, 2000);

    // Update Cart State (Local for UI demo)
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item => item.product.id === product.id
          ? { ...item, qty: item.qty + 1 }
          : item
        );
      }
      return [...prev, { product, qty: 1 }];
    });
  };

  const totalItems = cart.reduce((acc, item) => acc + item.qty, 0);
  const totalPrice = cart.reduce((acc, item) => acc + (item.product.price * item.qty), 0);

  return (
    <div className="relative w-full h-[100dvh] bg-black text-white overflow-hidden font-sans select-none">

      {/* Top Header */}
      <div className="absolute top-0 left-0 w-full z-20 p-4 bg-gradient-to-b from-black/80 to-transparent flex justify-between items-start pointer-events-none">
        <div>
          <h1 className="text-xl font-extrabold text-white drop-shadow-md">Guzi Drop</h1>
          <p className="text-xs text-white/80 drop-shadow">Pinch to zoom. Tap tags to claim.</p>
        </div>
      </div>

      {/* Main Image Gallery */}
      <TransformWrapper
        initialScale={1}
        minScale={0.8}
        maxScale={4}
        centerOnInit
        limitToBounds={false}
      >
        <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }}>
          <div className="relative w-full h-full flex items-center justify-center">
            <img
              src={imageUrl}
              alt="Products Layout"
              className="max-w-[100vw] object-contain shadow-2xl"
              style={{ maxHeight: '80vh' }}
            />

            {/* Render Buyer Hotspots */}
            {products.map((product) => {
              const isOutOfStock = product.stock <= 0;
              const isLowStock = product.stock > 0 && product.stock < 3;
              const inCartQty = cart.find(c => c.product.id === product.id)?.qty || 0;

              return (
                <div
                  key={product.id}
                  className="absolute"
                  style={{
                    left: `${product.x}%`,
                    top: `${product.y}%`,
                    transform: 'translate(-50%, -50%)' // Handle centering here to avoid framer-motion conflicts
                  }}
                >
                  <motion.button
                    whileTap={!isOutOfStock ? { scale: 0.85, y: -5 } : {}}
                    whileHover={!isOutOfStock ? { scale: 1.05 } : {}}
                    onClick={(e) => handleClaim(product, e as any)}
                    disabled={isOutOfStock}
                    className={`
                      relative group flex flex-col items-center justify-center
                      min-w-[44px] min-h-[44px]
                      rounded-xl shadow-xl border border-white/40
                      backdrop-blur-md overflow-visible touch-manipulation
                      transition-opacity duration-300
                      ${isOutOfStock ? 'bg-black/60 opacity-40 grayscale cursor-not-allowed' : 'bg-blue-600/70 hover:bg-blue-500/80 cursor-pointer'}
                    `}
                  >
                    {/* Low Stock Pulse Animation Overlay */}
                    {isLowStock && !isOutOfStock && (
                      <span className="absolute inset-0 rounded-xl bg-red-500/40 animate-ping"></span>
                    )}

                    {/* Badge content */}
                    <div className="px-2 py-1 text-center relative z-10 w-max max-w-[100px]">
                      <span
                        className="block text-[10px] sm:text-xs font-bold truncate leading-tight tracking-tight text-white"
                        style={{ textShadow: '0px 1px 3px rgba(0,0,0,0.8)' }}
                      >
                        {product.name}
                      </span>
                      <span
                        className="block text-[9px] font-mono text-blue-100"
                        style={{ textShadow: '0px 1px 2px rgba(0,0,0,0.8)' }}
                      >
                        ¥{product.price} | {isOutOfStock ? 'SOLD OUT' : `Left: ${product.stock}`}
                      </span>
                    </div>

                    {/* In Cart Indicator */}
                    {inCartQty > 0 && (
                      <div className="absolute -top-2 -right-2 bg-pink-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shadow border border-white z-20">
                        {inCartQty}
                      </div>
                    )}
                  </motion.button>
                </div>
              );
            })}
          </div>
        </TransformComponent>
      </TransformWrapper>

      {/* Floating Action Toast */}
      <AnimatePresence>
        {showToast && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 20, x: '-50%' }}
            className="fixed bottom-24 left-1/2 z-50 bg-white text-blue-900 px-4 py-2 rounded-full font-bold text-sm shadow-xl flex items-center gap-2 border border-blue-100"
          >
            <span className="text-lg">✨</span>
            {showToast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sticky Bottom Cart Bar */}
      <div className="fixed bottom-0 left-0 w-full bg-white/95 backdrop-blur-xl border-t border-gray-200 p-4 pb-safe z-40 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] rounded-t-2xl">
        <div className="max-w-xl mx-auto flex items-center justify-between gap-4">

          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center shadow-inner border border-blue-100">
                <ShoppingCart className="w-6 h-6" />
              </div>
              {totalItems > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 min-w-[20px] text-center rounded-full border-2 border-white shadow-sm">
                  {totalItems}
                </span>
              )}
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500 font-medium tracking-wide uppercase">Cart Total</span>
              <span className="text-xl font-extrabold text-gray-900">¥ {totalPrice.toFixed(2)}</span>
            </div>
          </div>

          <motion.button
            whileTap={{ scale: 0.95 }}
            disabled={totalItems === 0}
            className="flex-1 max-w-[200px] bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-300 disabled:to-gray-400 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-blue-500/30 transition-all text-sm uppercase tracking-wider"
          >
            Checkout
          </motion.button>

        </div>
      </div>
    </div>
  );
};