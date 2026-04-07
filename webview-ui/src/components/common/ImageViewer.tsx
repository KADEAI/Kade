import { useState, useCallback } from "react";
import { useCopyToClipboard } from "@src/utils/clipboard";
import { useAppTranslation } from "@src/i18n/TranslationContext";
import { vscode } from "@src/utils/vscode";
import { MermaidActionButtons } from "./MermaidActionButtons";
import { ImagePreviewModal } from "./ImagePreviewModal";

export interface ImageViewerProps {
  imageUri: string; // The URI to use for rendering (webview URI, base64, or regular URL)
  imagePath?: string; // The actual file path for display and opening
  alt?: string;
  showControls?: boolean;
  className?: string;
}

export function ImageViewer({
  imageUri,
  imagePath,
  alt = "Generated image",
  showControls = true,
  className = "",
}: ImageViewerProps) {
  const [showModal, setShowModal] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const { copyWithFeedback } = useCopyToClipboard();
  const { t } = useAppTranslation();

  /**
   * Opens a modal with the image for zooming
   */
  const handleZoom = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowModal(true);
  };

  /**
   * Copies the image path to clipboard
   */
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();

    try {
      // Copy the file path if available
      if (imagePath) {
        await copyWithFeedback(imagePath, e);
        // Show feedback
        setCopyFeedback(true);
        setTimeout(() => setCopyFeedback(false), 2000);
      }
    } catch (err) {
      console.error(
        "Error copying:",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  /**
   * Saves the image as a file
   */
  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();

    try {
      // Request VSCode to save the image
      vscode.postMessage({
        type: "saveImage",
        dataUri: imageUri,
      });
    } catch (error) {
      console.error("Error saving image:", error);
    }
  };

  /**
   * Opens the image preview modal
   */
  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowModal(true);
  };

  /**
   * Handle mouse enter event for image container
   */
  const handleMouseEnter = () => {
    setIsHovering(true);
  };

  /**
   * Handle mouse leave event for image container
   */
  const handleMouseLeave = () => {
    setIsHovering(false);
  };

  const handleImageError = useCallback(() => {
    setImageError("Failed to load image");
  }, []);

  const handleImageLoad = useCallback(() => {
    setImageError(null);
  }, []);

  /**
   * Format the display path for the image
   */
  const formatDisplayPath = (path: string): string => {
    // If it's already a relative path starting with ./, keep it
    if (path.startsWith("./")) return path;
    // If it's an absolute path, extract the relative portion
    // Look for workspace patterns - match the last segment after any directory separator
    const workspaceMatch = path.match(/\/([^/]+)\/(.+)$/);
    if (workspaceMatch && workspaceMatch[2]) {
      // Return relative path from what appears to be the workspace root
      return `./${workspaceMatch[2]}`;
    }
    // Otherwise, just get the filename
    const filename = path.split("/").pop();
    return filename || path;
  };

  // Handle missing image URI
  if (!imageUri) {
    return (
      <div
        className={`relative w-full ${className}`}
        style={{
          minHeight: "100px",
          backgroundColor: "var(--vscode-editor-background)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ color: "var(--vscode-descriptionForeground)" }}>
          {t("common:image.noData")}
        </span>
      </div>
    );
  }

  return (
    <>
      <div
        className={`relative w-full ${className}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {imageError ? (
          <div
            style={{
              minHeight: "100px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "var(--vscode-editor-background)",
              borderRadius: "4px",
              padding: "20px",
            }}
          >
            <span style={{ color: "var(--vscode-errorForeground)" }}>
              ⚠️ {imageError}
            </span>
          </div>
        ) : (
          <img
            src={imageUri}
            alt={alt}
            className="w-full h-auto rounded cursor-pointer image-glowing-hover"
            onClick={handleImageClick}
            onError={handleImageError}
            onLoad={handleImageLoad}
            style={{
              maxHeight: "400px",
              objectFit: "contain",
              backgroundColor: "var(--vscode-editor-background)",
            }}
          />
        )}
        {imagePath && (
          <div className="mt-1 text-xs text-vscode-descriptionForeground">
            {formatDisplayPath(imagePath)}
          </div>
        )}
        {showControls && isHovering && (
          <div className="absolute bottom-2 right-2 flex gap-1 bg-vscode-editor-background/90 rounded p-0.5 z-10 opacity-100 transition-opacity duration-200 ease-in-out">
            <MermaidActionButtons
              onZoom={handleZoom}
              onCopy={handleCopy}
              onSave={handleSave}
              onViewCode={() => {}} // Not applicable for images
              copyFeedback={copyFeedback}
            />
          </div>
        )}
      </div>

      <ImagePreviewModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        imageUri={imageUri}
        imagePath={imagePath}
      />
    </>
  );
}
