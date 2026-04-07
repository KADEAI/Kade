import React, { useState, useCallback, useEffect, useRef } from "react";
import { useAppTranslation } from "@src/i18n/TranslationContext";
import { vscode } from "@src/utils/vscode";
import { Modal } from "./Modal";
import { useCopyToClipboard } from "@src/utils/clipboard";
import { StandardTooltip } from "@/components/ui";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 20;

interface ImagePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUri: string;
  imagePath?: string;
}

export function ImagePreviewModal({
  isOpen,
  onClose,
  imageUri,
  imagePath,
}: ImagePreviewModalProps) {
  const { t } = useAppTranslation();
  const { copyWithFeedback } = useCopyToClipboard();
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setZoomLevel(1);
      setDragPosition({ x: 0, y: 0 });
      setShowControls(true);
    }
  }, [isOpen]);

  const adjustZoom = (amount: number) => {
    setZoomLevel((prev) => {
      const newZoom = prev + amount;
      return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    });
  };

  const resetZoom = () => {
    setZoomLevel(1);
    setDragPosition({ x: 0, y: 0 });
  };

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    adjustZoom(delta);
  }, []);

  const handleSave = async () => {
    try {
      vscode.postMessage({
        type: "saveImage",
        dataUri: imageUri,
      });
    } catch (error) {
      console.error("Error saving image:", error);
    }
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (imagePath) {
        await copyWithFeedback(imagePath, e);
        setCopyFeedback(true);
        setTimeout(() => setCopyFeedback(false), 2000);
      }
    } catch (err) {
      console.error("Error copying:", err);
    }
  };

  const handleOpenInEditor = () => {
    vscode.postMessage({
      type: "openImage",
      text: imagePath || imageUri,
    });
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (!isDragging) {
        setShowControls(false);
      }
    }, 3000);
  };

  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      showBlur={false}
      overlayClassName="items-center"
      className="bg-transparent w-full h-full max-w-none p-0 flex flex-col items-stretch justify-stretch overflow-hidden"
    >
      <div
        className="relative flex-1 flex items-center justify-center pt-0 overflow-hidden"
        onMouseMove={handleMouseMove}
        onWheel={handleWheel}
        onClick={onClose}
      >
        {/* Checkerboard area - Very faint or hidden */}
        <div className="absolute inset-0 image-checkerboard opacity-[0.00] pointer-events-none"></div>

        {/* Image Wrapper */}
        <div
          style={{
            transform: `translateY(-17%) scale(${zoomLevel}) translate(${dragPosition.x}px, ${dragPosition.y}px)`,
            transformOrigin: "center center",
            transition: isDragging
              ? "none"
              : "transform 0.15s cubic-bezier(0.2, 0, 0.2, 1)",
            cursor: isDragging ? "grabbing" : "grab",
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => {
            setIsDragging(true);
            e.preventDefault();
          }}
          onMouseMove={(e) => {
            if (isDragging) {
              setDragPosition((prev) => ({
                x: prev.x + e.movementX / zoomLevel,
                y: prev.y + e.movementY / zoomLevel,
              }));
            }
          }}
          onMouseUp={() => setIsDragging(false)}
          onMouseLeave={() => setIsDragging(false)}
        >
          <img
            src={imageUri}
            alt="Preview"
            className="max-w-[70vw] max-h-[80vh] object-contain shadow-[0_0px_0px_0px_rgba(0,0,0,0.00)] rounded-sm"
            draggable={false}
          />
        </div>
      </div>
    </Modal>
  );
}
