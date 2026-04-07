import ReactDOM from "react-dom";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  overlayClassName?: string;
  showBlur?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  children,
  className = "",
  overlayClassName = "",
  showBlur = true,
}: ModalProps) {
  if (!isOpen) return null;

  const portalRoot = document.getElementById("roo-portal") || document.body;

  return ReactDOM.createPortal(
    <div
      className={`fixed inset-0 ${
        showBlur ? "bg-black/30 backdrop-blur-[60px]" : "bg-black/80"
      } flex justify-center z-[1000] animate-in fade-in duration-200 ${overlayClassName || "items-center"}`}
      style={showBlur ? { WebkitBackdropFilter: "blur(60px)" } : {}}
      onClick={onClose}
    >
      <div
        className={`flex flex-col relative animate-in zoom-in-95 duration-200 ${
          className ||
          "bg-vscode-editor-background rounded w-[90%] h-[90%] max-w-[1200px] shadow-[0_5px_15px_rgba(0,0,0,0.5)] border border-vscode-editorGroup-border"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    portalRoot,
  );
}
