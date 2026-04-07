import { useState } from "react";
import { useTranslation } from "react-i18next";

import { QueuedMessage } from "@roo-code/types";

import { Button } from "@src/components/ui";

import { Mention } from "./Mention";

interface QueuedMessagesProps {
  queue: QueuedMessage[];
  onRemove: (messageId: string) => void;
  onSendNow: (messageId: string) => void;
  onUpdate: (messageId: string, newText: string) => void;
}

export const QueuedMessages = ({
  queue,
  onRemove,
  onSendNow,
  onUpdate,
}: QueuedMessagesProps) => {
  const { t } = useTranslation("chat");
  const [editingStates, setEditingStates] = useState<
    Record<string, { isEditing: boolean; value: string }>
  >({});

  if (queue.length === 0) {
    return null;
  }

  const getEditState = (messageId: string, currentText: string) => {
    return editingStates[messageId] || { isEditing: false, value: currentText };
  };

  const setEditState = (
    messageId: string,
    isEditing: boolean,
    value?: string,
  ) => {
    setEditingStates((prev) => ({
      ...prev,
      [messageId]: { isEditing, value: value ?? prev[messageId]?.value ?? "" },
    }));
  };

  const handleSaveEdit = (messageId: string, newValue: string) => {
    onUpdate(messageId, newValue);
    setEditState(messageId, false);
  };

  return (
    <div className="px-[15px] pb-2" data-testid="queued-messages">
      <div className="rounded-[18px] border border-vscode-editorWidget-border/70 bg-vscode-editor-background/65 shadow-[0_12px_32px_rgba(0,0,0,0.18)] backdrop-blur-md supports-[backdrop-filter]:bg-vscode-editor-background/55">
        <div className="px-3 pt-2 text-vscode-descriptionForeground text-xs">
          {queue.length} {queue.length === 1 ? "message" : "messages"} queued
        </div>
        <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto px-2 pb-2 pt-1">
          {queue.map((message) => {
            const editState = getEditState(message.id, message.text);

            return (
              <div
                key={message.id}
                className="group flex items-start gap-2 rounded-xl border border-transparent bg-vscode-editor-background/35 px-2 py-1.5 overflow-hidden whitespace-pre-wrap shrink-0 min-h-[24px] hover:border-vscode-editorWidget-border/70"
              >
                <span className="text-vscode-descriptionForeground select-none mt-0.5">
                  ::
                </span>
                <div className="flex-grow min-w-0">
                  {editState.isEditing ? (
                    <textarea
                      ref={(textarea) => {
                        if (textarea) {
                          // Set cursor at the end
                          textarea.setSelectionRange(
                            textarea.value.length,
                            textarea.value.length,
                          );
                        }
                      }}
                      value={editState.value}
                      onChange={(e) =>
                        setEditState(message.id, true, e.target.value)
                      }
                      onBlur={() =>
                        handleSaveEdit(message.id, editState.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSaveEdit(message.id, editState.value);
                        }
                        if (e.key === "Escape") {
                          setEditState(message.id, false, message.text);
                        }
                      }}
                      className="w-full bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded px-2 py-1 resize-none focus:outline-0 focus:ring-1 focus:ring-vscode-focusBorder text-sm"
                      placeholder={t("chat:editMessage.placeholder")}
                      autoFocus
                      rows={Math.min(editState.value.split("\n").length, 10)}
                    />
                  ) : (
                    <div
                      onClick={() =>
                        setEditState(message.id, true, message.text)
                      }
                      className="cursor-pointer hover:underline text-vscode-foreground break-all"
                      title={t("queuedMessages.clickToEdit")}
                    >
                      <Mention text={message.text} />
                    </div>
                  )}
                </div>
                <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 hover:bg-vscode-button-secondaryBackground"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSendNow(message.id);
                    }}
                    title={t("queuedMessages.sendNow", {
                      defaultValue: "Send now",
                    })}
                  >
                    <span className="codicon codicon-send text-xs" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 hover:bg-vscode-list-hoverBackground"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(message.id);
                    }}
                    title={t("queuedMessages.remove", {
                      defaultValue: "Remove queued message",
                    })}
                  >
                    <span className="codicon codicon-trash text-xs" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
